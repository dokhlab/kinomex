"""JMB revision ligand record handling (Task 5, defects D11-D13).

Run inside the ETL image:

    python -m etl.jmb_revision.ligands --fetch            # fill the cache (resumable)
    python -m etl.jmb_revision.ligands                    # dry run from the cache
    python -m etl.jmb_revision.ligands --apply            # write from the cache

Steps (``--step``):

- provenance:      adds document_chembl_id, pubmed_id and doi to ChEMBL bioactivities
- identifiers:     rebuilds ``compound_identifiers`` (standard InChIKeys)
- representatives: rebuilds ``ligand_representatives`` and writes the audit JSON
- display:         adds the in-range ``display`` measurement to each representative row

The apply step reads only the cache, never the network. Every step is idempotent.
"""
from __future__ import annotations

import argparse
import json
import logging
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pymongo import ASCENDING, InsertOne, MongoClient, UpdateMany, UpdateOne

from ..config import settings
from . import ligands_fetch as fetch
from . import ligands_select as sel

logger = logging.getLogger("kinomex.jmb_revision.ligands")
AUDIT_DIR = Path(__file__).resolve().parents[2] / "audit"
AUDIT_FILE = AUDIT_DIR / "ligand-representatives-2026-09-30.json"
PIPELINE_VERSION = "jmb-2026-09-30"
CHECK_GENE = "CSNK1D"
MECHANISM_LABEL = "ChEMBL mechanism"


def _str_or_none(value: Any) -> str | None:
    if value in (None, ""):
        return None
    return str(value)


def load_provenance() -> tuple[dict[str, str | None], dict[str, dict[str, Any]]]:
    assay_doc = {r["assay_chembl_id"]: r.get("document_chembl_id") for r in fetch.load_batches("assays")}
    documents = {r["document_chembl_id"]: r for r in fetch.load_batches("documents")}
    return assay_doc, documents


# ---------------------------------------------------------------------------
# Step 1: ChEMBL provenance on bioactivities
# ---------------------------------------------------------------------------

def step_provenance(db, apply: bool) -> dict[str, Any]:
    assay_doc, documents = load_provenance()
    counts = {
        row["_id"]: row["n"]
        for row in db.bioactivities.aggregate([
            {"$match": {"source": "chembl"}},
            {"$group": {"_id": "$assay_chembl_id", "n": {"$sum": 1}}},
        ], allowDiskUse=True)
    }
    missing_assays = sorted(set(counts) - set(assay_doc))
    summary: Counter = Counter()
    ops = []
    for assay, n in counts.items():
        doc_id = assay_doc.get(assay)
        doc = documents.get(doc_id or "", {})
        fields = {
            "document_chembl_id": doc_id,
            "pubmed_id": _str_or_none(doc.get("pubmed_id")),
            "doi": _str_or_none(doc.get("doi")),
        }
        summary["records"] += n
        summary["records_with_document"] += n if doc_id else 0
        summary["records_with_pubmed_id"] += n if fields["pubmed_id"] else 0
        summary["records_with_doi"] += n if fields["doi"] else 0
        ops.append(UpdateMany({"source": "chembl", "assay_chembl_id": assay}, {"$set": fields}))
    result = {
        **summary,
        "assays": len(counts),
        "assays_missing_in_chembl": len(missing_assays),
        "documents": len({d for d in assay_doc.values() if d}),
        "documents_fetched": len(documents),
    }
    if apply:
        db.bioactivities.create_index([("assay_chembl_id", ASCENDING)], name="assay_chembl_id_1")
        modified = 0
        for i in range(0, len(ops), 2000):
            modified += db.bioactivities.bulk_write(ops[i:i + 2000], ordered=False).modified_count
        result["modified"] = modified
        result["bioactivities_total"] = db.bioactivities.count_documents({})
    return result


# ---------------------------------------------------------------------------
# Step 2: standard InChIKeys
# ---------------------------------------------------------------------------

def _rdkit_inchikey(smiles: str) -> str | None:
    try:
        from rdkit import Chem, RDLogger  # type: ignore
    except ImportError:
        return None
    RDLogger.DisableLog("rdApp.*")
    mol = Chem.MolFromSmiles(smiles) if smiles else None
    return Chem.MolToInchiKey(mol) or None if mol is not None else None


def build_identifiers(db) -> list[dict[str, Any]]:
    chembl_ids = sorted(db.bioactivities.distinct("compound_id", {"source": "chembl"}))
    chemreps = fetch.load_chemreps_inchikeys(set(chembl_ids))
    pubchem = fetch.load_pubchem()
    docs: list[dict[str, Any]] = []
    missing = [cid for cid in chembl_ids if cid not in chemreps]
    smiles = {}
    if missing:
        for row in db.bioactivities.find(
            {"source": "chembl", "compound_id": {"$in": missing}, "canonical_smiles": {"$nin": ["", None]}},
            {"compound_id": 1, "canonical_smiles": 1},
        ):
            smiles.setdefault(row["compound_id"], row["canonical_smiles"])
    for cid in chembl_ids:
        key, method = chemreps.get(cid), f"ChEMBL {fetch.CHEMBL_RELEASE} standard_inchi_key"
        if key is None:
            key = _rdkit_inchikey(smiles.get(cid, ""))
            method = "RDKit MolToInchiKey from ChEMBL canonical_smiles" if key else None
        docs.append({"compound_key": sel.compound_key("chembl", cid, None), "source": "chembl",
                     "compound_id": cid, "pubchem_cid": None, "inchikey": key, "inchikey_method": method})
    for cid in sorted({int(c) for c in db.bioactivities.distinct("pubchem_cid", {"source": "pubchem"}) if c is not None}):
        key = (pubchem.get(cid) or {}).get("InChIKey")
        docs.append({"compound_key": sel.compound_key("pubchem", None, cid), "source": "pubchem",
                     "compound_id": None, "pubchem_cid": cid, "inchikey": key,
                     "inchikey_method": "PubChem PUG REST InChIKey" if key else None})
    return docs


def _swap_collection(db, name: str, docs, indexes: list[tuple[list, dict]]) -> int:
    build = db[f"{name}_build"]
    build.drop()
    written = 0
    batch = []
    for doc in docs:
        batch.append(InsertOne(doc))
        if len(batch) >= 5000:
            written += build.bulk_write(batch, ordered=False).inserted_count
            batch = []
    if batch:
        written += build.bulk_write(batch, ordered=False).inserted_count
    for keys, opts in indexes:
        build.create_index(keys, **opts)
    build.rename(name, dropTarget=True)
    return written


def step_identifiers(db, apply: bool) -> dict[str, Any]:
    docs = build_identifiers(db)
    result = {
        "compounds": len(docs),
        "by_source": dict(Counter(d["source"] for d in docs)),
        "by_method": dict(Counter(d["inchikey_method"] or "none" for d in docs)),
        "distinct_inchikeys": len({d["inchikey"] for d in docs if d["inchikey"]}),
    }
    if apply:
        now = datetime.now(timezone.utc)
        result["written"] = _swap_collection(
            db, "compound_identifiers", ({**d, "generated_at": now} for d in docs),
            [([("compound_key", ASCENDING)], {"unique": True}), ([("inchikey", ASCENDING)], {})],
        )
    return result


# ---------------------------------------------------------------------------
# Step 3: representative rows
# ---------------------------------------------------------------------------

def load_mechanisms() -> dict[tuple[str, str], dict[str, Any]]:
    index: dict[tuple[str, str], dict[str, Any]] = {}
    for mec in sorted(fetch.load_mechanisms(), key=lambda m: m["mec_id"]):
        if not mec.get("target_chembl_id") or not mec.get("action_type"):
            continue
        for mol in {mec.get("molecule_chembl_id"), mec.get("parent_molecule_chembl_id")} - {None}:
            index.setdefault((mec["target_chembl_id"], mol), mec)
    return index


def _binding_mode(target_ids: set[str], compound_id: str | None, mechanisms) -> dict[str, Any]:
    hits = [mechanisms[(t, compound_id)] for t in sorted(target_ids) if (t, compound_id) in mechanisms]
    if not compound_id or not hits:
        return {"binding_mode": None, "binding_mode_source": None, "mechanism_of_action": None}
    mec = min(hits, key=lambda m: m["mec_id"])
    return {
        "binding_mode": mec["action_type"],
        "binding_mode_source": {
            "label": MECHANISM_LABEL,
            "id": mec["mec_id"],
            "url": sel.CHEMBL_COMPOUND_URL.format(mec["molecule_chembl_id"]),
            "molecule_chembl_id": mec["molecule_chembl_id"],
            "target_chembl_id": mec["target_chembl_id"],
            "refs": [{k: r.get(k) for k in ("ref_type", "ref_id", "ref_url")} for r in mec.get("mechanism_refs") or []],
        },
        "mechanism_of_action": mec.get("mechanism_of_action"),
    }


def _representative(rec: dict[str, Any], assay_doc, documents) -> dict[str, Any]:
    if rec["source"] == "pubchem":
        aid = rec.get("assay_aid")
        return {
            "activity_id": None, "assay_chembl_id": None, "assay_aid": aid, "document_chembl_id": None,
            "pubmed_id": _str_or_none(sel.first_nonempty(rec.get("pubmed_ids") or [])),
            "doi": _str_or_none(rec.get("doi")),
            "journal": _str_or_none(rec.get("document_journal")), "year": rec.get("document_year"),
            "source_url": sel.PUBCHEM_ASSAY_URL.format(aid) if aid else None,
        }
    assay = rec.get("assay_chembl_id")
    doc_id = assay_doc.get(assay)
    doc = documents.get(doc_id or "", {})
    return {
        "activity_id": rec.get("activity_id"), "assay_chembl_id": assay, "assay_aid": None,
        "document_chembl_id": doc_id,
        "pubmed_id": _str_or_none(doc.get("pubmed_id")), "doi": _str_or_none(doc.get("doi")),
        "journal": _str_or_none(doc.get("journal")) or _str_or_none(rec.get("document_journal")),
        "year": doc.get("year") or rec.get("document_year"),
        "source_url": sel.CHEMBL_ASSAY_URL.format(assay) if assay else None,
    }


PROJECTION = {
    "target_gene_symbol": 1, "source": 1, "compound_id": 1, "pubchem_cid": 1, "compound_name": 1,
    "activity_id": 1, "assay_chembl_id": 1, "assay_aid": 1, "assay_type": 1, "standard_relation": 1,
    "standard_value": 1, "target_chembl_id": 1, "pubmed_ids": 1, "doi": 1, "document_journal": 1,
    "document_year": 1,
}


def _gene_rows(gene: str, records: list[dict[str, Any]], ctx: dict[str, Any]) -> list[dict[str, Any]]:
    pairs: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for rec in records:
        pairs[sel.compound_key(rec["source"], rec.get("compound_id"), rec.get("pubchem_cid"))].append(rec)
    inchikeys = ctx["inchikeys"]
    by_key: dict[str, dict[str, list[str]]] = {"chembl": defaultdict(list), "pubchem": defaultdict(list)}
    for key, recs in pairs.items():
        ik = inchikeys.get(key)
        if ik:
            by_key[recs[0]["source"]][ik].append(key)
    rows = []
    for key, recs in pairs.items():
        first = recs[0]
        source = first["source"]
        other = "pubchem" if source == "chembl" else "chembl"
        ik = inchikeys.get(key)
        other_keys = sorted(by_key[other].get(ik, [])) if ik else []
        summary = sel.summarize_pair(recs)
        rep = summary.pop("record")
        compound_id = first.get("compound_id") if source == "chembl" else None
        cid = int(first["pubchem_cid"]) if source == "pubchem" else None
        target_ids = {r.get("target_chembl_id") for r in recs if r.get("target_chembl_id")}
        rows.append({
            "gene_symbol": gene, "source": source, "compound_key": key,
            "compound_id": compound_id, "pubchem_cid": cid,
            "compound_name": sel.first_nonempty(r.get("compound_name") for r in recs),
            "compound_url": (sel.CHEMBL_COMPOUND_URL.format(compound_id) if compound_id
                             else sel.PUBCHEM_COMPOUND_URL.format(cid)),
            "inchikey": ik, "also_in_other_source": bool(other_keys), "other_source_compound_keys": other_keys,
            "target_chembl_ids": sorted(target_ids),
            **summary,
            **(_binding_mode(target_ids, compound_id, ctx["mechanisms"]) if source == "chembl"
               else {"binding_mode": None, "binding_mode_source": None, "mechanism_of_action": None}),
            "representative": _representative(rep, ctx["assay_doc"], ctx["documents"]),
            "pipeline_version": PIPELINE_VERSION,
        })
        if gene == CHECK_GENE:
            ctx["old_rule_rows"].append(sel.select_old_rule(recs))
    return rows


def iter_rows(db, ctx: dict[str, Any]):
    catalog = sorted(db.kinases.distinct("gene_symbol"))
    cursor = db.bioactivities.find(
        {"target_gene_symbol": {"$in": catalog}}, PROJECTION, batch_size=10000,
    ).sort("target_gene_symbol", ASCENDING)
    gene, records = None, []
    for rec in cursor:
        if rec["target_gene_symbol"] != gene:
            if records:
                yield from _gene_rows(gene, records, ctx)
            gene, records = rec["target_gene_symbol"], []
        records.append(rec)
    if records:
        yield from _gene_rows(gene, records, ctx)


def _check_counts(rows: list[dict[str, Any]], uncensored, type_of, value_of) -> dict[str, int]:
    hits = [r for r in rows if uncensored(r) and type_of(r) in sel.POTENCY_CHECK_TYPES]
    return {"uncensored_ic50_ki_kd_ec50": len(hits),
            "of_which_le_10nm": sum(1 for r in hits if (value_of(r) is not None and value_of(r) <= 10))}


def old_rule_check(recs: list[dict[str, Any]]) -> dict[str, Any]:
    typ = lambda r: (r.get("assay_type") or "").upper()  # noqa: E731
    val = lambda r: sel.numeric_value(r.get("standard_value"))  # noqa: E731
    return {
        "rows": len(recs),
        "relation_eq_or_missing": _check_counts(recs, lambda r: r.get("standard_relation") in ("=", None), typ, val),
        "relation_uncensored_set": _check_counts(recs, lambda r: not sel.is_censored(r.get("standard_relation")), typ, val),
        "any_relation": _check_counts(recs, lambda r: True, typ, val),
    }


class Tally:
    def __init__(self) -> None:
        self.rows = 0
        self.c: dict[str, Counter] = defaultdict(Counter)
        self.inchikeys: dict[str, set] = {"chembl": set(), "pubchem": set()}
        self.genes: set[str] = set()
        self.check_rows: list[dict[str, Any]] = []

    def add(self, row: dict[str, Any]) -> None:
        src = row["source"]
        self.rows += 1
        self.genes.add(row["gene_symbol"])
        self.c["rows_by_source"][src] += 1
        self.c["assay_count_by_source"][src] += row["assay_count"]
        self.c["activity_type"][row["activity_type"]] += 1
        self.c["relation"][row["relation"]] += 1
        self.c["relation_original"][str(row["relation_original"])] += 1
        self.c["tier"][str(row["tier"])] += 1
        self.c["censored"][str(row["censored"]).lower()] += 1
        self.c["activity_type_by_source"][f"{src}:{row['activity_type']}"] += 1
        self.c["also_in_other_source"][src] += int(row["also_in_other_source"])
        self.c["binding_mode"][row["binding_mode"] or "not_annotated"] += 1
        self.c["inchikey_present"][src] += int(bool(row["inchikey"]))
        if row["inchikey"]:
            self.inchikeys[src].add(row["inchikey"])
        if row["gene_symbol"] == CHECK_GENE:
            self.check_rows.append(row)

    def report(self, old_rows: list[dict[str, Any]]) -> dict[str, Any]:
        new_check = _check_counts(
            self.check_rows, lambda r: not r["censored"], lambda r: r["activity_type"].upper(), lambda r: r["value_nm"])
        counts = {k: dict(sorted(v.items(), key=lambda kv: (-kv[1], kv[0]))) for k, v in self.c.items()}
        return {
            "total_rows": self.rows,
            "genes_with_rows": len(self.genes),
            "rows_by_source": counts["rows_by_source"],
            "assay_count_sum_by_source": counts["assay_count_by_source"],
            "assay_count_sum": sum(self.c["assay_count_by_source"].values()),
            "rows_by_activity_type": counts["activity_type"],
            "rows_by_activity_type_and_source": counts["activity_type_by_source"],
            "rows_by_relation": counts["relation"],
            "rows_by_relation_original": counts["relation_original"],
            "rows_by_tier": counts["tier"],
            "rows_by_censored": counts["censored"],
            "rows_with_inchikey_by_source": counts["inchikey_present"],
            "pairs_also_in_other_source_by_source": counts["also_in_other_source"],
            "pairs_also_in_other_source": sum(self.c["also_in_other_source"].values()),
            "distinct_inchikeys_in_both_sources": len(self.inchikeys["chembl"] & self.inchikeys["pubchem"]),
            "rows_with_binding_mode": self.rows - self.c["binding_mode"].get("not_annotated", 0),
            "rows_by_binding_mode": counts["binding_mode"],
            "check_gene": {
                "gene_symbol": CHECK_GENE,
                "rows": len(self.check_rows),
                "new_hierarchy": new_check,
                "old_rule": old_rule_check(old_rows),
                "manuscript_old_rule_values": {"uncensored_ic50_ki_kd_ec50": 1808, "of_which_le_10nm": 964},
            },
        }


def step_representatives(db, apply: bool) -> dict[str, Any]:
    started = time.time()
    assay_doc, documents = load_provenance()
    inchikeys = {d["compound_key"]: d["inchikey"] for d in build_identifiers(db) if d["inchikey"]}
    ctx = {"assay_doc": assay_doc, "documents": documents, "inchikeys": inchikeys,
           "mechanisms": load_mechanisms(), "old_rule_rows": []}
    tally = Tally()
    now = datetime.now(timezone.utc)

    def rows():
        for row in iter_rows(db, ctx):
            tally.add(row)
            yield {**row, "generated_at": now}

    if apply:
        _swap_collection(db, "ligand_representatives", rows(), [
            ([("gene_symbol", ASCENDING), ("compound_key", ASCENDING)], {"unique": True}),
            ([("gene_symbol", ASCENDING), ("tier", ASCENDING), ("value_nm", ASCENDING)], {}),
            ([("gene_symbol", ASCENDING), ("censored", ASCENDING)], {}),
            ([("inchikey", ASCENDING)], {}),
        ])
        db.bioactivities.create_index([("target_gene_symbol", ASCENDING), ("compound_id", ASCENDING)])
        db.bioactivities.create_index([("target_gene_symbol", ASCENDING), ("pubchem_cid", ASCENDING)])
    else:
        for _ in rows():
            pass
    report = tally.report(ctx["old_rule_rows"])
    if apply:
        report["collection_count"] = db.ligand_representatives.count_documents({})
        meta_path = fetch.cache_root() / "meta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        audit = {
            "generated_at": now.isoformat(timespec="seconds"),
            "database": settings.db.db_name,
            "pipeline_version": PIPELINE_VERSION,
            "selection_rule": sel.__doc__.strip(),
            "cache": {k: meta.get(k) for k in ("first_retrieved_at", "last_retrieved_at", "chemreps")},
            "chembl_release": (meta.get("chembl_api_status") or {}).get("chembl_db_version"),
            **report,
        }
        AUDIT_DIR.mkdir(parents=True, exist_ok=True)
        AUDIT_FILE.write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
        report["audit_file"] = str(AUDIT_FILE)
    report["seconds"] = round(time.time() - started, 1)
    return report


def _gene_pairs(db, catalog: list[str]):
    """(gene, compound_key, records) for every pair, streamed gene by gene."""
    cursor = db.bioactivities.find(
        {"target_gene_symbol": {"$in": catalog}}, PROJECTION, batch_size=10000,
    ).sort("target_gene_symbol", ASCENDING)
    gene, pairs = None, defaultdict(list)
    for rec in cursor:
        if rec["target_gene_symbol"] != gene:
            yield from ((gene, key, recs) for key, recs in pairs.items())
            gene, pairs = rec["target_gene_symbol"], defaultdict(list)
        pairs[sel.compound_key(rec["source"], rec.get("compound_id"), rec.get("pubchem_cid"))].append(rec)
    yield from ((gene, key, recs) for key, recs in pairs.items())


def display_doc(records: list[dict[str, Any]], assay_doc, documents) -> dict[str, Any] | None:
    summary = sel.display_summary(records)
    if summary is None:
        return None
    rec = summary.pop("record")
    return {**summary, "representative": _representative(rec, assay_doc, documents)}


def step_display(db, apply: bool) -> dict[str, Any]:
    """Representative re-selected inside the reporting range (0 < value <= 10,000 nM).

    The frozen representative fields are left unchanged; the dossier reads ``display``.
    """
    assay_doc, documents = load_provenance()
    catalog = sorted(db.kinases.distinct("gene_symbol"))
    counts: Counter = Counter()
    ops: list[UpdateOne] = []
    modified = 0
    for gene, key, recs in _gene_pairs(db, catalog):
        doc = display_doc(recs, assay_doc, documents)
        counts["pairs"] += 1
        counts["records"] += len(recs)
        if doc is None:
            counts["pairs_without_display"] += 1
            counts["pairs_only_zero_or_missing"] += all((sel.numeric_value(r.get("standard_value")) or 0) <= 0 for r in recs)
        else:
            counts["pairs_with_display"] += 1
            counts["records_in_range"] += doc["in_range_count"]
            rep = sel.summarize_pair(recs)["record"]
            counts["display_differs_from_representative"] += rep is not None and not sel.in_display_range(rep)
        ops.append(UpdateOne({"gene_symbol": gene, "compound_key": key}, {"$set": {"display": doc}}))
        if apply and len(ops) >= 5000:
            modified += db.ligand_representatives.bulk_write(ops, ordered=False).modified_count
            ops = []
    if apply:
        if ops:
            modified += db.ligand_representatives.bulk_write(ops, ordered=False).modified_count
        db.ligand_representatives.create_index(
            [("gene_symbol", ASCENDING), ("display.tier", ASCENDING), ("display.value_nm", ASCENDING)],
            name="gene_display_tier_value")
        counts["modified"] = modified
        counts["rows_missing_display_field"] = db.ligand_representatives.count_documents({"display": {"$exists": False}})
    counts["display_max_nm"] = sel.DISPLAY_MAX_NM
    return dict(counts)


STEPS = {
    "provenance": step_provenance,
    "identifiers": step_identifiers,
    "representatives": step_representatives,
    "display": step_display,
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--step", choices=[*STEPS, "all"], default="all")
    parser.add_argument("--fetch", action="store_true", help="fill the cache from ChEMBL and PubChem")
    parser.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    db = MongoClient(settings.db.uri)[settings.db.db_name]
    logger.info("database %s", settings.db.db_name)
    if args.fetch:
        fetch.fetch_all(db)
        return
    for name, step in STEPS.items():
        if args.step in (name, "all"):
            started = time.time()
            result = step(db, args.apply)
            logger.info("%s %s (%.0fs): %s", "APPLIED" if args.apply else "DRY RUN", name,
                        time.time() - started, json.dumps(result, default=str))


if __name__ == "__main__":
    main()
