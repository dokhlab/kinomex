"""JMB revision Task 7: ClinVar classification fields, KLIFS gatekeepers and curated mutations.

Run inside the ETL image:

    python -m etl.jmb_revision.variants --fetch     # fills the raw cache (resumable)
    python -m etl.jmb_revision.variants             # dry run from the cache, prints the plan
    python -m etl.jmb_revision.variants --apply     # writes from the cache

The apply step reads only the cache under $KX_CACHE/variants, so a later run
against another database uses the same frozen ClinVar, KLIFS and PubMed records.
It adds fields to existing documents and never inserts or deletes variants.
"""
from __future__ import annotations

import argparse
import gzip
import json
import logging
import os
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pymongo import MongoClient, UpdateOne

from ..config import settings
from . import variant_rules as rules

logger = logging.getLogger("kinomex.jmb_revision.variants")
CACHE = Path(os.getenv("KX_CACHE", "/cache")) / "variants"
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
KLIFS_API = "https://klifs.net/api"
CLINVAR_BATCH = 400
EXPECTED_CLINVAR = (63_649, 260)
EXPECTED_CURATED = (87, 36)
USER_AGENT = "KinomeX-JMB-revision/1.0 (kinomex ETL)"


def _http(url: str, data: dict[str, str] | None = None, attempts: int = 5) -> bytes:
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.read()
        except Exception as exc:  # noqa: BLE001
            if attempt == attempts - 1:
                raise
            wait = 2 ** attempt * 2
            logger.warning("request failed (%s); retrying in %ss", exc, wait)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def _ncbi_params(params: dict[str, str]) -> dict[str, str]:
    key = settings.api.pubmed_api_key
    return {**params, "api_key": key} if key else params


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    if path.suffix == ".gz":
        with gzip.open(tmp, "wt", encoding="utf-8") as handle:
            json.dump(payload, handle)
    else:
        tmp.write_text(json.dumps(payload, indent=1, default=str), encoding="utf-8")
    tmp.replace(path)


def _read_json(path: Path) -> Any:
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            return json.load(handle)
    return json.loads(path.read_text(encoding="utf-8"))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------

def clinvar_uids(db) -> list[str]:
    uids = {str(u) for u in db.variants.distinct("clinvar_uid", {"source": "clinvar"}) if u}
    return sorted(uids, key=int)


def fetch_clinvar(db) -> dict[str, Any]:
    uids = clinvar_uids(db)
    out = CACHE / "clinvar"
    batches = [uids[i: i + CLINVAR_BATCH] for i in range(0, len(uids), CLINVAR_BATCH)]
    meta_path = out / "meta.json"
    if not meta_path.exists():
        einfo = json.loads(_http(f"{EUTILS}/einfo.fcgi?" + urllib.parse.urlencode(
            _ncbi_params({"db": "clinvar", "retmode": "json"}))))
        _write_json(meta_path, {
            "retrieved_at": _now(),
            "source": f"{EUTILS}/esummary.fcgi?db=clinvar (POST, retmode=json)",
            "einfo": einfo.get("einforesult", {}).get("dbinfo", einfo),
            "uid_count": len(uids),
            "batch_size": CLINVAR_BATCH,
            "batches": len(batches),
            "note": ("Classifications reflect the ClinVar release current on the retrieval date; "
                     "the August 12, 2026 snapshot stores UIDs and titles without classifications."),
        })
    pause = 0.12 if settings.api.pubmed_api_key else 0.4
    fetched = 0
    for index, batch in enumerate(batches):
        path = out / f"esummary_{index:04d}.json.gz"
        if path.exists() and _read_json(path).get("requested_uids") == batch:
            continue
        raw = json.loads(_http(f"{EUTILS}/esummary.fcgi", _ncbi_params({
            "db": "clinvar", "id": ",".join(batch), "retmode": "json"})))
        _write_json(path, {"retrieved_at": _now(), "requested_uids": batch, "response": raw})
        fetched += 1
        if fetched % 20 == 0:
            logger.info("ClinVar batch %d/%d", index + 1, len(batches))
        time.sleep(pause)
    meta = _read_json(meta_path)
    meta["completed_at"] = _now()
    _write_json(meta_path, meta)
    return {"uids": len(uids), "batches": len(batches), "fetched_now": fetched}


def fetch_klifs() -> dict[str, Any]:
    path = CACHE / "klifs" / "kinase_information_human.json"
    if not path.exists():
        url = f"{KLIFS_API}/kinase_information?species=HUMAN"
        _write_json(path, {"retrieved_at": _now(), "url": url, "response": json.loads(_http(url))})
    return {"klifs_kinases": len(_read_json(path)["response"])}


def curated_pmids(db) -> list[str]:
    return sorted({str(p) for p in db.variants.distinct("pubmed_id", {"source": "curated"}) if p}, key=int)


def fetch_pubmed(db) -> dict[str, Any]:
    pmids = curated_pmids(db)
    path = CACHE / "pubmed" / "efetch.json"
    if not path.exists() or _read_json(path).get("pmids") != pmids:
        url = f"{EUTILS}/efetch.fcgi"
        xml = _http(url, _ncbi_params({"db": "pubmed", "id": ",".join(pmids), "retmode": "xml"}))
        _write_json(path, {"retrieved_at": _now(), "url": url, "pmids": pmids, "xml": xml.decode("utf-8")})
    return {"pmids": len(pmids)}


# ---------------------------------------------------------------------------
# Cache readers
# ---------------------------------------------------------------------------

def load_clinvar_cache() -> tuple[dict[str, Any], dict[str, Any]]:
    out = CACHE / "clinvar"
    meta = _read_json(out / "meta.json")
    summaries: dict[str, Any] = {}
    for path in sorted(out.glob("esummary_*.json.gz")):
        result = _read_json(path)["response"].get("result", {})
        for uid in result.get("uids", []):
            summaries[str(uid)] = result.get(str(uid))
        for key, value in result.items():
            if key != "uids" and key not in summaries and isinstance(value, dict):
                summaries[key] = value
    return meta, summaries


def load_klifs_cache() -> list[dict[str, Any]]:
    return _read_json(CACHE / "klifs" / "kinase_information_human.json")["response"]


def parse_pubmed_xml(xml: str) -> dict[str, dict[str, str]]:
    records = {}
    for article in ET.fromstring(xml).iter("PubmedArticle"):
        pmid = article.findtext(".//MedlineCitation/PMID") or ""
        title_el = article.find(".//Article/ArticleTitle")
        title = "".join(title_el.itertext()).strip() if title_el is not None else ""
        abstract = " ".join("".join(el.itertext()).strip() for el in article.findall(".//Abstract/AbstractText"))
        records[pmid] = {"title": title, "abstract": abstract}
    return records


def load_pubmed_cache() -> dict[str, dict[str, str]]:
    path = CACHE / "pubmed" / "efetch.json"
    return parse_pubmed_xml(_read_json(path)["xml"]) if path.exists() else {}


# ---------------------------------------------------------------------------
# Plan and apply
# ---------------------------------------------------------------------------

def select_klifs_entry(kinase: dict[str, Any], klifs: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Primary (not '-b') KLIFS domain for the UniProt accession, then by HGNC symbol."""
    main = [k for k in klifs if not str(k.get("HGNC", "")).endswith("-b") and not str(k.get("name", "")).endswith("-b")]
    by_acc = [k for k in main if k.get("uniprot") == kinase.get("uniprot_id")]
    if len(by_acc) > 1:
        by_acc = [k for k in by_acc if k.get("HGNC") == kinase["gene_symbol"]] or by_acc[:1]
    if by_acc:
        return by_acc[0]
    by_symbol = [k for k in main if k.get("HGNC") == kinase["gene_symbol"]]
    return by_symbol[0] if by_symbol else None


def plan_gatekeepers(db, klifs: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, Any]]:
    gatekeepers: dict[str, Any] = {}
    unmapped = []
    no_klifs = 0
    for kinase in db.kinases.find({}, {"gene_symbol": 1, "uniprot_id": 1, "protein_sequence": 1}):
        entry = select_klifs_entry(kinase, klifs)
        if entry is None:
            gatekeepers[kinase["gene_symbol"]] = None
            no_klifs += 1
            continue
        mapped = rules.map_pocket_residue(entry.get("pocket"), kinase.get("protein_sequence"))
        if mapped is None:
            gatekeepers[kinase["gene_symbol"]] = None
            unmapped.append(kinase["gene_symbol"])
            continue
        gatekeepers[kinase["gene_symbol"]] = {
            "residue": mapped["residue"],
            "position": mapped["position"],
            "label": f"{mapped['residue']}{mapped['position']}",
            "klifs_kinase_id": entry["kinase_ID"],
            "klifs_name": entry.get("name"),
            "klifs_pocket_residue": entry["pocket"][rules.GATEKEEPER_POCKET_INDEX - 1],
            "anchor_fragment": mapped["anchor_fragment"],
            "exact_anchor_match": mapped["exact_match"],
            "uniprot_id": kinase.get("uniprot_id"),
            "method": rules.GATEKEEPER_METHOD,
            "source_url": f"{KLIFS_API}/kinase_information?kinase_ID={entry['kinase_ID']}",
        }
    summary = {
        "kinases": len(gatekeepers),
        "with_gatekeeper": sum(1 for g in gatekeepers.values() if g),
        "not_in_klifs": no_klifs,
        "klifs_but_unmapped": sorted(unmapped),
        "approximate_anchor": sorted(g for g, v in gatekeepers.items() if v and not v["exact_anchor_match"]),
    }
    return gatekeepers, summary


def plan_clinvar(db, summaries: dict[str, Any], meta: dict[str, Any]) -> tuple[list[UpdateOne], dict[str, Any]]:
    retrieved_at = datetime.fromisoformat(meta["retrieved_at"])
    ops, by_class, by_stars, genes = [], Counter(), Counter(), set()
    unresolved, gene_mismatch = [], []
    for doc in db.variants.find({"source": "clinvar"}, {"clinvar_uid": 1, "gene_symbol": 1}):
        uid = str(doc["clinvar_uid"])
        fields = rules.clinvar_fields(uid, summaries.get(uid))
        fields["clinvar_retrieved_at"] = retrieved_at
        genes.add(doc["gene_symbol"])
        if not fields["clinvar_resolved"]:
            unresolved.append(uid)
        elif fields["clinvar_genes"] and doc["gene_symbol"] not in fields["clinvar_genes"]:
            gene_mismatch.append(f"{doc['gene_symbol']}:{uid}")
        by_class[fields["germline_classification"] or "(none)"] += 1
        by_stars["null" if fields["review_stars"] is None else fields["review_stars"]] += 1
        ops.append(UpdateOne({"_id": doc["_id"]}, {"$set": fields}))
    einfo = meta.get("einfo", {})
    summary = {
        "records": len(ops),
        "genes": len(genes),
        "resolved": len(ops) - len(unresolved),
        "unresolved": len(unresolved),
        "unresolved_uids": unresolved[:50],
        "gene_not_in_clinvar_genes": gene_mismatch[:50],
        "gene_not_in_clinvar_genes_count": len(gene_mismatch),
        "by_germline_classification": dict(by_class.most_common()),
        "by_review_stars": {str(k): v for k, v in sorted(by_stars.items(), key=lambda kv: str(kv[0]))},
        "clinvar_retrieved_at": meta["retrieved_at"],
        "clinvar_lastupdate": einfo.get("lastupdate"),
        "clinvar_dbbuild": einfo.get("dbbuild"),
    }
    return ops, summary


def plan_curated(db, gatekeepers: dict[str, Any], pubmed: dict[str, dict[str, str]]) -> tuple[list[UpdateOne], dict[str, Any]]:
    ops, rows = [], []
    for doc in db.variants.find({"source": "curated"}):
        legacy = doc.get("is_gatekeeper_legacy", doc.get("is_gatekeeper"))
        pmid = str(doc.get("pubmed_id") or "")
        record = pubmed.get(pmid)
        pub_text = f"{record['title']} {record['abstract']}" if record else None
        fields = rules.curated_fields(doc.get("drug_resistance_context"), pub_text)
        gk = gatekeepers.get(doc["gene_symbol"])
        flag = rules.is_gatekeeper(doc.get("wildtype_aa"), doc.get("position"), gk)
        fields.update({
            "is_gatekeeper": flag,
            "is_gatekeeper_legacy": bool(legacy),
            "gatekeeper_basis": (f"{doc['gene_symbol']} gatekeeper {gk['label']} (KLIFS pocket residue 45)"
                                 if gk else "KLIFS does not cover this kinase"),
            "pubmed_url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else None,
            "publication_title": record["title"] if record else None,
            "publication_checked": record is not None,
        })
        rows.append((doc, fields, legacy))
        ops.append(UpdateOne({"_id": doc["_id"]}, {"$set": fields}))
    label = lambda d: f"{d['gene_symbol']} {d['mutation_code']}"  # noqa: E731
    summary = {
        "records": len(rows),
        "genes": len({d["gene_symbol"] for d, _, _ in rows}),
        "legacy_gatekeeper_flags": sum(1 for _, _, legacy in rows if legacy),
        "gatekeeper_kept": [label(d) for d, f, legacy in rows if legacy and f["is_gatekeeper"]],
        "gatekeeper_removed": [f"{label(d)} ({f['gatekeeper_basis']})" for d, f, legacy in rows if legacy and not f["is_gatekeeper"]],
        "gatekeeper_added": [label(d) for d, f, legacy in rows if not legacy and f["is_gatekeeper"]],
        "effect_type": dict(Counter(f["effect_type"] for _, f, _ in rows)),
        "with_affected_drugs": sum(1 for _, f, _ in rows if f["affected_drugs"]),
        "with_diseases": [f"{label(d)}: {f['associated_diseases']}" for d, f, _ in rows if f["associated_diseases"]],
        "drug_not_named_in_publication": [
            f"{label(d)}: {f['unconfirmed_drugs']} (PMID {d.get('pubmed_id') or 'none'}"
            f"{'' if f['publication_checked'] else ', no publication record'})"
            for d, f, _ in rows if f["unconfirmed_drugs"]
        ],
        "missing_pubmed_id": sum(1 for d, _, _ in rows if not d.get("pubmed_id")),
        "pmids_not_in_cache": sorted({str(d["pubmed_id"]) for d, f, _ in rows if d.get("pubmed_id") and not f["publication_checked"]}),
        "curated_gatekeepers": {g: (gatekeepers.get(g) or {}).get("label") for g in sorted({d["gene_symbol"] for d, _, _ in rows})},
    }
    return ops, summary


def run(db, apply: bool) -> dict[str, Any]:
    meta, summaries = load_clinvar_cache()
    klifs = load_klifs_cache()
    pubmed = load_pubmed_cache()
    gatekeepers, gk_summary = plan_gatekeepers(db, klifs)
    clinvar_ops, clinvar_summary = plan_clinvar(db, summaries, meta)
    curated_ops, curated_summary = plan_curated(db, gatekeepers, pubmed)
    if (clinvar_summary["records"], clinvar_summary["genes"]) != EXPECTED_CLINVAR:
        raise RuntimeError(f"ClinVar record set differs from the ledger: {clinvar_summary['records']} / {clinvar_summary['genes']}")
    if (curated_summary["records"], curated_summary["genes"]) != EXPECTED_CURATED:
        raise RuntimeError(f"Curated record set differs from the ledger: {curated_summary['records']} / {curated_summary['genes']}")
    if apply:
        total_before = db.variants.count_documents({})
        for start in range(0, len(clinvar_ops), 2000):
            db.variants.bulk_write(clinvar_ops[start: start + 2000], ordered=False)
        db.variants.bulk_write(curated_ops, ordered=False)
        db.kinases.bulk_write([
            UpdateOne({"gene_symbol": gene}, {"$set": {"gatekeeper": gk}}) for gene, gk in gatekeepers.items()
        ], ordered=False)
        db.variants.create_index("section")
        db.variants.create_index("germline_classification")
        if db.variants.count_documents({}) != total_before:
            raise RuntimeError("variant document count changed during apply")
    return {"gatekeepers": gk_summary, "clinvar": clinvar_summary, "curated": curated_summary}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", help="fill the raw cache (ClinVar, KLIFS, PubMed)")
    parser.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    parser.add_argument("--report", type=Path, help="write the summary JSON to this path")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    db = MongoClient(settings.db.uri)[settings.db.db_name]
    if args.fetch:
        logger.info("KLIFS: %s", fetch_klifs())
        logger.info("PubMed: %s", fetch_pubmed(db))
        logger.info("ClinVar: %s", fetch_clinvar(db))
    result = run(db, args.apply)
    text = json.dumps(result, indent=1, default=str)
    if args.report:
        args.report.write_text(text, encoding="utf-8")
    logger.info("%s variants (db=%s):\n%s", "APPLIED" if args.apply else "DRY RUN", settings.db.db_name, text)


if __name__ == "__main__":
    main()
