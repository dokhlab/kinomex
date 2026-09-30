"""JMB revision data-model migration (Tasks 2, 3 and 6).

Run inside the ETL image:

    python -m etl.jmb_revision.migrate --step all            # dry run, prints the plan
    python -m etl.jmb_revision.migrate --step all --apply    # writes the changes

Each step is idempotent. The PDIS step keeps the stored PubMed, trial and
structure inputs (retrieved August 12, 2026) and changes only the compound input,
the compound component, the total scale, and the formula version.
"""
from __future__ import annotations

import argparse
import csv
import logging
import statistics
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pymongo import MongoClient, UpdateOne

from ..config import settings
from . import pdis_v3

logger = logging.getLogger("kinomex.jmb_revision")
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
EXTENSION_CSV = DATA_DIR / "extension_classes.csv"

EXTENSION_CLASSES = (
    "Protein kinase outside KinHub roster",
    "Lipid kinase",
    "Inositol phosphate kinase",
    "Nucleotide, nucleoside or nucleic-acid kinase",
    "Carbohydrate or central-metabolism kinase",
    "Cofactor, amino-acid or other small-molecule kinase",
    "Keyword-annotated entry without established kinase catalytic role",
)
QUARANTINE_REASON = "no GTEx identifier or source record"


def load_extension_classes(path: Path = EXTENSION_CSV) -> dict[str, dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        rows = {row["gene_symbol"]: row for row in csv.DictReader(handle)}
    unknown = {row["extension_class"] for row in rows.values()} - set(EXTENSION_CLASSES)
    if unknown:
        raise ValueError(f"Unknown extension classes: {sorted(unknown)}")
    return rows


# ---------------------------------------------------------------------------
# Task 2: extension classes
# ---------------------------------------------------------------------------

def migrate_extension_classes(db, apply: bool) -> dict[str, Any]:
    classes = load_extension_classes()
    extension_docs = {
        doc["gene_symbol"]: doc
        for doc in db.kinases.find(
            {"catalog_membership": "uniprot_extended"},
            {"gene_symbol": 1, "uniprot_id": 1, "group": 1, "legacy_displayed_group": 1},
        )
    }
    if set(classes) != set(extension_docs):
        raise RuntimeError(
            "Extension roster mismatch: "
            f"csv_only={sorted(set(classes) - set(extension_docs))} "
            f"db_only={sorted(set(extension_docs) - set(classes))}"
        )
    accession_mismatch = [
        gene for gene, row in classes.items() if row["uniprot_id"] != extension_docs[gene]["uniprot_id"]
    ]
    if accession_mismatch:
        raise RuntimeError(f"Extension accession mismatch: {accession_mismatch}")

    ops = []
    for gene, row in classes.items():
        doc = extension_docs[gene]
        legacy = doc.get("legacy_displayed_group") or doc.get("group") or row["legacy_displayed_group"]
        ops.append(UpdateOne({"_id": doc["_id"]}, {"$set": {
            "group": None,
            "legacy_displayed_group": legacy,
            "extension_class": row["extension_class"],
            "extension_class_basis": row["classification_basis"],
        }}))
    counts: dict[str, int] = {}
    for row in classes.values():
        counts[row["extension_class"]] = counts.get(row["extension_class"], 0) + 1
    if apply:
        db.kinases.bulk_write(ops, ordered=False)
        db.kinases.update_many(
            {"catalog_membership": "kinhub_core"},
            {"$set": {"extension_class": None, "extension_class_basis": None}},
        )
    return {"extension_entries": len(ops), "class_counts": counts}


# ---------------------------------------------------------------------------
# Task 3: PDIS v3
# ---------------------------------------------------------------------------

def distinct_compound_counts(db) -> dict[str, int]:
    """Distinct source compound identifiers per gene (= representative ligand rows)."""
    counts: dict[str, int] = {}
    pipeline = [
        {"$group": {"_id": {
            "gene": "$target_gene_symbol",
            "source": {"$ifNull": ["$source", "unknown"]},
            "compound": {"$ifNull": ["$compound_id", {"$toString": {"$ifNull": ["$pubchem_cid", "unknown"]}}]},
        }}},
        {"$group": {"_id": "$_id.gene", "n": {"$sum": 1}}},
    ]
    for row in db.bioactivities.aggregate(pipeline, allowDiskUse=True):
        if row["_id"]:
            counts[str(row["_id"])] = int(row["n"])
    return counts


def compute_pdis_v3(pdis_docs: list[dict[str, Any]], compound_counts: dict[str, int]) -> list[dict[str, Any]]:
    genes = [doc["gene_symbol"] for doc in pdis_docs]
    n_max = max(int(doc["raw_values"]["pubmed_publication_count"] or 0) for doc in pdis_docs)
    c_max = max((compound_counts.get(gene, 0) for gene in genes), default=0)
    results = []
    for doc in pdis_docs:
        raw = dict(doc["raw_values"])
        raw["distinct_compound_count"] = compound_counts.get(doc["gene_symbol"], 0)
        comps = pdis_v3.components(raw, n_max, c_max)
        results.append({
            "gene_symbol": doc["gene_symbol"],
            "raw_values": raw,
            "components": comps,
            "pdis_total": pdis_v3.stored_total(comps),
            "_unrounded": pdis_v3.weighted_total(comps),
            "normalisation": {"n_max": n_max, "c_max": c_max},
        })
    # Ranks follow the unrounded weighted mean; exact ties share the integer part
    # of their average rank (scipy.stats.rankdata "average", as in analysis.py).
    ordered = sorted(results, key=lambda r: (-r["_unrounded"], r["gene_symbol"]))
    start = 0
    while start < len(ordered):
        end = start
        while end + 1 < len(ordered) and abs(ordered[end + 1]["_unrounded"] - ordered[start]["_unrounded"]) <= 1e-9:
            end += 1
        for row in ordered[start:end + 1]:
            row["rank_default"] = int((start + end + 2) / 2)
        start = end + 1
    for row in results:
        del row["_unrounded"]
    return results


def migrate_pdis(db, apply: bool) -> dict[str, Any]:
    pdis_docs = list(db.pdis.find({}))
    catalog = set(db.kinases.distinct("gene_symbol"))
    if {doc["gene_symbol"] for doc in pdis_docs} != catalog:
        raise RuntimeError("PDIS documents do not cover the catalog one-to-one")
    counts = distinct_compound_counts(db)
    results = compute_pdis_v3(pdis_docs, counts)
    now = datetime.now(timezone.utc)
    totals = sorted(r["pdis_total"] for r in results)
    top = sorted(results, key=lambda r: r["rank_default"])[:10]
    summary = {
        "entries": len(results),
        "n_max": results[0]["normalisation"]["n_max"],
        "c_max": results[0]["normalisation"]["c_max"],
        "min": totals[0],
        "max": totals[-1],
        "median": statistics.median(totals),
        "zero_entries": sorted(r["gene_symbol"] for r in results if r["pdis_total"] == 0),
        "entries_ge_50": sum(1 for t in totals if t >= 50),
        "top10": [(r["gene_symbol"], r["pdis_total"]) for r in top],
        "compound_count_gt0": sum(1 for r in results if r["raw_values"]["distinct_compound_count"] > 0),
    }
    if apply:
        already = db.pdis.count_documents({"formula_version": pdis_v3.FORMULA_VERSION})
        if already == 0:
            db.pdis_history.insert_one({
                "run_id": f"pre-{pdis_v3.FORMULA_VERSION}",
                "archived_at": now,
                "reason": "JMB revision: compound component and 0-100 total scale",
                "records": [{k: v for k, v in doc.items() if k != "_id"} for doc in pdis_docs],
            })
        ops = [UpdateOne({"gene_symbol": r["gene_symbol"]}, {"$set": {
            "raw_values": r["raw_values"],
            "components": r["components"],
            "pdis_total": r["pdis_total"],
            "rank_default": r["rank_default"],
            "normalisation": r["normalisation"],
            "weights": dict(pdis_v3.DEFAULT_WEIGHTS),
            "formula_version": pdis_v3.FORMULA_VERSION,
            "scale": "0-100",
            "compound_input_source": "bioactivities: distinct (source, compound identifier) per gene",
            "compound_input_updated_at": now,
            "source_urls.compounds": "https://www.ebi.ac.uk/chembl/ and https://pubchem.ncbi.nlm.nih.gov/bioassay/1433",
        }}) for r in results]
        db.pdis.bulk_write(ops, ordered=False)
        db.pdis_runs.insert_one({
            "run_id": f"jmb-{pdis_v3.FORMULA_VERSION}-{now:%Y%m%dT%H%M%S}",
            "promoted_at": now,
            "candidate_count": len(results),
            "previous_count": len(pdis_docs),
            "score_version": pdis_v3.FORMULA_VERSION,
        })
    return summary


# ---------------------------------------------------------------------------
# Task 6: expression quarantine
# ---------------------------------------------------------------------------

def migrate_expression(db, apply: bool) -> dict[str, Any]:
    selector = {"source": {"$ne": "gtex"}}
    rows = list(db.expression.find(selector))
    genes = sorted({row["gene_symbol"] for row in rows})
    if apply and rows:
        now = datetime.now(timezone.utc)
        db.expression_quarantine.insert_many([
            {**row, "quarantine_reason": QUARANTINE_REASON, "quarantined_at": now}
            for row in rows
        ], ordered=False)
        db.expression.delete_many({"_id": {"$in": [row["_id"] for row in rows]}})
    gtex_records = db.expression.count_documents({"source": "gtex"})
    return {
        "moved_rows": len(rows),
        "moved_genes": len(genes),
        "quarantine_total": db.expression_quarantine.count_documents({}),
        "gtex_records": gtex_records,
        "gtex_genes": len(db.expression.distinct("gene_symbol", {"source": "gtex"})),
    }


# ---------------------------------------------------------------------------
# Release metadata (snapshot date shown by the accounting endpoint)
# ---------------------------------------------------------------------------

RELEASE = {
    "snapshot_date": "2026-09-30",
    "release": "v1.1.0-jmb",
    "manuscript": "JMB-D-26-01062",
    "pdis_evidence_retrieved": "2026-08-12",
}


def migrate_release_metadata(db, apply: bool) -> dict[str, Any]:
    if apply:
        db.catalog_metadata.update_one(
            {"_id": "release"},
            {"$set": {**RELEASE, "updated_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
    return dict(RELEASE)


STEPS = {
    "release": migrate_release_metadata,
    "extension": migrate_extension_classes,
    "pdis": migrate_pdis,
    "expression": migrate_expression,
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--step", choices=[*STEPS, "all"], default="all")
    parser.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    db = MongoClient(settings.db.uri)[settings.db.db_name]
    for name, step in STEPS.items():
        if args.step in (name, "all"):
            result = step(db, args.apply)
            logger.info("%s %s: %s", "APPLIED" if args.apply else "DRY RUN", name, result)


if __name__ == "__main__":
    main()
