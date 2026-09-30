"""Pure rules for the JMB revision variant records (Task 7, defects D9 and D10).

- ClinVar review status text to star level, classification and condition fields
- KLIFS pocket residue 45 (gatekeeper) mapped to the UniProt canonical sequence
- the gatekeeper decision for curated mutations
- parsing of the curated ``drug_resistance_context`` text into drugs, diseases and effect type
"""
from __future__ import annotations

import re
from typing import Any, Iterable, Mapping

# ---------------------------------------------------------------------------
# ClinVar
# ---------------------------------------------------------------------------

REVIEW_STARS: dict[str, int] = {
    "practice guideline": 4,
    "reviewed by expert panel": 3,
    "criteria provided, multiple submitters, no conflicts": 2,
    "criteria provided, conflicting classifications": 1,
    "criteria provided, conflicting interpretations": 1,
    "criteria provided, single submitter": 1,
    "no assertion criteria provided": 0,
    "no assertion provided": 0,
    "no classification provided": 0,
    "no classification for the individual variant": 0,
    "no interpretation for the single variant": 0,
}
PLACEHOLDER_CONDITIONS = {"not provided", "not specified"}


def review_stars(review_status: str | None) -> int | None:
    if not review_status:
        return None
    return REVIEW_STARS.get(" ".join(review_status.strip().lower().split()))


def clinvar_date(value: str | None) -> str | None:
    """'2025/11/08 00:00' -> '2025-11-08'; ClinVar's empty date '1/01/01 00:00' -> None."""
    if not value:
        return None
    match = re.match(r"^(\d{4})/(\d{1,2})/(\d{1,2})", value.strip())
    if not match:
        return None
    year, month, day = (int(part) for part in match.groups())
    return f"{year:04d}-{month:02d}-{day:02d}"


def _text(value: Any) -> str | None:
    text = (value or "").strip() if isinstance(value, str) else ""
    return text or None


def conditions(trait_set: Iterable[Mapping[str, Any]] | None) -> list[str]:
    names: list[str] = []
    for trait in trait_set or []:
        name = _text(trait.get("trait_name"))
        if name and name.lower() not in PLACEHOLDER_CONDITIONS and name not in names:
            names.append(name)
    return names


def clinvar_url(uid: str) -> str:
    return f"https://www.ncbi.nlm.nih.gov/clinvar/variation/{uid}/"


def clinvar_fields(uid: str, summary: Mapping[str, Any] | None) -> dict[str, Any]:
    """Fields added to a ClinVar variant document; ``summary`` is one esummary record or None."""
    fields: dict[str, Any] = {
        "section": "clinvar",
        "clinvar_url": clinvar_url(uid),
        "clinvar_resolved": False,
        "clinvar_accession": None,
        "clinvar_accession_version": None,
        "germline_classification": None,
        "review_status": None,
        "review_stars": None,
        "conditions": [],
        "classification_last_evaluated": None,
        "oncogenicity_classification": None,
        "clinical_impact_classification": None,
        "clinvar_genes": [],
        "pathogenicity": "unavailable",
    }
    if not summary or summary.get("error") or not summary.get("accession"):
        return fields
    germline = summary.get("germline_classification") or {}
    classification = _text(germline.get("description"))
    status = _text(germline.get("review_status"))
    fields.update({
        "clinvar_resolved": True,
        "clinvar_accession": _text(summary.get("accession")),
        "clinvar_accession_version": _text(summary.get("accession_version")),
        "germline_classification": classification,
        "review_status": status,
        "review_stars": review_stars(status),
        "conditions": conditions(germline.get("trait_set")),
        "classification_last_evaluated": clinvar_date(germline.get("last_evaluated")),
        "oncogenicity_classification": _text((summary.get("oncogenicity_classification") or {}).get("description")),
        "clinical_impact_classification": _text((summary.get("clinical_impact_classification") or {}).get("description")),
        "clinvar_genes": [g["symbol"] for g in summary.get("genes") or [] if g.get("symbol")],
        "pathogenicity": classification or "unavailable",
    })
    return fields


# ---------------------------------------------------------------------------
# KLIFS gatekeeper
# ---------------------------------------------------------------------------

GATEKEEPER_POCKET_INDEX = 45
GATEKEEPER_METHOD = "KLIFS pocket residue 45 mapped to UniProt canonical sequence"
# KLIFS regions beta5 (42-44), gatekeeper (45), hinge (46-48) and linker (49-52) form
# one contiguous stretch of sequence; alpha-D (53-59) usually follows directly.
ANCHOR_WINDOWS = ((42, 52), (42, 59))
GAP_CHARS = set("-_.")


def _gap_free_span(pocket: str, start: int, end: int, anchor: int) -> tuple[int, int] | None:
    if pocket[anchor - 1] in GAP_CHARS:
        return None
    lo = anchor
    while lo - 1 >= start and pocket[lo - 2] not in GAP_CHARS:
        lo -= 1
    hi = anchor
    while hi + 1 <= end and pocket[hi] not in GAP_CHARS:
        hi += 1
    return lo, hi


def _find_all(sequence: str, fragment: str) -> list[int]:
    hits, idx = [], sequence.find(fragment)
    while idx >= 0:
        hits.append(idx)
        idx = sequence.find(fragment, idx + 1)
    return hits


def _find_one_mismatch(sequence: str, fragment: str, keep: int) -> list[int]:
    hits = []
    for idx in range(len(sequence) - len(fragment) + 1):
        window = sequence[idx: idx + len(fragment)]
        if window[keep] != fragment[keep]:
            continue
        if sum(a != b for a, b in zip(window, fragment)) <= 1:
            hits.append(idx)
    return hits


def map_pocket_residue(
    pocket: str | None, sequence: str | None, pocket_index: int = GATEKEEPER_POCKET_INDEX
) -> dict[str, Any] | None:
    """Map one KLIFS pocket position onto a sequence (1-based residue number).

    The fragment of gap-free pocket residues around ``pocket_index`` inside the
    beta5-hinge-linker stretch must occur exactly once in the sequence; a longer
    window through alpha-D resolves repeats, and a single mismatch outside the
    mapped residue is tolerated as a last resort.
    """
    if not isinstance(pocket, str) or not isinstance(sequence, str) or len(pocket) < pocket_index:
        return None
    sequence = sequence.upper()
    pocket = pocket.upper()
    for exact in (True, False):
        for start, end in ANCHOR_WINDOWS:
            end = min(end, len(pocket))
            span = _gap_free_span(pocket, start, end, pocket_index)
            if span is None:
                return None
            lo, hi = span
            fragment = pocket[lo - 1: hi]
            offset = pocket_index - lo
            if len(fragment) < 5:
                continue
            hits = _find_all(sequence, fragment) if exact else _find_one_mismatch(sequence, fragment, offset)
            if len(hits) == 1:
                position = hits[0] + offset + 1
                return {
                    "residue": sequence[position - 1],
                    "position": position,
                    "anchor_fragment": fragment,
                    "anchor_pocket_range": [lo, hi],
                    "exact_match": exact,
                }
    return None


def is_gatekeeper(wildtype_aa: str | None, position: Any, gatekeeper: Mapping[str, Any] | None) -> bool:
    if not gatekeeper or not wildtype_aa or len(wildtype_aa) != 1:
        return False
    try:
        pos = int(position)
    except (TypeError, ValueError):
        return False
    return pos > 0 and pos == int(gatekeeper["position"]) and wildtype_aa.upper() == gatekeeper["residue"].upper()


# ---------------------------------------------------------------------------
# Curated mutation context
# ---------------------------------------------------------------------------

DISEASE_TERMS = (
    "CML", "NSCLC", "DFSP", "AML", "ALL", "GIST", "CLL", "HCC", "RCC", "SCLC",
    "melanoma", "mastocytosis", "systemic mastocytosis", "myelofibrosis",
    "polycythemia vera", "neuroblastoma", "glioblastoma", "breast cancer",
    "lung cancer", "colorectal cancer", "thyroid cancer", "medullary thyroid cancer",
    "cholangiocarcinoma", "urothelial carcinoma", "bladder cancer", "leukemia", "lymphoma",
)
EFFECT_WORDS = ("resistance", "response", "sensitivity", "sensitization", "activation", "activating")
_EFFECT_RE = re.compile(r"\b(" + "|".join(EFFECT_WORDS) + r")\b", re.IGNORECASE)
_DISEASE_RE = re.compile(
    r"\b(" + "|".join(sorted((re.escape(t) for t in DISEASE_TERMS), key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)
CLASS_WORDS = ("inhibitor", "inhibitors", "tki", "tkis", "type", "gen", "generation", "third-gen",
               "second-gen", "first-gen", "third-generation", "second-generation", "first-generation")


def _canonical_disease(term: str) -> str:
    for known in DISEASE_TERMS:
        if known.lower() == term.lower():
            return known if known.isupper() else known[0].upper() + known[1:]
    return term.strip()


def parse_context(context: str | None) -> dict[str, Any]:
    """Split a curated context string into drug phrases, disease names and an effect type.

    'Imatinib resistance in CML' -> drugs ['Imatinib'], diseases ['CML'], effect 'resistance'.
    A drug phrase is the text before the effect word; class phrases ('MET inhibitor',
    'Third-gen TKI') carry ``is_class`` so that callers keep them only when a publication
    states them literally.
    """
    text = " ".join((context or "").split())
    result: dict[str, Any] = {"drugs": [], "diseases": [], "effect_type": "other", "effect_word": None}
    if not text:
        return result
    diseases: list[str] = []
    drug_part = text
    in_split = re.split(r"\s+in\s+", text, maxsplit=1)
    if len(in_split) == 2:
        drug_part, disease_part = in_split
        for piece in re.split(r"\s*(?:,|/|\band\b)\s*", disease_part):
            if piece:
                diseases.append(_canonical_disease(piece))
    for match in _DISEASE_RE.finditer(drug_part):
        name = _canonical_disease(match.group(1))
        if name not in diseases:
            diseases.append(name)
    effect = _EFFECT_RE.search(drug_part)
    if effect:
        word = effect.group(1).lower()
        result["effect_word"] = word
        result["effect_type"] = "resistance" if word == "resistance" else (
            "activating" if word.startswith("activat") else "other")
        drug_part = drug_part[: effect.start()]
    drug_part = _DISEASE_RE.sub("", drug_part).strip(" ,;-")
    drugs = []
    for phrase in re.split(r"\s*(?:,|/|\+|\band\b)\s*", drug_part):
        phrase = phrase.strip()
        if phrase:
            words = phrase.lower().split()
            drugs.append({"name": phrase, "is_class": len(words) > 1 or any(w in CLASS_WORDS for w in words)})
    result["drugs"] = drugs
    result["diseases"] = diseases
    return result


def named_in(text: str, phrase: str) -> bool:
    return re.search(r"(?<![A-Za-z0-9])" + re.escape(phrase) + r"(?![A-Za-z0-9])", text, re.IGNORECASE) is not None


def curated_fields(context: str | None, publication_text: str | None) -> dict[str, Any]:
    """Fields added to a curated mutation; drugs stay only when the publication names them."""
    parsed = parse_context(context)
    text = publication_text or ""
    affected, unconfirmed = [], []
    for drug in parsed["drugs"]:
        (affected if text and named_in(text, drug["name"]) else unconfirmed).append(drug["name"])
    return {
        "section": "literature_curated",
        "curation_note": context or "",
        "effect_type": parsed["effect_type"],
        "associated_diseases": parsed["diseases"],
        "affected_drugs": affected,
        "unconfirmed_drugs": unconfirmed,
    }
