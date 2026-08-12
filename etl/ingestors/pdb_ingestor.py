from __future__ import annotations

import asyncio
import logging
from typing import Any

import aiohttp
from tenacity import retry, stop_after_attempt, wait_exponential

from ..config import settings
from ..database import COLLECTIONS, batch_upsert, get_db

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Conformation keywords
# ---------------------------------------------------------------------------
DFG_IN_KEYWORDS = {"dfg-in", "dfg in", "active", "activation loop-in"}
DFG_OUT_KEYWORDS = {"dfg-out", "dfg out", "inactive", "activation loop-out"}
ALPHAC_IN_KEYWORDS = {"alphac-in", "alpha c-in", "alpha-c in"}
ALPHAC_OUT_KEYWORDS = {"alphac-out", "alpha c-out", "alpha-c out"}


def _classify_conformation(title: str, keywords: list[str]) -> dict[str, bool]:
    """Heuristic classification of backbone conformation from title & keywords."""
    text = (title + " " + " ".join(keywords)).lower()
    return {
        "dfg_in": any(kw in text for kw in DFG_IN_KEYWORDS),
        "dfg_out": any(kw in text for kw in DFG_OUT_KEYWORDS),
        "alphac_in": any(kw in text for kw in ALPHAC_IN_KEYWORDS),
        "alphac_out": any(kw in text for kw in ALPHAC_OUT_KEYWORDS),
    }


async def _fetch_page(
    session: aiohttp.ClientSession,
    url: str,
    payload: dict[str, Any],
    semaphore: asyncio.Semaphore,
) -> dict[str, Any]:
    async with semaphore:
        await asyncio.sleep(1 / settings.rate.pdb_rps)
        async with session.post(url, json=payload) as resp:
            resp.raise_for_status()
            return await resp.json()


def _build_search_payload(offset: int, size: int, uniprot_ids: list[str]) -> dict[str, Any]:
    """RCSB Search API v2 query for human kinase structures."""
    return {
        "query": {
            "type": "group",
            "logical_operator": "and",
            "nodes": [
                {
                    "type": "terminal",
                    "service": "text",
                    "parameters": {
                        "attribute": "rcsb_entity_source_organism.ncbi_scientific_name",
                        "operator": "exact_match",
                        "value": "Homo sapiens",
                    },
                },
                {
                    "type": "terminal",
                    "service": "text",
                    "parameters": {
                        "attribute": "rcsb_entry_info.resolution_combined",
                        "operator": "less",
                        "value": settings.rate.pdb_max_resolution,
                    },
                },
                {
                    "type": "terminal",
                    "service": "text",
                    "parameters": {
                        "attribute": "rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession",
                        "operator": "in",
                        "value": uniprot_ids,
                    },
                },
            ],
        },
        "return_type": "entry",
        "request_options": {
            "paginate": {"start": offset, "rows": size},
            "results_content_type": ["experimental"],
        },
    }


ENTRY_QUERY = """
query StructureEntries($ids: [String!]!) {
  entries(entry_ids: $ids) {
    rcsb_id
    struct { title }
    struct_keywords { pdbx_keywords text }
    exptl { method }
    rcsb_entry_info { resolution_combined }
    polymer_entities {
      rcsb_polymer_entity_container_identifiers {
        reference_sequence_identifiers { database_accession database_name }
      }
      rcsb_entity_source_organism { rcsb_gene_name { value } }
    }
  }
}
"""


async def _fetch_entry_details(
    session: aiohttp.ClientSession,
    pdb_ids: list[str],
    semaphore: asyncio.Semaphore,
) -> list[dict[str, Any]]:
    async with semaphore:
        await asyncio.sleep(1 / settings.rate.pdb_rps)
        async with session.post(
            "https://data.rcsb.org/graphql",
            json={"query": ENTRY_QUERY, "variables": {"ids": pdb_ids}},
        ) as resp:
            resp.raise_for_status()
            payload = await resp.json()
    if payload.get("errors"):
        raise RuntimeError(f"RCSB GraphQL error: {payload['errors'][:1]}")
    return [entry for entry in payload.get("data", {}).get("entries", []) if entry]


def _extract_structure(
    entry: dict[str, Any],
    uniprot_to_gene: dict[str, str],
    known_genes: set[str],
) -> dict[str, Any] | None:
    """Parse an RCSB entry and retain only verified kinase-linked structures."""
    pdb_id = entry.get("rcsb_id", "")

    # Extract from nested attrs when available
    title = ""
    resolution = None
    method = ""
    ligands: list[str] = []
    gene_symbols: list[str] = []
    keywords: list[str] = []

    container = entry.get("rcsb_entry_info") or {}
    resolution = container.get("resolution_combined", [None])
    if isinstance(resolution, list):
        resolution = resolution[0] if resolution else None

    methods = entry.get("exptl") or []
    method = methods[0].get("method", "") if methods else ""

    # Gene symbols from polymer entities
    for pe in entry.get("polymer_entities") or []:
        identifiers = pe.get("rcsb_polymer_entity_container_identifiers") or {}
        for ref in identifiers.get("reference_sequence_identifiers") or []:
            if ref.get("database_name") == "UniProt":
                gene = uniprot_to_gene.get(str(ref.get("database_accession", "")).upper())
                if gene:
                    gene_symbols.append(gene)
        for org in pe.get("rcsb_entity_source_organism") or []:
            for gene_record in org.get("rcsb_gene_name") or []:
                gene = str(gene_record.get("value", "")).upper()
                if gene in known_genes:
                    gene_symbols.append(gene)

    title = entry.get("struct", {}).get("title", "") if isinstance(entry.get("struct"), dict) else ""
    keyword_record = entry.get("struct_keywords") or {}
    keywords = [value for value in [keyword_record.get("pdbx_keywords"), keyword_record.get("text")] if value]

    gene_symbols = sorted(set(gene_symbols))
    if not pdb_id or not gene_symbols:
        return None

    conf = _classify_conformation(title, keywords)

    return {
        "pdb_id": pdb_id,
        "title": title,
        "resolution": resolution,
        "experimental_method": method,
        "bound_ligands": ligands,
        "gene_symbols": gene_symbols,
        "conformation": conf,
        "keywords": keywords,
        "source": "rcsb",
    }


async def ingest_structures() -> int:
    """Fetch kinase structures from RCSB PDB and store them."""
    logger.info("Starting PDB structure ingestion")
    sem = asyncio.Semaphore(settings.rate.pdb_rps)
    cfg = settings.api
    url = cfg.rcsb_url

    # Build a set of known gene symbols from the DB for cross-reference
    db = get_db()
    known_genes: set[str] = set()
    uniprot_to_gene: dict[str, str] = {}
    async for doc in db[COLLECTIONS["kinases"]].find(
        {}, {"gene_symbol": 1, "uniprot_id": 1, "_id": 0}
    ):
        gene = str(doc.get("gene_symbol", "")).upper()
        uniprot_id = str(doc.get("uniprot_id", "")).upper()
        if gene:
            known_genes.add(gene)
        if gene and uniprot_id:
            uniprot_to_gene[uniprot_id] = gene
    if not uniprot_to_gene:
        raise RuntimeError("No kinase UniProt accessions are available for RCSB linkage")

    all_structures: list[dict[str, Any]] = []
    offset = 0
    size = settings.rate.pdb_batch_size
    total_estimate: int | None = None

    async with aiohttp.ClientSession() as session:
        while True:
            payload = _build_search_payload(offset, size, sorted(uniprot_to_gene))
            try:
                data = await _fetch_page(session, url, payload, sem)
            except Exception as exc:
                logger.error("PDB fetch failed at offset %d: %s", offset, exc)
                break

            total = data.get("total_count", 0)
            if total_estimate is None:
                total_estimate = total
                logger.info("PDB reports %d matching structures", total_estimate)

            result_list = data.get("result_set", [])
            if not result_list:
                break

            pdb_ids = [r["identifier"] for r in result_list]
            for detail_offset in range(0, len(pdb_ids), 100):
                details = await _fetch_entry_details(
                    session, pdb_ids[detail_offset : detail_offset + 100], sem
                )
                for entry_data in details:
                    struct = _extract_structure(entry_data, uniprot_to_gene, known_genes)
                    if struct:
                        all_structures.append(struct)

            offset += size
            if offset >= total:
                break

    if not all_structures:
        raise RuntimeError("RCSB returned no structures linked to kinase accessions")

    await db[COLLECTIONS["structures"]].delete_many({"source": "rcsb"})
    await batch_upsert(
        COLLECTIONS["structures"],
        all_structures,
        key_fields=["pdb_id"],
        batch_size=settings.rate.pdb_batch_size,
    )
    logger.info("PDB ingestion complete – %d structure records stored", len(all_structures))
    return len(all_structures)
