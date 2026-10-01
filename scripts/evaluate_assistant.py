#!/usr/bin/env python3
"""Evaluation harness for the KinomeX research assistant (JMB revision Task 10).

Step 1 (run): send each prompt of evaluation/prompts.jsonl once, in a fresh
session, to the KinomeX chat API, extract every literature-derived statement
with its PMID and DOI, check that both identifiers resolve to the same article
(NCBI E-utilities and doi.org), and write one row per statement to
evaluation/assistant_eval.csv.

    python scripts/evaluate_assistant.py run --base https://kinomex.dokhlab.org \
        --model-endpoint "<provider endpoint>" --model-version "<model id>" \
        --cookie "$KINOMEX_SESSION_COOKIE"

Step 2 (human): two reviewers fill reviewer1_score/reviewer2_score with
supported | partially_supported | not_supported, and the *_error_mode columns with
unsupported_extrapolation | wrong_entity | wrong_organism_or_system |
outdated_claim | misreported_quantity (empty when supported). The harness never
scores statements itself.

Step 3 (score): compute proportions with 95% Wilson intervals overall and per
query type, the most frequent error modes, and Cohen's kappa between reviewers.

    python scripts/evaluate_assistant.py score
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROMPTS = ROOT / "evaluation" / "prompts.jsonl"
OUTPUT = ROOT / "evaluation" / "assistant_eval.csv"
SUMMARY = ROOT / "evaluation" / "assistant_eval_summary.json"

COLUMNS = [
    "prompt_id", "query_type", "prompt", "run_date", "model_endpoint", "model_version",
    "response_chars", "statement_id", "statement", "pmid", "doi",
    "pmid_resolves", "doi_resolves", "same_article", "pubmed_title", "doi_title",
    "reviewer1_score", "reviewer1_error_mode", "reviewer2_score", "reviewer2_error_mode",
]
SCORES = ("supported", "partially_supported", "not_supported")
CITATION = re.compile(r"\[PMID:\s*(\d+)\s*;\s*DOI:\s*(10\.\d{4,9}/[^\]\s]+)\s*\]", re.I)


def http_json(url: str, data: bytes | None = None, headers: dict | None = None, timeout: int = 60):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def ask(base: str, prompt: str, cookie: str | None) -> str:
    """One prompt in a fresh session: the request carries no earlier messages."""
    body = json.dumps({"messages": [{"role": "user", "content": prompt}]}).encode()
    headers = {"Content-Type": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(f"{base}/api/chat", data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=300) as resp:
        text = resp.read().decode()
    if not text.startswith("data:"):
        raise RuntimeError(json.loads(text).get("error", text[:200]))
    parts = []
    for line in text.splitlines():
        if line.startswith("data: ") and line[6:] != "[DONE]":
            parts.append(json.loads(line[6:]).get("content", ""))
    return "".join(parts)


def statements(answer: str) -> list[tuple[str, str, str]]:
    """Split an answer into table rows or sentences; keep those that carry a citation."""
    units = []
    for line in answer.splitlines():
        line = line.strip()
        if not line or set(line) <= set("|-: "):
            continue
        units.extend([line] if line.startswith("|") else re.split(r"(?<=[.!?])\s+(?=[A-Z])", line))
    out = []
    for unit in units:
        for pmid, doi in CITATION.findall(unit):
            out.append((re.sub(r"\s+", " ", unit).strip(), pmid, doi.rstrip(".,;)")))
    return out


def pubmed_record(pmid: str) -> tuple[bool, str, str]:
    url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?" + urllib.parse.urlencode(
        {"db": "pubmed", "id": pmid, "retmode": "json"})
    rec = http_json(url)["result"].get(pmid, {})
    if not rec or "error" in rec:
        return False, "", ""
    doi = next((a["value"] for a in rec.get("articleids", []) if a.get("idtype") == "doi"), "")
    return True, rec.get("title", ""), doi


def doi_record(doi: str) -> tuple[bool, str]:
    try:
        data = http_json(f"https://doi.org/{urllib.parse.quote(doi)}",
                         headers={"Accept": "application/vnd.citationstyles.csl+json"})
    except Exception:
        return False, ""
    title = data.get("title", "")
    return True, title[0] if isinstance(title, list) and title else str(title)


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def run(args) -> None:
    prompts = [json.loads(l) for l in PROMPTS.read_text().splitlines() if l.strip()]
    run_date = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows = []
    for p in prompts:
        try:
            answer = ask(args.base, p["prompt"], args.cookie)
        except Exception as exc:  # the row records the failure instead of skipping the prompt
            answer = ""
            print(f"{p['prompt_id']}: request failed: {exc}", file=sys.stderr)
        found = statements(answer)
        if not found:
            rows.append({**{c: "" for c in COLUMNS}, "prompt_id": p["prompt_id"], "query_type": p["query_type"],
                         "prompt": p["prompt"], "run_date": run_date, "model_endpoint": args.model_endpoint,
                         "model_version": args.model_version, "response_chars": len(answer), "statement_id": ""})
        for i, (text, pmid, doi) in enumerate(found, 1):
            ok_pm, pm_title, pm_doi = pubmed_record(pmid)
            ok_doi, doi_title = doi_record(doi)
            same = ok_pm and ok_doi and (pm_doi.lower() == doi.lower() or (norm(pm_title) and norm(pm_title) == norm(doi_title)))
            rows.append({
                "prompt_id": p["prompt_id"], "query_type": p["query_type"], "prompt": p["prompt"],
                "run_date": run_date, "model_endpoint": args.model_endpoint, "model_version": args.model_version,
                "response_chars": len(answer), "statement_id": f"{p['prompt_id']}-s{i}", "statement": text,
                "pmid": pmid, "doi": doi, "pmid_resolves": ok_pm, "doi_resolves": ok_doi, "same_article": same,
                "pubmed_title": pm_title, "doi_title": doi_title,
                "reviewer1_score": "", "reviewer1_error_mode": "", "reviewer2_score": "", "reviewer2_error_mode": "",
            })
            time.sleep(0.4)
        print(f"{p['prompt_id']}: {len(found)} statements")
    with OUTPUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)
    print(f"Wrote {len(rows)} rows to {OUTPUT}")


def wilson(k: int, n: int, z: float = 1.959964) -> tuple[float, float]:
    if n == 0:
        return (float("nan"), float("nan"))
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return (centre - half, centre + half)


def cohen_kappa(a: list[str], b: list[str]) -> float:
    n = len(a)
    if n == 0:
        return float("nan")
    po = sum(x == y for x, y in zip(a, b)) / n
    ca, cb = Counter(a), Counter(b)
    pe = sum(ca[c] * cb[c] for c in SCORES) / (n * n)
    return (po - pe) / (1 - pe) if pe < 1 else 1.0


def score(_args) -> None:
    rows = [r for r in csv.DictReader(OUTPUT.open(encoding="utf-8")) if r["statement_id"]]
    scored = [r for r in rows if r["reviewer1_score"] in SCORES and r["reviewer2_score"] in SCORES]
    if len(scored) < len(rows):
        raise SystemExit(f"{len(rows) - len(scored)} of {len(rows)} statements lack two reviewer scores")

    def consensus(r):  # a statement counts as supported only when both reviewers agree it is
        a, b = r["reviewer1_score"], r["reviewer2_score"]
        return a if a == b else ("partially_supported" if "supported" in (a, b) else "not_supported")

    def summarize(subset):
        n = len(subset)
        out = {"statements": n}
        for s in SCORES:
            k = sum(consensus(r) == s for r in subset)
            lo, hi = wilson(k, n)
            out[s] = {"count": k, "proportion": k / n if n else None, "wilson95": [lo, hi]}
        return out

    by_type = defaultdict(list)
    for r in scored:
        by_type[r["query_type"]].append(r)
    modes = Counter(m for r in scored for m in (r["reviewer1_error_mode"], r["reviewer2_error_mode"]) if m)
    summary = {
        "responses": len({r["prompt_id"] for r in csv.DictReader(OUTPUT.open(encoding="utf-8"))}),
        "overall": summarize(scored),
        "by_query_type": {t: summarize(v) for t, v in sorted(by_type.items())},
        "cohen_kappa": cohen_kappa([r["reviewer1_score"] for r in scored], [r["reviewer2_score"] for r in scored]),
        "error_modes": modes.most_common(),
        "citation_checks": {
            "pmid_and_doi_resolve_to_same_article": sum(r["same_article"] == "True" for r in scored),
            "statements": len(scored),
        },
    }
    SUMMARY.write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--base", default="https://kinomex.dokhlab.org")
    r.add_argument("--model-endpoint", required=True)
    r.add_argument("--model-version", required=True)
    r.add_argument("--cookie", default=None, help="session cookie of a signed-in account with an AI provider")
    r.set_defaults(func=run)
    s = sub.add_parser("score")
    s.set_defaults(func=score)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
