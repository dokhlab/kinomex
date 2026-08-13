from __future__ import annotations

import asyncio
import logging
import math
from typing import Any

import aiohttp

from ..config import settings
from ..database import COLLECTIONS, batch_upsert, get_db

logger = logging.getLogger(__name__)
REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=90, connect=20, sock_read=60)

BINDING_TYPE_KEYWORDS: dict[str, list[str]] = {
    "Type I": ["type i ", "type-i", "type i inhibitor", "active site"],
    "Type II": ["type ii", "type-ii", "dfg-out", "inactive conformation"],
    "Type III": ["type iii", "type-iii", "allosteric"],
    "Covalent": ["covalent", "irreversible"],
    "PROTAC": ["protac", "degrader", "bifunctional"],
}


def _collect_pubmed_ids(record: dict[str, Any]) -> list[str]:
    """Collect PMIDs from various possible fields in the ChEMBL response."""
    pids: list[str] = []
    for field in ["pubmed_id", "document_pubmed_id"]:
        val = record.get(field)
        if val:
            parts = str(val).split(";") if ";" in str(val) else [str(val)]
            pids.extend(p.strip() for p in parts if p.strip())
    return pids


def _classify_binding_type(text: str) -> str:
    text_lower = text.lower()
    for btype, keywords in BINDING_TYPE_KEYWORDS.items():
        if any(kw in text_lower for kw in keywords):
            return btype
    return "Orthosteric Type I"


def _extract_bioactivity(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "activity_id": record.get("activity_id"),
        "compound_id": record.get("molecule_chembl_id", ""),
        "compound_name": record.get("molecule_pref_name") or "",
        "canonical_smiles": record.get("canonical_smiles", ""),
        "assay_type": (record.get("standard_type") or "").upper(),
        "standard_value": record.get("standard_value"),
        "standard_units": record.get("standard_units", ""),
        "standard_relation": record.get("standard_relation", "="),
        "target_chembl_id": record.get("target_chembl_id", ""),
        "target_organism": record.get("target_organism", ""),
        "target_pref_name": record.get("target_pref_name", ""),
        "binding_type": _classify_binding_type(record.get("assay_description", "") or ""),
        "pubmed_ids": _collect_pubmed_ids(record),
        "doi": record.get("doi", ""),
        "pchembl_value": record.get("pchembl_value"),
        "assay_chembl_id": record.get("assay_chembl_id", ""),
        "document_journal": record.get("document_journal", ""),
        "document_year": record.get("document_year"),
        "pubchem_cid": None,
        "source": "chembl",
    }


async def _resolve_chembl_targets(
    session: aiohttp.ClientSession,
    genes_by_uniprot: dict[str, str],
) -> dict[str, str]:
    """Resolve ChEMBL targets to KinomeX genes through UniProt components."""
    target_to_gene: dict[str, str] = {}
    # ChEMBL supports ``__in`` filters. Batching avoids hundreds of serial
    # requests while component inspection prevents a multi-protein target from
    # being assigned to the wrong kinase.
    accessions = sorted(genes_by_uniprot)
    async def fetch_batch(batch: list[str]) -> list[dict[str, Any]]:
        params = {
            ("target_components__accession" if len(batch) == 1 else "target_components__accession__in"): ",".join(batch),
            "limit": 1000,
            "format": "json",
        }
        last_error: aiohttp.ClientResponseError | None = None
        for attempt in range(4):
            try:
                async with session.get(f"{settings.api.chembl_url}/target.json", params=params) as response:
                    response.raise_for_status()
                    return (await response.json()).get("targets", [])
            except aiohttp.ClientResponseError as exc:
                last_error = exc
                if exc.status < 500 and exc.status != 429:
                    break
                await asyncio.sleep(2 ** attempt)
        assert last_error is not None
        exc = last_error
        if exc:
            if len(batch) == 1:
                logger.warning("ChEMBL target mapping failed for %s: %s", batch[0], exc)
                return []
            midpoint = len(batch) // 2
            logger.info("Splitting rejected ChEMBL target batch of %d accessions", len(batch))
            left, right = await asyncio.gather(fetch_batch(batch[:midpoint]), fetch_batch(batch[midpoint:]))
            return left + right

    for start in range(0, len(accessions), 25):
        batch = accessions[start : start + 25]
        targets = await fetch_batch(batch)
        requested = set(batch)
        for target in targets:
            if target.get("organism") != "Homo sapiens" or not target.get("target_chembl_id"):
                continue
            matched = {
                component.get("accession")
                for component in target.get("target_components", [])
                if component.get("accession") in requested
            }
            # Store single-protein targets and complexes containing exactly one
            # requested kinase; ambiguous multi-kinase complexes are excluded.
            genes = {genes_by_uniprot[a] for a in matched}
            if len(genes) == 1:
                target_to_gene[target["target_chembl_id"]] = genes.pop()
    return target_to_gene


def _valid_quantitative_activity(record: dict[str, Any]) -> bool:
    """Accept only finite, non-negative molar concentration measurements."""
    try:
        value = float(record.get("standard_value"))
    except (TypeError, ValueError):
        return False
    return math.isfinite(value) and value >= 0 and record.get("standard_units") == "nM"


async def ingest_bioactivities_for_genes(gene_symbols: list[str]) -> int:
    """Fetch complete nM ChEMBL activity sets for selected KinomeX genes."""
    db = get_db()
    requested = {gene.upper() for gene in gene_symbols}
    genes_by_uniprot: dict[str, str] = {}
    async for doc in db[COLLECTIONS["kinases"]].find(
        {"gene_symbol": {"$in": sorted(requested)}},
        {"gene_symbol": 1, "uniprot_id": 1, "_id": 0},
    ):
        if doc.get("uniprot_id") and doc.get("gene_symbol"):
            genes_by_uniprot[doc["uniprot_id"]] = doc["gene_symbol"]

    imported_count = 0
    async with aiohttp.ClientSession(timeout=REQUEST_TIMEOUT) as session:
        target_to_gene = await _resolve_chembl_targets(session, genes_by_uniprot)
        for target_id, gene in target_to_gene.items():
            checkpoint = await db["etl_checkpoints"].find_one({"source": "chembl", "target_chembl_id": target_id})
            if checkpoint and checkpoint.get("status") == "complete":
                continue
            offset = 0
            target_failed = False
            while True:
                params = {
                    "target_chembl_id": target_id,
                    "standard_units": "nM",
                    "limit": settings.rate.chembl_batch_size,
                    "offset": offset,
                    "format": "json",
                }
                payload = None
                for attempt in range(4):
                    try:
                        async with session.get(f"{settings.api.chembl_url}/activity.json", params=params) as response:
                            response.raise_for_status()
                            payload = await response.json()
                            break
                    except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
                        if attempt == 3:
                            logger.error("ChEMBL activity fetch failed for %s at offset %d: %s", target_id, offset, exc)
                            target_failed = True
                        else:
                            await asyncio.sleep(2 ** attempt)
                if target_failed or payload is None:
                    break
                activities = payload.get("activities", [])
                page_records: list[dict[str, Any]] = []
                for activity in activities:
                    if not _valid_quantitative_activity(activity):
                        continue
                    record = _extract_bioactivity(activity)
                    record["target_gene_symbol"] = gene
                    page_records.append(record)
                if page_records:
                    # activity_id is ChEMBL's stable source-record identity.
                    # Compound+assay is not unique and previously discarded
                    # legitimate replicate measurements.
                    await batch_upsert(
                        COLLECTIONS["bioactivities"],
                        page_records,
                        key_fields=["source", "activity_id"],
                        batch_size=settings.rate.chembl_batch_size,
                    )
                    imported_count += len(page_records)
                next_page = payload.get("page_meta", {}).get("next")
                if not next_page or not activities:
                    break
                offset += settings.rate.chembl_batch_size
            if not target_failed:
                await db["etl_checkpoints"].update_one(
                    {"source": "chembl", "target_chembl_id": target_id},
                    {"$set": {"status": "complete", "gene_symbol": gene, "records_seen": offset + len(activities)}},
                    upsert=True,
                )

    logger.info("Stored %d kinase-scoped ChEMBL records for %s", imported_count, sorted(requested))
    return imported_count


async def ingest_bioactivities() -> int:
    """Fetch bioactivity data from ChEMBL for human kinase targets.

    Resolve each KinomeX protein to ChEMBL through its reviewed UniProt
    accession, then fetch the complete kinase-scoped nM activity set. This
    avoids an arbitrary global-record cap and guarantees target_gene_symbol is
    present for every stored activity.
    """
    logger.info("Starting ChEMBL bioactivity ingestion")
    db = get_db()
    genes = [
        doc["gene_symbol"]
        async for doc in db[COLLECTIONS["kinases"]].find(
            {"uniprot_id": {"$exists": True, "$ne": ""}},
            {"gene_symbol": 1, "_id": 0},
        )
        if doc.get("gene_symbol")
    ]
    return await ingest_bioactivities_for_genes(genes)


async def _legacy_global_ingest_bioactivities() -> int:
    """Retained temporarily for migration comparison; do not use for ETL."""
    logger.info("Starting legacy global ChEMBL bioactivity ingestion")
    sem = asyncio.Semaphore(settings.rate.chembl_rps)
    base = settings.api.chembl_url

    # Get known UniProt IDs from DB to match targets
    db = get_db()
    known_uniprots: set[str] = set()
    async for doc in db[COLLECTIONS["kinases"]].find({}, {"uniprot_id": 1, "_id": 0}):
        uid = doc.get("uniprot_id", "")
        if uid:
            known_uniprots.add(uid)

    logger.info("Known UniProt IDs for matching: %d", len(known_uniprots))

    all_activities: list[dict[str, Any]] = []
    offset = 0
    size = settings.rate.chembl_batch_size
    max_records = 50000  # Cap to keep runtime reasonable

    async with aiohttp.ClientSession() as session:
        while offset < max_records:
            params = {
                "target_organism": "Homo sapiens",
                "assay_type": "B",
                "limit": size,
                "offset": offset,
                "format": "json",
            }
            try:
                async with sem:
                    await asyncio.sleep(1 / settings.rate.chembl_rps)
                    async with session.get(f"{base}/activity.json", params=params) as resp:
                        resp.raise_for_status()
                        data = await resp.json()
            except Exception as exc:
                logger.warning("ChEMBL fetch failed at offset %d: %s", offset, exc)
                break

            activities = data.get("activities", [])
            if not activities:
                break

            for act in activities:
                all_activities.append(_extract_bioactivity(act))

            page_count = data.get("page_count", 0)
            offset += size
            if offset >= page_count * size:
                # Fetch next page
                pass

            logger.info("Fetched %d ChEMBL activities so far", len(all_activities))

            if len(activities) < size:
                break

    if all_activities:
        await batch_upsert(
            COLLECTIONS["bioactivities"],
            all_activities,
            key_fields=["compound_id", "assay_chembl_id"],
            batch_size=settings.rate.chembl_batch_size,
        )

    # Remove exact duplicates (same compound_id + target_chembl_id duplicates from different assays)
    db = get_db()
    coll = db[COLLECTIONS["bioactivities"]]
    pipeline = [
        {"$group": {"_id": {"compound_id": "$compound_id", "target_chembl_id": "$target_chembl_id"}, "first": {"$first": "$_id"}, "count": {"$sum": 1}}},
        {"$match": {"count": {"$gt": 1}}},
    ]
    dupes = await coll.aggregate(pipeline).to_list(None)
    removed = 0
    for d in dupes:
        result = await coll.delete_one({"_id": d["first"]})
        removed += result.deleted_count
    if removed:
        logger.info("Removed %d exact duplicates from bioactivities", removed)

    logger.info("ChEMBL ingestion complete – %d bioactivity records stored", len(all_activities))
    return len(all_activities)
