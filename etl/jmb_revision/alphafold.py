"""AlphaFold DB model links for the 678 catalog entries (Task 8.5).

Run inside the ETL image:

    python -m etl.jmb_revision.alphafold --fetch     # AlphaFold DB API -> cache
    python -m etl.jmb_revision.alphafold             # dry run from the cache
    python -m etl.jmb_revision.alphafold --apply     # rebuilds alphafold_models

The apply step reads $KX_CACHE/alphafold/<accession>.json only. It keeps the
canonical-accession model (``AF-<UniProt>-F1``; isoform models are ignored) and
stores one document per catalog entry that has a model. Entries without a model
are reported, not stored as zeros.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pymongo import MongoClient

from ..config import settings

logger = logging.getLogger("kinomex.jmb_revision.alphafold")
CACHE = Path(os.getenv("KX_CACHE", "/home/html/storage/kinomex/jmb_revision_cache")) / "alphafold"
API = "https://alphafold.ebi.ac.uk/api/prediction/{}"
NO_MODEL = "No AlphaFold DB model available"
_FRAGMENT = re.compile(r"^AF-(?P<acc>.+)-F(?P<n>\d+)$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def fragment_number(entry_id: str, accession: str) -> int | None:
    match = _FRAGMENT.match(entry_id or "")
    if not match or match.group("acc").upper() != accession.upper():
        return None
    return int(match.group("n"))


def select_model(accession: str, response: Any) -> dict[str, Any] | None:
    """Pick the canonical F1 model (or the single/lowest fragment) for ``accession``."""
    if not isinstance(response, list):
        return None
    canonical = []
    for item in response:
        if not isinstance(item, dict):
            continue
        if str(item.get("uniprotAccession") or "").upper() != accession.upper():
            continue
        n = fragment_number(str(item.get("entryId") or ""), accession)
        if n is not None:
            canonical.append((n, item))
    if not canonical:
        return None
    canonical.sort(key=lambda pair: (pair[0], -(pair[1].get("latestVersion") or 0)))
    item = canonical[0][1]
    fragments = len({n for n, _ in canonical})
    return {
        "entry_id": item.get("entryId"),
        "model_version": item.get("latestVersion"),
        "global_plddt": item.get("globalMetricValue"),
        "uniprot_start": item.get("uniprotStart"),
        "uniprot_end": item.get("uniprotEnd"),
        "cif_url": item.get("cifUrl"),
        "pdb_url": item.get("pdbUrl"),
        "pae_image_url": item.get("paeImageUrl"),
        "fragments": fragments if fragments > 1 else None,
        "model_created_date": item.get("modelCreatedDate"),
    }


def isoform_models(accession: str, response: Any) -> list[str]:
    """Entry IDs of isoform-only models (e.g. AF-Q15772-4-F1) returned for ``accession``."""
    if not isinstance(response, list):
        return []
    prefix = f"{accession.upper()}-"
    return sorted(str(item.get("entryId")) for item in response if isinstance(item, dict)
                  and str(item.get("uniprotAccession") or "").upper().startswith(prefix))


def _fetch_one(accession: str) -> str:
    path = CACHE / f"{accession}.json"
    if path.exists():
        return "cached"
    status, body = None, None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(API.format(accession), timeout=60) as resp:
                status, body = resp.status, json.load(resp)
            break
        except urllib.error.HTTPError as exc:
            if exc.code in (400, 404, 422):
                status, body = exc.code, None
                break
            if attempt == 3:
                raise
        except Exception:
            if attempt == 3:
                raise
        time.sleep(2 ** attempt)
    CACHE.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"accession": accession, "retrieved_at": _now(), "http_status": status,
                               "response": body}), encoding="utf-8")
    tmp.replace(path)
    return "fetched"


def fetch(db) -> dict[str, int]:
    accessions = sorted(db.kinases.distinct("uniprot_id"))
    with ThreadPoolExecutor(4) as pool:
        results = list(pool.map(_fetch_one, accessions))
    return {"accessions": len(accessions), "fetched": results.count("fetched"), "cached": results.count("cached")}


def run(db, apply: bool) -> dict[str, Any]:
    kinases = list(db.kinases.find({}, {"gene_symbol": 1, "uniprot_id": 1, "catalog_membership": 1}))
    docs, missing, uncached, isoform_only = [], [], [], {}
    for kinase in kinases:
        acc = kinase["uniprot_id"]
        path = CACHE / f"{acc}.json"
        if not path.exists():
            uncached.append(kinase["gene_symbol"])
            continue
        cached = json.loads(path.read_text())
        model = select_model(acc, cached.get("response"))
        if not model:
            missing.append(kinase["gene_symbol"])
            isoforms = isoform_models(acc, cached.get("response"))
            if isoforms:
                isoform_only[kinase["gene_symbol"]] = isoforms
            continue
        docs.append({"gene_symbol": kinase["gene_symbol"], "uniprot_id": acc, **model,
                     "retrieved_at": cached["retrieved_at"], "source": "alphafold_db",
                     "url": f"https://alphafold.ebi.ac.uk/entry/{acc}",
                     "note": "Predicted model; not an experimental structure."})
    if uncached:
        raise RuntimeError(f"AlphaFold cache incomplete: {uncached[:10]} ({len(uncached)})")
    core = {k["gene_symbol"] for k in kinases if k.get("catalog_membership") == "kinhub_core"}
    summary = {
        "entries": len(kinases),
        "with_model": len(docs),
        "without_model": len(missing),
        "missing": sorted(missing),
        "missing_with_isoform_models_only": isoform_only,
        "missing_http_404": sorted(set(missing) - set(isoform_only)),
        "core_with_model": sum(1 for d in docs if d["gene_symbol"] in core),
        "multi_fragment": sorted(d["gene_symbol"] for d in docs if d["fragments"]),
        "versions": sorted({d["model_version"] for d in docs}),
    }
    if apply:
        db.alphafold_models.delete_many({})
        if docs:
            db.alphafold_models.insert_many(docs, ordered=False)
        db.alphafold_models.create_index("gene_symbol", unique=True)
        db.alphafold_models.create_index("uniprot_id", unique=True)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", help="query AlphaFold DB and fill the cache")
    parser.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    db = MongoClient(settings.db.uri)[settings.db.db_name]
    if args.fetch:
        logger.info("FETCH: %s", fetch(db))
    logger.info("%s alphafold: %s", "APPLIED" if args.apply else "DRY RUN", run(db, args.apply))


if __name__ == "__main__":
    main()
