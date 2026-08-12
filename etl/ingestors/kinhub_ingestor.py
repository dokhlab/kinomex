"""Annotate the reviewed UniProt catalogue against the public KinHub roster."""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Any

import aiohttp
from pymongo import UpdateOne

from ..database import COLLECTIONS, batch_upsert, get_db
from .uniprot_ingestor import _extract_kinase

logger = logging.getLogger(__name__)
KINHUB_URL = "http://www.kinhub.org/kinases.html"


class _TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_td = False
        self.cell_parts: list[str] = []
        self.row: list[str] = []
        self.rows: list[list[str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "td":
            self.in_td = True
            self.cell_parts = []

    def handle_data(self, data: str) -> None:
        if self.in_td:
            self.cell_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "td" and self.in_td:
            self.row.append("".join(self.cell_parts).strip())
            self.in_td = False
        elif tag == "tr":
            if len(self.row) == 8:
                self.rows.append(self.row)
            self.row = []


async def ingest_kinhub_catalog() -> int:
    db = get_db()
    timeout = aiohttp.ClientTimeout(total=60)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(KINHUB_URL) as response:
            response.raise_for_status()
            html = await response.text()

    parser = _TableParser()
    parser.feed(html)
    if len(parser.rows) < 500:
        raise RuntimeError(f"KinHub roster parse returned only {len(parser.rows)} rows")

    by_accession: dict[str, list[dict[str, str]]] = defaultdict(list)
    for xname, manning, hgnc, kinase_name, group, family, subfamily, accession in parser.rows:
        if not accession:
            raise RuntimeError(f"KinHub row {xname!r} has no UniProt accession")
        by_accession[accession].append({
            "xname": xname,
            "manning_name": manning,
            "hgnc_name": hgnc,
            "kinase_name": kinase_name,
            "group": group,
            "family": family,
            "subfamily": subfamily,
        })

    database_ids = set(await db[COLLECTIONS["kinases"]].distinct("uniprot_id"))
    keyword_database_ids = set(await db[COLLECTIONS["kinases"]].distinct(
        "uniprot_id", {"uniprot_keyword_membership": True}
    ))
    roster_ids = set(by_accession)
    missing = sorted(roster_ids - keyword_database_ids)
    resolved_accessions = {accession: accession for accession in roster_ids & database_ids}
    supplemental_records: list[dict[str, Any]] = []
    unresolved: list[str] = []
    if missing:
        logger.info("Resolving %d KinHub accessions outside the reviewed-keyword query", len(missing))
        async with aiohttp.ClientSession(timeout=timeout) as session:
            for accession in missing:
                async with session.get(
                    f"https://rest.uniprot.org/uniprotkb/{accession}.json"
                ) as response:
                    if response.status == 404:
                        unresolved.append(accession)
                        continue
                    response.raise_for_status()
                    record = _extract_kinase(await response.json())
                    record["uniprot_keyword_membership"] = False
                    record["catalog_alias_accessions"] = [accession]
                    supplemental_records.append(record)
                    resolved_accessions[accession] = record["uniprot_id"]
        if supplemental_records:
            await batch_upsert(
                COLLECTIONS["kinases"], supplemental_records,
                key_fields=["uniprot_id"], batch_size=100,
            )
        if unresolved:
            logger.warning("KinHub accessions no longer resolvable in UniProt: %s", ", ".join(unresolved))

    domains_by_primary: dict[str, list[dict[str, str]]] = defaultdict(list)
    for roster_accession, domains in by_accession.items():
        primary = resolved_accessions.get(roster_accession)
        if primary:
            domains_by_primary[primary].extend(domains)
    database_ids = set(await db[COLLECTIONS["kinases"]].distinct("uniprot_id"))
    core_ids = set(domains_by_primary)
    keyword_ids = set(await db[COLLECTIONS["kinases"]].distinct(
        "uniprot_id", {"uniprot_keyword_membership": True}
    ))
    inactive_ids = set(await db[COLLECTIONS["kinases"]].distinct(
        "uniprot_id", {"uniprot_record_status": "inactive"}
    ))

    retrieved_at = datetime.now(timezone.utc)
    operations: list[UpdateOne] = []
    for accession in sorted(database_ids):
        domains = domains_by_primary.get(accession, [])
        if domains:
            primary = domains[0]
            operations.append(UpdateOne(
                {"uniprot_id": accession},
                {"$set": {
                    "catalog_membership": "kinhub_core",
                    "catalog_source": "KinHub/Manning",
                    "kinhub_domains": domains,
                    "group": primary["group"],
                    "family": primary["family"],
                    "subfamily": primary["subfamily"],
                    "catalog_retrieved_at": retrieved_at,
                }},
            ))
        else:
            operations.append(UpdateOne(
                {"uniprot_id": accession},
                {
                    "$set": {
                        "catalog_membership": "uniprot_extended",
                        "catalog_source": "UniProt reviewed Protein kinase keyword",
                        "kinhub_domains": [],
                        "catalog_retrieved_at": retrieved_at,
                    }
                },
            ))
    if operations:
        await db[COLLECTIONS["kinases"]].bulk_write(operations, ordered=False)

    named_hgnc = {row[2] for row in parser.rows if row[2]}
    summary = {
        "_id": "human-kinase-catalog",
        "source": "kinhub_uniprot_reconciliation",
        "kinhub_domain_rows": len(parser.rows),
        "kinhub_roster_accessions": len(roster_ids),
        "kinhub_resolved_entries": len(core_ids),
        "kinhub_named_hgnc_symbols": len(named_hgnc),
        "reviewed_uniprot_keyword_entries": len(keyword_ids),
        "kinhub_keyword_overlap_entries": len(core_ids & keyword_ids),
        "kinhub_supplemental_entries": len(core_ids - keyword_ids),
        "uniprot_extended_entries": len(database_ids - core_ids),
        "inactive_historical_entries": len(inactive_ids),
        "unresolved_kinhub_accessions": unresolved,
        "source_urls": {
            "kinhub": KINHUB_URL,
            "uniprot": "https://rest.uniprot.org/uniprotkb/search",
        },
        "retrieved_at": retrieved_at,
    }
    await db["catalog_metadata"].replace_one({"_id": summary["_id"]}, summary, upsert=True)
    logger.info(
        "Accounted for %d KinHub domains / %d core entries plus %d reviewed UniProt extended entries",
        len(parser.rows), len(core_ids), len(database_ids - core_ids),
    )
    return len(core_ids)
