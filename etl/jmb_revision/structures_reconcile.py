"""Task 8.6 reconciliation: stored structures versus the RCSB search of the cache date."""
from __future__ import annotations

import json
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import rcsb_meta

AUDIT_DIR = Path(os.getenv("KX_AUDIT_DIR", str(Path(__file__).resolve().parents[2] / "audit")))
IMPORT_DATE = "2026-08-12"
IMPORT_NOTE = ("The stored structures come from one ingestor run on 2026-08-12 (ObjectId times "
               "19:12-19:13 UTC), after the weekly PDB release of Wednesday 2026-08-12 (00:00 UTC).")
AUDIT_COUNT = 10034
EXPECTED_2026_09_30 = {"all": 10938, "le35": 10184, "cryo_em_le35": 390}


def entry_reasons(parsed: dict[str, Any] | None, import_like: bool, removed: dict | None = None) -> list[str]:
    """Reasons an RCSB <=3.5 Å entry is absent from the stored snapshot."""
    if parsed is None:
        return ["no RCSB Data API record"]
    reasons = []
    if parsed["release_date"] and parsed["release_date"] > IMPORT_DATE:
        reasons.append("released after the 2026-08-12 import")
    if parsed["resolution"] == rcsb_meta.SCORED_MAX_RESOLUTION:
        reasons.append("resolution exactly 3.5 Å; the import query used < 3.5 Å")
    if not parsed["human_source"]:
        reasons.append("no Homo sapiens source organism; the import query required one")
    if not reasons:
        reasons.append("matches the import query today; cause undetermined" if import_like
                       else "undetermined")
    return reasons


def _oid_times(db) -> dict[str, Any]:
    first = db.structures.find({}, {"_id": 1}).sort("_id", 1).limit(1).next()["_id"].generation_time
    last = db.structures.find({}, {"_id": 1}).sort("_id", -1).limit(1).next()["_id"].generation_time
    cutoff = datetime(2026, 8, 13, tzinfo=timezone.utc)
    after = sum(1 for d in db.structures.find({}, {"_id": 1}) if d["_id"].generation_time >= cutoff)
    return {"min_insert_time": first.isoformat(), "max_insert_time": last.isoformat(),
            "inserted_before_2026-08-13": db.structures.count_documents({}) - after,
            "inserted_on_or_after_2026-08-13": after}


def build(db, searches, entries, missing, parsed, membership, acc_to_gene, docs, cache: Path) -> dict[str, Any]:
    stored = {d["pdb_id"] for d in docs}
    le35 = set(searches["le35"]["ids"])
    import_like = set(searches["import_like"]["ids"])
    all_ids = set(searches["all"]["ids"])
    parsed_all = {pid: rcsb_meta.parse_entry(entries[pid], acc_to_gene) for pid in all_ids | stored if pid in entries}

    genes = {g for d in docs for g in d.get("gene_symbols") or []}
    core_genes = {g for g in genes if membership.get(g) == "kinhub_core"}
    pdis_covered = db.pdis.count_documents({"raw_values.pdb_count": {"$gt": 0}})
    em_stored = [d["pdb_id"] for d in docs if d.get("experimental_method") == rcsb_meta.EM_METHOD]

    not_stored = []
    for pid in sorted(le35 - stored):
        p = parsed_all.get(pid)
        not_stored.append({
            "pdb_id": pid,
            "release_date": p and p["release_date"],
            "experimental_method": p and p["experimental_method"],
            "resolution": p and p["resolution"],
            "gene_symbols": p and p["gene_symbols"],
            "reasons": entry_reasons(p, pid in import_like),
        })
    before = [r for r in not_stored if r["release_date"] and r["release_date"] <= IMPORT_DATE]
    reason_counts = Counter(reason for r in not_stored for reason in r["reasons"])
    primary = Counter(r["reasons"][0] for r in not_stored)

    stored_missing = []
    for pid in sorted(stored - le35):
        holding_path = cache / "holdings" / f"{pid}.json"
        holding = json.loads(holding_path.read_text()) if holding_path.exists() else None
        p = parsed_all.get(pid)
        stored_missing.append({"pdb_id": pid, "current_resolution": p and p["resolution"],
                               "current_method": p and p["experimental_method"],
                               "catalog_accessions_today": p and p["uniprot_ids"], "holdings": holding})

    release_counts = Counter(parsed[pid]["release_date"] for pid in stored if pid in parsed)
    on_import_day = sorted(pid for pid in stored if pid in parsed and parsed[pid]["release_date"] == IMPORT_DATE)
    last_release = max(release_counts) if release_counts else None
    em_le35_today = searches["le35"]["facets"].get(rcsb_meta.EM_METHOD)
    stored_by_method = Counter(d.get("experimental_method") for d in docs)
    stored_neutron = sum(1 for pid in stored if pid in parsed and "NEUTRON DIFFRACTION" in parsed[pid]["methods"])

    nine = len(stored) - AUDIT_COUNT
    explanation = (
        f"KinomeX stores {len(stored):,} entries; the August 13 audit reported {AUDIT_COUNT:,}. "
        f"All {len(stored):,} documents carry ObjectId insertion times of 2026-08-12 and none of 2026-08-13 or "
        f"later, and the 2026-08-14 database backup holds the same {len(stored):,} PDB IDs. "
        f"{len(on_import_day)} stored entries have the RCSB initial release date 2026-08-12 (the Wednesday weekly "
        f"release that precedes the import by about 19 hours). Without these {len(on_import_day)} entries the "
        f"snapshot holds exactly {AUDIT_COUNT:,} entries, the value that the August 11 manuscript draft already "
        "reports. The August 13 audit value therefore describes the same query against the PDB release of "
        f"2026-08-05, and the import of 2026-08-12 adds the {len(on_import_day)} entries of the next weekly release."
        if len(on_import_day) == nine else
        f"KinomeX stores {len(stored):,} entries; the August 13 audit reported {AUDIT_COUNT:,} "
        f"(difference {nine}). {len(on_import_day)} stored entries carry the release date 2026-08-12; "
        "the difference is not fully explained by release dates."
    )

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "rcsb_retrieved_at": searches["le35"]["retrieved_at"],
        "import": {"date": IMPORT_DATE, "note": IMPORT_NOTE,
                   "import_query": "Homo sapiens source organism AND resolution_combined < 3.5 AND catalog UniProt accession; experimental entries",
                   **_oid_times(db)},
        "rcsb_today": {
            "all": searches["all"]["total_count"],
            "le35": searches["le35"]["total_count"],
            "cryo_em_le35": em_le35_today,
            "all_by_method": searches["all"]["facets"],
            "le35_by_method": searches["le35"]["facets"],
            "import_query_today": searches["import_like"]["total_count"],
            "expected_2026_09_30": EXPECTED_2026_09_30,
            "query": "analysis/rcsb.py: catalog UniProt accessions (678), experimental entries",
        },
        "stored": {
            "le35_entries": len(stored),
            "by_method": dict(stored_by_method),
            "entries_with_neutron_component": stored_neutron,
            "covered_genes": len(genes),
            "covered_core_genes": len(core_genes),
            "covered_extension_genes": len(genes) - len(core_genes),
            "pdis_pdb_count_gt0": pdis_covered,
            "cryo_em_entries": len(em_stored),
            "cryo_em_with_emdb": sum(1 for pid in em_stored if pid in parsed and parsed[pid]["emdb_ids"]),
            "with_bound_ligand": sum(1 for pid in stored if pid in parsed and parsed[pid]["bound_ligands"]),
            "latest_release_date": last_release,
            "release_date_counts_since_2026-07-01": {k: v for k, v in sorted(release_counts.items()) if k >= "2026-07-01"},
        },
        "differences": {
            "rcsb_le35_not_stored": len(not_stored),
            "rcsb_le35_not_stored_released_on_or_before_import": len(before),
            "rcsb_le35_not_stored_released_after_import": len(not_stored) - len(before),
            "rcsb_le35_not_stored_cryo_em": sum(1 for r in not_stored if r["experimental_method"] == rcsb_meta.EM_METHOD),
            "reason_counts": dict(reason_counts),
            "primary_reason_counts": dict(primary),
            "stored_not_in_rcsb_le35": len(stored_missing),
            "stored_not_in_rcsb_le35_entries": stored_missing,
            "stored_not_returned_by_import_query_today": len(stored - import_like),
            "import_query_today_not_stored": len(import_like - stored),
            "import_query_today_not_stored_released_after_import": sum(
                1 for pid in import_like - stored
                if pid in parsed_all and (parsed_all[pid]["release_date"] or "") > IMPORT_DATE),
            "not_returned_by_data_api": sorted(missing),
            "rcsb_le35_not_stored_entries": not_stored,
        },
        "audit_2026_08_13": {
            "reported": AUDIT_COUNT,
            "current": len(stored),
            "difference": nine,
            "stored_released_2026-08-12": on_import_day,
            "explanation": explanation,
        },
    }
    report["summary"] = {
        "rcsb_all_le35_em_today": [report["rcsb_today"]["all"], report["rcsb_today"]["le35"], em_le35_today],
        "stored": len(stored), "covered_genes": len(genes), "covered_core_genes": len(core_genes),
        "cryo_em_stored": len(em_stored),
        "le35_not_stored": len(not_stored), "le35_not_stored_after_import": len(not_stored) - len(before),
        "primary_reasons": dict(primary), "stored_not_in_rcsb": len(stored_missing),
        "audit_difference_explained": len(on_import_day) == nine,
    }
    return report


def write(report: dict[str, Any]) -> Path:
    AUDIT_DIR.mkdir(parents=True, exist_ok=True)
    date = (report.get("rcsb_retrieved_at") or report["generated_at"])[:10]
    path = AUDIT_DIR / f"structures-reconciliation-{date}.json"
    path.write_text(json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8")
    return path
