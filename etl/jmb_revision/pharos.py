"""Pharos target development levels (TDL) for the 678 catalog entries.

Run inside the ETL image:

    python -m etl.jmb_revision.pharos --fetch     # Pharos GraphQL -> cache
    python -m etl.jmb_revision.pharos             # dry run from the cache
    python -m etl.jmb_revision.pharos --apply     # rebuilds pharos_targets

The query matches analysis/ext.py. Entries that Pharos does not resolve keep
``tdl: null`` and count as unmapped.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import time
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pymongo import MongoClient

from ..config import settings

logger = logging.getLogger("kinomex.jmb_revision.pharos")
CACHE = Path(os.getenv("KX_CACHE", "/home/html/storage/kinomex/jmb_revision_cache")) / "pharos"
API = "https://pharos-api.ncats.io/graphql"
QUERY = '{ target(q:{uniprot:"%s"}) { sym uniprot tdl fam novelty } }'
TDLS = ("Tclin", "Tchem", "Tbio", "Tdark")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def parse_target(response: Any) -> dict[str, Any] | None:
    """Return the ``target`` object of a Pharos GraphQL response, or None when unmapped."""
    if not isinstance(response, dict):
        return None
    target = (response.get("data") or {}).get("target")
    if not isinstance(target, dict):
        return None
    tdl = target.get("tdl")
    return {
        "tdl": tdl if tdl in TDLS else None,
        "fam": target.get("fam"),
        "novelty": target.get("novelty"),
        "pharos_symbol": target.get("sym"),
        "pharos_uniprot": target.get("uniprot"),
    }


def _fetch_one(accession: str) -> str:
    path = CACHE / f"{accession}.json"
    if path.exists():
        return "cached"
    body = json.dumps({"query": QUERY % accession}).encode()
    for attempt in range(5):
        try:
            req = urllib.request.Request(API, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as resp:
                payload = json.load(resp)
            if payload.get("errors") and not (payload.get("data") or {}).get("target"):
                raise RuntimeError(str(payload["errors"])[:200])
            break
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)
    CACHE.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"accession": accession, "retrieved_at": _now(), "query": QUERY % accession,
                               "response": payload}), encoding="utf-8")
    tmp.replace(path)
    return "fetched"


def fetch(db) -> dict[str, int]:
    accessions = sorted(db.kinases.distinct("uniprot_id"))
    with ThreadPoolExecutor(4) as pool:
        results = list(pool.map(_fetch_one, accessions))
    return {"accessions": len(accessions), "fetched": results.count("fetched"), "cached": results.count("cached")}


def tdl_counts(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts = Counter(r["tdl"] or "unmapped" for r in rows)
    return {key: counts.get(key, 0) for key in (*TDLS, "unmapped")}


def run(db, apply: bool) -> dict[str, Any]:
    kinases = list(db.kinases.find({}, {"gene_symbol": 1, "uniprot_id": 1, "catalog_membership": 1}))
    docs, uncached = [], []
    for kinase in kinases:
        acc = kinase["uniprot_id"]
        path = CACHE / f"{acc}.json"
        if not path.exists():
            uncached.append(kinase["gene_symbol"])
            continue
        cached = json.loads(path.read_text())
        target = parse_target(cached.get("response")) or {}
        docs.append({
            "gene_symbol": kinase["gene_symbol"],
            "uniprot_id": acc,
            "tdl": target.get("tdl"),
            "fam": target.get("fam"),
            "novelty": target.get("novelty"),
            "pharos_symbol": target.get("pharos_symbol"),
            "url": f"https://pharos.nih.gov/targets/{acc}",
            "retrieved_at": cached["retrieved_at"],
            "source": "pharos",
            "_membership": kinase.get("catalog_membership"),
        })
    if uncached:
        raise RuntimeError(f"Pharos cache incomplete: {uncached[:10]} ({len(uncached)})")
    summary = {
        "entries": len(docs),
        "all": tdl_counts(docs),
        "core": tdl_counts([d for d in docs if d["_membership"] == "kinhub_core"]),
        "unmapped": sorted(d["gene_symbol"] for d in docs if not d["tdl"]),
        "symbol_differs": sorted((d["gene_symbol"], d["pharos_symbol"]) for d in docs
                                 if d["pharos_symbol"] and d["pharos_symbol"] != d["gene_symbol"]),
    }
    for d in docs:
        del d["_membership"]
    if apply:
        db.pharos_targets.delete_many({})
        db.pharos_targets.insert_many(docs, ordered=False)
        db.pharos_targets.create_index("gene_symbol", unique=True)
        db.pharos_targets.create_index("uniprot_id", unique=True)
        db.pharos_targets.create_index("tdl")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", help="query Pharos and fill the cache")
    parser.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    db = MongoClient(settings.db.uri)[settings.db.db_name]
    if args.fetch:
        logger.info("FETCH: %s", fetch(db))
    logger.info("%s pharos: %s", "APPLIED" if args.apply else "DRY RUN", run(db, args.apply))


if __name__ == "__main__":
    main()
