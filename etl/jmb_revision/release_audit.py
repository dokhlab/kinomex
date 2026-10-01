"""Release database audit (JMB revision Task 12.1).

    python -m etl.jmb_revision.release_audit --output audit/database-audit-2026-09-30.json
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, timezone

from pymongo import MongoClient

from ..config import settings
from . import pdis_v3


def audit(db) -> dict:
    catalog = {d["gene_symbol"]: d for d in db.kinases.find({}, {"gene_symbol": 1, "catalog_membership": 1, "group": 1, "extension_class": 1})}
    genes = set(catalog)
    core = {g for g, d in catalog.items() if d.get("catalog_membership") == "kinhub_core"}

    def gene_cov(collection: str, field: str, query: dict | None = None) -> dict:
        present = set(db[collection].distinct(field, query or {}))
        linked = present & genes
        return {"entries_with_records": len(linked), "gap": len(genes - linked), "core_entries_with_records": len(linked & core),
                "orphan_gene_keys": sorted(present - genes)[:50], "orphan_gene_key_count": len(present - genes)}

    pdis = list(db.pdis.find({}, {"_id": 0, "gene_symbol": 1, "pdis_total": 1, "formula_version": 1, "components": 1, "raw_values": 1}))
    totals = sorted(p["pdis_total"] for p in pdis)
    reproduced = sum(1 for p in pdis if abs(pdis_v3.stored_total(p["components"]) - p["pdis_total"]) < 1e-9)
    clinvar = {"source": "clinvar"}
    reps = db.ligand_representatives

    out = {
        "database": db.name,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "collections": {name: db[name].estimated_document_count() for name in sorted(db.list_collection_names()) if not name.startswith("system.")},
        "catalog": {
            "entries": len(genes), "core": len(core), "extensions": len(genes - core),
            "core_groups": dict(Counter(catalog[g].get("group") for g in core)),
            "extension_classes": dict(Counter(catalog[g].get("extension_class") for g in genes - core)),
            "extensions_with_group": sum(1 for g in genes - core if catalog[g].get("group")),
        },
        "pdis": {
            "documents": len(pdis), "formula_versions": dict(Counter(p.get("formula_version") for p in pdis)),
            "min": totals[0], "max": totals[-1], "median": totals[len(totals) // 2] if len(totals) % 2 else (totals[len(totals) // 2 - 1] + totals[len(totals) // 2]) / 2,
            "zero_entries": sum(1 for t in totals if t == 0), "entries_ge_50": sum(1 for t in totals if t >= 50),
            "totals_reproduced_from_components": reproduced,
            "compound_input_max": max(p["raw_values"]["distinct_compound_count"] for p in pdis),
            "entries_with_compounds": sum(1 for p in pdis if p["raw_values"]["distinct_compound_count"] > 0),
        },
        "structures": {"records": db.structures.count_documents({}), "by_method": dict(Counter(d.get("experimental_method") for d in db.structures.find({}, {"experimental_method": 1}))),
                       "with_bound_ligands": db.structures.count_documents({"bound_ligands.0": {"$exists": True}}),
                       "with_emdb": db.structures.count_documents({"emdb_ids.0": {"$exists": True}}),
                       "coverage": gene_cov("structures", "gene_symbols"),
                       "other_entries_not_scored": db.structures_other.count_documents({})},
        "alphafold": {"models": db.alphafold_models.count_documents({}), "coverage": gene_cov("alphafold_models", "gene_symbol")},
        "ligands": {
            "bioactivity_records": db.bioactivities.count_documents({}),
            "catalog_records_by_source": {r["_id"]: r["n"] for r in reps.aggregate([{"$group": {"_id": "$source", "n": {"$sum": "$assay_count"}}}])},
            "representative_rows": reps.count_documents({}),
            "legacy_default_binding_label_rows": reps.count_documents({"binding_mode": "Orthosteric Type I"}),
            "rows_with_binding_mode": reps.count_documents({"binding_mode": {"$ne": None}}),
            "coverage": gene_cov("ligand_representatives", "gene_symbol"),
        },
        "expression": {"gtex_records": db.expression.count_documents({"source": "gtex"}), "non_gtex_records_in_views": db.expression.count_documents({"source": {"$ne": "gtex"}}),
                       "quarantined": db.expression_quarantine.count_documents({}), "quarantined_genes": len(db.expression_quarantine.distinct("gene_symbol")),
                       "coverage": gene_cov("expression", "gene_symbol", {"source": "gtex"})},
        "variants": {
            "clinvar_records": db.variants.count_documents(clinvar), "clinvar_genes": len(db.variants.distinct("gene_symbol", clinvar)),
            "clinvar_placeholder_not_provided": db.variants.count_documents({**clinvar, "pathogenicity": "Not provided"}),
            "clinvar_with_accession": db.variants.count_documents({**clinvar, "clinvar_accession": {"$nin": [None, ""]}}),
            "clinvar_by_classification": {r["_id"]: r["n"] for r in db.variants.aggregate([{"$match": clinvar}, {"$group": {"_id": "$germline_classification", "n": {"$sum": 1}}}])},
            "curated_records": db.variants.count_documents({"source": "curated"}), "curated_genes": len(db.variants.distinct("gene_symbol", {"source": "curated"})),
            "curated_gatekeeper_flags": db.variants.count_documents({"source": "curated", "is_gatekeeper": True}),
            "curated_citations_verified": db.variants.count_documents({"source": "curated", "citation_check.pmid_resolves": True, "$or": [{"citation_check.names_gene": True}, {"citation_check.names_mutation": True}]}),
            "kinases_with_gatekeeper": db.kinases.count_documents({"gatekeeper": {"$ne": None}}),
        },
        "diseases": {"documents": db.diseases.count_documents({}), "coverage": gene_cov("diseases", "gene_symbol")},
        "pharos": {"tdl": dict(Counter(d.get("tdl") for d in db.pharos_targets.find({}, {"tdl": 1})))},
    }
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    db = MongoClient(settings.db.uri)[settings.db.db_name]
    result = audit(db)
    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, default=str)
    print(json.dumps({k: result[k] for k in ("catalog", "pdis")}, indent=1, default=str))


if __name__ == "__main__":
    main()
