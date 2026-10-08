"""Representative-row selection for ligand records (Task 5.1), pure logic.

Tiers, applied over every record of one (gene, source, compound) pair:

1. uncensored Kd or Ki
2. uncensored IC50 or EC50
3. any other uncensored activity type
4. censored bound (>, >=, >>), any activity type

Uncensored relations are =, <, <=, ~ and a missing relation (read as =).
Within the lowest tier present, the lowest value wins; ties go to the lower
activity_id.
"""
from __future__ import annotations

import math
from collections import Counter
from typing import Any, Iterable, Mapping

UNCENSORED_RELATIONS = frozenset({"=", "<", "<=", "~", None})
CENSORED_RELATIONS = frozenset({">", ">=", ">>"})
TIER1_TYPES = frozenset({"KD", "KI"})
TIER2_TYPES = frozenset({"IC50", "EC50"})
NORMALIZED_TYPES = {"KD": "Kd", "KI": "Ki", "IC50": "IC50", "EC50": "EC50"}
# Types counted by the CSNK1D check (Task 5.7).
POTENCY_CHECK_TYPES = frozenset({"IC50", "KI", "KD", "EC50"})

CHEMBL_COMPOUND_URL = "https://www.ebi.ac.uk/chembl/explore/compound/{}"
CHEMBL_ASSAY_URL = "https://www.ebi.ac.uk/chembl/explore/assay/{}"
PUBCHEM_COMPOUND_URL = "https://pubchem.ncbi.nlm.nih.gov/compound/{}"
PUBCHEM_ASSAY_URL = "https://pubchem.ncbi.nlm.nih.gov/bioassay/{}"


def normalize_activity_type(raw: str | None) -> str:
    label = (raw or "").strip().upper()
    return NORMALIZED_TYPES.get(label, label)


def compound_key(source: str, compound_id: str | None, pubchem_cid: Any) -> str:
    """'chembl:CHEMBL123' or 'pubchem:<cid>'."""
    if source == "pubchem":
        if pubchem_cid not in (None, ""):
            return f"pubchem:{int(pubchem_cid)}"
        if compound_id and str(compound_id).startswith("pubchem:"):
            return f"pubchem:{int(str(compound_id).split(':', 1)[1])}"
        raise ValueError("PubChem record without CID")
    if not compound_id:
        raise ValueError("ChEMBL record without compound_id")
    return f"{source}:{compound_id}"


def numeric_value(raw: Any) -> float | None:
    if raw is None or raw == "":
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def is_censored(relation: str | None) -> bool:
    if relation in CENSORED_RELATIONS:
        return True
    if relation in UNCENSORED_RELATIONS:
        return False
    raise ValueError(f"Unknown relation {relation!r}")


def tier_of(activity_type: str | None, relation: str | None) -> int:
    if is_censored(relation):
        return 4
    label = (activity_type or "").strip().upper()
    if label in TIER1_TYPES:
        return 1
    if label in TIER2_TYPES:
        return 2
    return 3


def _tiebreak(record: Mapping[str, Any]) -> tuple:
    activity_id = record.get("activity_id")
    return (activity_id is None, activity_id if activity_id is not None else 0, str(record.get("_id", "")))


def selection_key(record: Mapping[str, Any]) -> tuple:
    value = numeric_value(record.get("standard_value"))
    return (
        tier_of(record.get("assay_type"), record.get("standard_relation")),
        value is None,
        value if value is not None else 0.0,
        *_tiebreak(record),
    )


def select_representative(records: Iterable[Mapping[str, Any]]) -> Mapping[str, Any]:
    records = list(records)
    if not records:
        raise ValueError("No records")
    return min(records, key=selection_key)


def old_rule_key(record: Mapping[str, Any]) -> tuple:
    """Legacy dossier rule: ascending numeric value (MongoDB sorts null first), then activity_id."""
    value = numeric_value(record.get("standard_value"))
    activity_id = record.get("activity_id")
    return (value is not None, value if value is not None else 0.0,
            activity_id is not None, activity_id if activity_id is not None else 0)


def select_old_rule(records: Iterable[Mapping[str, Any]]) -> Mapping[str, Any]:
    return min(records, key=old_rule_key)


# Reporting range for the dossier (display only; the representative rows above
# stay unchanged). A value of 0 nM is not a measurement, and a value above
# 10,000 nM, or a lower bound at 10,000 nM or above, reports no activity.
DISPLAY_MAX_NM = 10000.0


def in_display_range(record: Mapping[str, Any]) -> bool:
    value = numeric_value(record.get("standard_value"))
    if value is None or value <= 0 or value > DISPLAY_MAX_NM:
        return False
    return not (is_censored(record.get("standard_relation")) and value >= DISPLAY_MAX_NM)


def summarize_pair(records: list[Mapping[str, Any]]) -> dict[str, Any]:
    """Representative measurement and counts for one pair."""
    rep = select_representative(records)
    relation = rep.get("standard_relation")
    uncensored = sum(1 for r in records if not is_censored(r.get("standard_relation")))
    type_counts = Counter(normalize_activity_type(r.get("assay_type")) for r in records)
    return {
        "record": rep,
        "activity_type": normalize_activity_type(rep.get("assay_type")),
        "relation": relation if relation is not None else "=",
        "relation_original": relation,
        "value_nm": numeric_value(rep.get("standard_value")),
        "censored": is_censored(relation),
        "tier": tier_of(rep.get("assay_type"), relation),
        "assay_count": len(records),
        "uncensored_count": uncensored,
        "activity_type_counts": dict(sorted(type_counts.items())),
    }


def display_summary(records: list[Mapping[str, Any]]) -> dict[str, Any] | None:
    """The representative re-selected from the records inside the reporting range."""
    in_range = [r for r in records if in_display_range(r)]
    if not in_range:
        return None
    summary = summarize_pair(in_range)
    return {
        "record": summary["record"],
        **{k: summary[k] for k in ("activity_type", "relation", "relation_original", "value_nm", "censored", "tier")},
        "in_range_count": len(in_range),
    }


def first_nonempty(values: Iterable[Any]) -> Any:
    for value in values:
        if value not in (None, "", []):
            return value
    return None
