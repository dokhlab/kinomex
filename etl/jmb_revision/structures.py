"""RCSB metadata, EMDB links, bound ligands and other entries (Task 8, defect D14).

Run inside the ETL image:

    python -m etl.jmb_revision.structures --fetch           # RCSB Search + Data API -> cache
    python -m etl.jmb_revision.structures                   # dry run from the cache
    python -m etl.jmb_revision.structures --apply           # writes structures fields,
                                                            # structures_other and the reconciliation

The fetch writes raw JSON under $KX_CACHE/structures/. The apply step reads only the
cache, adds bound_ligands, emdb_ids, uniprot_ids, release_date and deposit_date to
the 10,043 scored structures documents (no documents are added or removed), and
rebuilds ``structures_other``: cryo-EM entries above 3.5 Å and NMR entries mapped to
catalog accessions, which never enter counts or the PDIS structure component.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pymongo import MongoClient, UpdateOne

from ..config import settings
from . import rcsb_meta

logger = logging.getLogger("kinomex.jmb_revision.structures")
CACHE = Path(os.getenv("KX_CACHE", "/home/html/storage/kinomex/jmb_revision_cache")) / "structures"
SEARCH_URL = "https://search.rcsb.org/rcsbsearch/v2/query"
GRAPHQL_URL = "https://data.rcsb.org/graphql"
HOLDINGS_URL = "https://data.rcsb.org/rest/v1/holdings"
BATCH = 200

ENTRY_QUERY = """
query Entries($ids: [String!]!) {
  entries(entry_ids: $ids) {
    rcsb_id
    struct { title }
    exptl { method }
    rcsb_entry_info { resolution_combined }
    rcsb_accession_info { deposit_date initial_release_date revision_date }
    rcsb_entry_container_identifiers { emdb_ids related_emdb_ids }
    pdbx_database_related { db_name db_id content_type }
    polymer_entities {
      rcsb_polymer_entity_container_identifiers {
        reference_sequence_identifiers { database_accession database_name }
      }
      rcsb_entity_source_organism { ncbi_scientific_name }
    }
    nonpolymer_entities { nonpolymer_comp { chem_comp { id name type formula_weight } } }
  }
}
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _http(url: str, body: dict | None = None, timeout: int = 180, tries: int = 5) -> Any:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json", "User-Agent": "KinomeX-ETL/jmb-revision"}
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return {"status": 404}
            if attempt == tries - 1:
                raise
        except Exception:
            if attempt == tries - 1:
                raise
        time.sleep(2 ** attempt)


def _write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    tmp.replace(path)


def _catalog(db) -> tuple[dict[str, str], dict[str, str]]:
    acc_to_gene, membership = {}, {}
    for doc in db.kinases.find({}, {"gene_symbol": 1, "uniprot_id": 1, "catalog_membership": 1}):
        if doc.get("uniprot_id"):
            acc_to_gene[str(doc["uniprot_id"]).upper()] = doc["gene_symbol"]
        membership[doc["gene_symbol"]] = doc.get("catalog_membership")
    return acc_to_gene, membership


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------

def search_body(accessions: list[str], extra: list[dict], import_like: bool = False) -> dict:
    """analysis/rcsb.py query; ``import_like`` mirrors the August 12 ingestor filters."""
    acc_node = {"type": "terminal", "service": "text", "parameters": {
        "attribute": "rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession",
        "operator": "in", "value": accessions}}
    if import_like:
        nodes = [
            {"type": "terminal", "service": "text", "parameters": {
                "attribute": "rcsb_entity_source_organism.ncbi_scientific_name",
                "operator": "exact_match", "value": "Homo sapiens"}},
            {"type": "terminal", "service": "text", "parameters": {
                "attribute": "rcsb_entry_info.resolution_combined", "operator": "less", "value": 3.5}},
            acc_node,
        ]
    else:
        nodes = [acc_node, {"type": "terminal", "service": "text", "parameters": {
            "attribute": "rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_name",
            "operator": "exact_match", "value": "UniProt"}}] + extra
    return {"query": {"type": "group", "logical_operator": "and", "nodes": nodes}, "return_type": "entry",
            "request_options": {"return_all_hits": True, "results_content_type": ["experimental"],
                                "facets": [{"name": "m", "aggregation_type": "terms", "attribute": "exptl.method"}]}}


SEARCHES = {
    "all": ([], False),
    "le35": ([{"type": "terminal", "service": "text", "parameters": {
        "attribute": "rcsb_entry_info.resolution_combined", "operator": "less_or_equal", "value": 3.5}}], False),
    "import_like": ([], True),
}


def fetch_searches(accessions: list[str], force: bool) -> dict[str, dict]:
    out = {}
    for name, (extra, import_like) in SEARCHES.items():
        path = CACHE / f"search_{name}.json"
        if path.exists() and not force:
            out[name] = json.loads(path.read_text())
            continue
        body = search_body(accessions, extra, import_like)
        raw = _http(SEARCH_URL, body)
        payload = {
            "retrieved_at": _now(), "query": body, "total_count": raw["total_count"],
            "facets": {b["label"]: b["population"] for b in raw.get("facets", [{}])[0].get("buckets", [])},
            "ids": sorted(x["identifier"] for x in raw["result_set"]),
        }
        _write(path, payload)
        logger.info("search %s: %d entries", name, payload["total_count"])
        out[name] = payload
    return out


def load_entries() -> tuple[dict[str, dict], set[str], str | None]:
    entries, missing, dates = {}, set(), []
    for path in sorted((CACHE / "entries").glob("batch_*.json")):
        batch = json.loads(path.read_text())
        dates.append(batch["retrieved_at"])
        for entry in batch["entries"]:
            entries[entry["rcsb_id"].upper()] = entry
        missing.update(batch["missing"])
    return entries, missing - set(entries), (min(dates) if dates else None)


def _fetch_batch(args: tuple[int, list[str]]) -> int:
    index, ids = args
    raw = _http(GRAPHQL_URL, {"query": ENTRY_QUERY, "variables": {"ids": ids}})
    if raw.get("errors"):
        raise RuntimeError(f"RCSB GraphQL error: {raw['errors'][:1]}")
    got = [e for e in (raw.get("data") or {}).get("entries") or [] if e]
    returned = {e["rcsb_id"].upper() for e in got}
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    _write(CACHE / "entries" / f"batch_{stamp}_{index:04d}.json", {
        "retrieved_at": _now(), "ids": ids, "entries": got, "missing": sorted(set(ids) - returned)})
    return len(got)


def fetch_entries(ids: set[str]) -> None:
    cached, missing, _ = load_entries()
    todo = sorted(ids - set(cached) - missing)
    batches = [(i, todo[i * BATCH:(i + 1) * BATCH]) for i in range((len(todo) + BATCH - 1) // BATCH)]
    logger.info("GraphQL: %d cached, %d to fetch in %d batches", len(cached), len(todo), len(batches))
    with ThreadPoolExecutor(3) as pool:
        for n, _ in enumerate(pool.map(_fetch_batch, batches), 1):
            if n % 10 == 0:
                logger.info("GraphQL batches done: %d/%d", n, len(batches))


def fetch_holdings(ids: set[str]) -> None:
    def one(pdb_id: str) -> None:
        path = CACHE / "holdings" / f"{pdb_id}.json"
        if path.exists():
            return
        status = _http(f"{HOLDINGS_URL}/status/{pdb_id}", timeout=60)
        combined = (status or {}).get("rcsb_repository_holdings_combined") or {}
        removed = None
        if combined.get("status") != "CURRENT":
            removed = _http(f"{HOLDINGS_URL}/removed/{pdb_id}", timeout=60)
        _write(path, {"retrieved_at": _now(), "status": status, "removed": removed})
    with ThreadPoolExecutor(4) as pool:
        list(pool.map(one, sorted(ids)))


def fetch(db, force_search: bool) -> dict[str, Any]:
    acc_to_gene, _ = _catalog(db)
    stored = set(db.structures.distinct("pdb_id"))
    searches = fetch_searches(sorted(acc_to_gene), force_search)
    union = stored | set(searches["all"]["ids"]) | set(searches["import_like"]["ids"])
    fetch_entries(union)
    entries, missing, _ = load_entries()
    fetch_holdings((stored - set(searches["le35"]["ids"])) | missing)
    return {"searches": {k: v["total_count"] for k, v in searches.items()},
            "entries_cached": len(entries), "not_returned_by_graphql": sorted(missing)}


# ---------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------

def build_other(entries: dict[str, dict], all_ids: list[str], stored: set[str],
                acc_to_gene: dict[str, str], retrieved_at: str | None) -> list[dict[str, Any]]:
    rows = []
    for pdb_id in all_ids:
        if pdb_id in stored or pdb_id not in entries:
            continue
        parsed = rcsb_meta.parse_entry(entries[pdb_id], acc_to_gene)
        reason = rcsb_meta.other_entry_reason(parsed["methods"], parsed["resolution"])
        if not reason or not parsed["uniprot_ids"]:
            continue
        rows.append({
            "pdb_id": pdb_id,
            "gene_symbols": parsed["gene_symbols"],
            "uniprot_ids": parsed["uniprot_ids"],
            "experimental_method": parsed["experimental_method"],
            "resolution": None if reason == rcsb_meta.REASON_NMR else parsed["resolution"],
            "emdb_ids": parsed["emdb_ids"],
            "title": parsed["title"],
            "release_date": parsed["release_date"],
            "reason": reason,
            "scored": False,
            "source": "rcsb",
            "retrieved_at": retrieved_at,
        })
    return rows


def run(db, apply: bool, write_report: bool) -> dict[str, Any]:
    from . import structures_reconcile

    acc_to_gene, membership = _catalog(db)
    entries, missing, retrieved_at = load_entries()
    searches = {name: json.loads((CACHE / f"search_{name}.json").read_text()) for name in SEARCHES}
    docs = list(db.structures.find({}, {"pdb_id": 1, "gene_symbols": 1, "experimental_method": 1, "resolution": 1}))
    stored = {d["pdb_id"] for d in docs}
    if len(docs) != len(stored):
        raise RuntimeError("structures.pdb_id is not unique")
    parsed = {pid: rcsb_meta.parse_entry(entries[pid], acc_to_gene) for pid in stored if pid in entries}

    ops, gene_mismatch = [], []
    for doc in docs:
        p = parsed.get(doc["pdb_id"])
        fields = {
            "bound_ligands": p["bound_ligands"] if p else [],
            "emdb_ids": p["emdb_ids"] if p else [],
            "uniprot_ids": p["uniprot_ids"] if p else [],
            "release_date": p["release_date"] if p else None,
            "deposit_date": p["deposit_date"] if p else None,
            "rcsb_metadata_status": "current" if p else "not returned by RCSB Data API",
            "rcsb_metadata_retrieved_at": retrieved_at,
            "bound_ligands_rule": "RCSB non-polymer entities excluding solvent, ions and common additives",
        }
        if p and set(p["gene_symbols"]) != set(doc.get("gene_symbols") or []):
            gene_mismatch.append(doc["pdb_id"])
        ops.append(UpdateOne({"_id": doc["_id"]}, {"$set": fields}))

    other = build_other(entries, searches["all"]["ids"], stored, acc_to_gene, retrieved_at)
    em_docs = [d for d in docs if d.get("experimental_method") == rcsb_meta.EM_METHOD]
    summary = {
        "structures": len(docs),
        "metadata_found": len(parsed),
        "metadata_missing": sorted(stored - set(parsed)),
        "with_bound_ligand": sum(1 for p in parsed.values() if p["bound_ligands"]),
        "distinct_ligand_components": len({l["comp_id"] for p in parsed.values() for l in p["bound_ligands"]}),
        "cryo_em_stored": len(em_docs),
        "cryo_em_with_emdb": sum(1 for d in em_docs if parsed.get(d["pdb_id"], {}).get("emdb_ids")),
        "gene_symbols_differ_from_accession_mapping": len(gene_mismatch),
        "gene_symbols_differ_examples": gene_mismatch[:10],
        "structures_other": len(other),
        "structures_other_by_reason": dict(Counter(r["reason"] for r in other)),
        "structures_other_genes": len({g for r in other for g in r["gene_symbols"]}),
    }
    if apply:
        db.structures.bulk_write(ops, ordered=False)
        db.structures_other.delete_many({})
        if other:
            db.structures_other.insert_many([dict(r) for r in other], ordered=False)
        db.structures_other.create_index("pdb_id", unique=True)
        db.structures_other.create_index("gene_symbols")
        if db.structures.count_documents({}) != len(docs):
            raise RuntimeError("structures document count changed")
    if apply or write_report:
        report = structures_reconcile.build(db, searches, entries, missing, parsed, membership,
                                            acc_to_gene, docs, CACHE)
        path = structures_reconcile.write(report)
        summary["reconciliation"] = str(path)
        summary["reconciliation_summary"] = report["summary"]
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", help="query RCSB and fill the cache")
    parser.add_argument("--refresh-search", action="store_true", help="re-run the RCSB searches")
    parser.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    parser.add_argument("--report", action="store_true", help="write the reconciliation JSON without DB writes")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    db = MongoClient(settings.db.uri)[settings.db.db_name]
    if args.fetch:
        logger.info("FETCH: %s", fetch(db, args.refresh_search))
    result = run(db, args.apply, args.report)
    logger.info("%s structures: %s", "APPLIED" if args.apply else "DRY RUN",
                json.dumps(result, indent=1, default=str))


if __name__ == "__main__":
    main()
