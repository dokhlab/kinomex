"""External fetches for the ligand module (Task 5); every response lands in the cache.

Cache layout under $KX_CACHE/ligands/:

    assays/batch_NNNN.json        ChEMBL /assay.json (assay -> document)
    documents/batch_NNNN.json     ChEMBL /document.json (PubMed ID, DOI, journal, year)
    mechanisms/page_NNNN.json     ChEMBL /mechanism.json (complete table)
    chembl_37_chemreps.txt.gz     ChEMBL release file with standard InChIKeys
    pubchem_inchikey.json         PubChem PUG REST InChIKey per CID
    meta.json                     retrieval dates, ChEMBL release, checksums
"""
from __future__ import annotations

import gzip
import hashlib
import json
import logging
import os
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

logger = logging.getLogger("kinomex.jmb_revision.ligands")

CHEMBL_API = "https://www.ebi.ac.uk/chembl/api/data"
CHEMBL_RELEASE = "chembl_37"
CHEMREPS_URL = f"https://ftp.ebi.ac.uk/pub/databases/chembl/ChEMBLdb/releases/{CHEMBL_RELEASE}/{CHEMBL_RELEASE}_chemreps.txt.gz"
CHEMREPS_CHECKSUMS = f"https://ftp.ebi.ac.uk/pub/databases/chembl/ChEMBLdb/releases/{CHEMBL_RELEASE}/checksums.txt"
PUBCHEM_PROPERTY = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{}/property/InChIKey,IsomericSMILES/JSON"
ID_BATCH = 200  # the ChEMBL API rejects GET URLs above ~4 kB
USER_AGENT = "KinomeX-ETL/1.0 (https://kinomex.dokhlab.org)"


def cache_root() -> Path:
    root = Path(os.getenv("KX_CACHE", "/home/html/storage/kinomex/jmb_revision_cache")) / "ligands"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def http_get(url: str, attempts: int = 6, timeout: int = 120) -> bytes:
    delay = 2.0
    for attempt in range(1, attempts + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except Exception as exc:  # noqa: BLE001
            if attempt == attempts:
                raise
            logger.warning("GET failed (%s), retry %d in %.0fs: %s", exc, attempt, delay, url[:120])
            time.sleep(delay)
            delay *= 2
    raise RuntimeError("unreachable")


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    tmp.replace(path)


def _chunks(items: list[str], size: int) -> list[list[str]]:
    return [items[i:i + size] for i in range(0, len(items), size)]


def _fetch_in_batches(kind: str, resource: str, id_field: str, ids: Iterable[str], only: str) -> int:
    """Fetch ChEMBL records for sorted id batches; skip batches already cached with the same ids."""
    folder = cache_root() / kind
    batches = _chunks(sorted(set(ids)), ID_BATCH)

    def run(item: tuple[int, list[str]]) -> int:
        index, batch = item
        path = folder / f"batch_{index:04d}.json"
        if path.exists():
            cached = json.loads(path.read_text(encoding="utf-8"))
            if cached.get("ids") == batch:
                return 0
        query = urllib.parse.urlencode({f"{id_field}__in": ",".join(batch), "only": only, "limit": 1000})
        url = f"{CHEMBL_API}/{resource}.json?{query}"
        data = json.loads(http_get(url))
        records = data[f"{resource}s"]
        if data["page_meta"]["next"]:
            raise RuntimeError(f"{kind} batch {index} exceeds one page")
        _write_json(path, {"retrieved_at": _now(), "url": url, "ids": batch, "records": records})
        return 1

    with ThreadPoolExecutor(max_workers=4) as pool:
        fetched = sum(pool.map(run, enumerate(batches)))
    logger.info("%s: %d ids in %d batches (%d fetched now)", kind, len(set(ids)), len(batches), fetched)
    return fetched


def load_batches(kind: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for path in sorted((cache_root() / kind).glob("batch_*.json")):
        records.extend(json.loads(path.read_text(encoding="utf-8"))["records"])
    return records


def fetch_assays(db) -> None:
    ids = db.bioactivities.distinct("assay_chembl_id", {"source": "chembl"})
    _fetch_in_batches("assays", "assay", "assay_chembl_id", ids, "assay_chembl_id,document_chembl_id")


def fetch_documents() -> None:
    ids = {r["document_chembl_id"] for r in load_batches("assays") if r.get("document_chembl_id")}
    _fetch_in_batches(
        "documents", "document", "document_chembl_id", ids,
        "document_chembl_id,pubmed_id,doi,journal,year,doc_type,title",
    )


def fetch_mechanisms() -> None:
    folder = cache_root() / "mechanisms"
    if (folder / "complete.json").exists():
        logger.info("mechanisms: cached")
        return
    offset, page, total = 0, 0, None
    while total is None or offset < total:
        url = f"{CHEMBL_API}/mechanism.json?limit=1000&offset={offset}"
        data = json.loads(http_get(url))
        total = data["page_meta"]["total_count"]
        _write_json(folder / f"page_{page:04d}.json", {"retrieved_at": _now(), "url": url, "records": data["mechanisms"]})
        offset += 1000
        page += 1
    _write_json(folder / "complete.json", {"retrieved_at": _now(), "total_count": total, "pages": page})
    logger.info("mechanisms: %d records in %d pages", total, page)


def load_mechanisms() -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for path in sorted((cache_root() / "mechanisms").glob("page_*.json")):
        records.extend(json.loads(path.read_text(encoding="utf-8"))["records"])
    return records


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def fetch_chemreps() -> dict[str, str]:
    path = cache_root() / f"{CHEMBL_RELEASE}_chemreps.txt.gz"
    checksums = http_get(CHEMREPS_CHECKSUMS).decode()
    expected = next((line.split()[0] for line in checksums.splitlines() if line.endswith(path.name)), None)
    if not path.exists() or (expected and _sha256(path) != expected):
        tmp = path.with_suffix(".part")
        req = urllib.request.Request(CHEMREPS_URL, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=600) as resp, tmp.open("wb") as out:
            while block := resp.read(1 << 20):
                out.write(block)
        tmp.replace(path)
    actual = _sha256(path)
    if expected and actual != expected:
        raise RuntimeError(f"chemreps checksum mismatch {actual} != {expected}")
    logger.info("chemreps: %s sha256 %s", path.name, actual)
    return {"file": path.name, "url": CHEMREPS_URL, "sha256": actual, "sha256_expected": expected or ""}


def load_chemreps_inchikeys(wanted: set[str]) -> dict[str, str]:
    path = cache_root() / f"{CHEMBL_RELEASE}_chemreps.txt.gz"
    found: dict[str, str] = {}
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        header = handle.readline().rstrip("\n").split("\t")
        id_col, key_col = header.index("chembl_id"), header.index("standard_inchi_key")
        for line in handle:
            parts = line.rstrip("\n").split("\t")
            if parts[id_col] in wanted and parts[key_col]:
                found[parts[id_col]] = parts[key_col]
    return found


def fetch_pubchem(db) -> None:
    cids = sorted({int(c) for c in db.bioactivities.distinct("pubchem_cid", {"source": "pubchem"}) if c is not None})
    url = PUBCHEM_PROPERTY.format(",".join(map(str, cids)))
    data = json.loads(http_get(url))
    _write_json(cache_root() / "pubchem_inchikey.json", {"retrieved_at": _now(), "url": url, "cids": cids,
                                                          "records": data["PropertyTable"]["Properties"]})
    logger.info("pubchem: %d CIDs", len(cids))


def load_pubchem() -> dict[int, dict[str, Any]]:
    data = json.loads((cache_root() / "pubchem_inchikey.json").read_text(encoding="utf-8"))
    return {int(r["CID"]): r for r in data["records"]}


def fetch_all(db) -> None:
    meta_path = cache_root() / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    status = json.loads(http_get(f"{CHEMBL_API}/status.json"))
    fetch_assays(db)
    fetch_documents()
    fetch_mechanisms()
    chemreps = fetch_chemreps()
    fetch_pubchem(db)
    meta.setdefault("first_retrieved_at", _now())
    meta.update({
        "last_retrieved_at": _now(),
        "chembl_api_status": status,
        "chemreps": chemreps,
        "sources": {
            "assays": f"{CHEMBL_API}/assay.json",
            "documents": f"{CHEMBL_API}/document.json",
            "mechanisms": f"{CHEMBL_API}/mechanism.json",
            "pubchem": "https://pubchem.ncbi.nlm.nih.gov/rest/pug",
        },
    })
    _write_json(meta_path, meta)
