"""PDIS formula version 3.0: weighted mean of four evidence components (0-100).

The components and total follow Supplementary Methods S2 of the JMB revision:

- C_cit    = 100 * ln(1 + n) / ln(1 + n_max)
- C_trial  = min(100, t)
- C_struct = 0.6 * s(best) + 0.4 * s(mean), s(r) = clamp(100 * (4.0 - r) / 2.5, 0, 100);
             0 when the entry has no experimental structure
- C_cmpd   = 100 * ln(1 + c) / ln(1 + c_max)
- PDIS     = sum(w_i * C_i) / sum(w_i), computed from the rounded components

Every component and the total carry two decimals. The browser recomputes
user-weighted scores from the same rounded components with the same weight-sum
normalisation (``weight_sum``), so default weights reproduce the stored totals.
"""
from __future__ import annotations

import math
from typing import Mapping, Sequence

FORMULA_VERSION = "3.0-weighted-mean"
COMPONENT_ORDER = ("citation", "clinical_trials", "structure", "compound_diversity")
DEFAULT_WEIGHTS: dict[str, float] = {
    "citation": 0.30,
    "clinical_trials": 0.30,
    "structure": 0.15,
    "compound_diversity": 0.15,
}


def log_component(count: int, maximum: int) -> float:
    if count <= 0 or maximum <= 0:
        return 0.0
    return 100.0 * math.log1p(count) / math.log1p(maximum)


def trial_component(trial_count: int) -> float:
    return min(100.0, float(max(trial_count, 0)))


def resolution_score(resolution: float) -> float:
    return max(0.0, min(100.0, 100.0 * (4.0 - resolution) / 2.5))


def structure_component(
    pdb_count: int, best_resolution: float | None, average_resolution: float | None
) -> float:
    if not pdb_count or best_resolution is None or average_resolution is None:
        return 0.0
    return 0.6 * resolution_score(best_resolution) + 0.4 * resolution_score(average_resolution)


def components(
    raw: Mapping[str, object], n_max: int, c_max: int
) -> dict[str, float]:
    """Return the four components, each rounded to two decimals."""
    return {
        "citation": round(log_component(int(raw["pubmed_publication_count"] or 0), n_max), 2),
        "clinical_trials": round(trial_component(int(raw["clinical_trial_count"] or 0)), 2),
        "structure": round(structure_component(
            int(raw.get("pdb_count") or 0),
            raw.get("best_resolution_angstrom"),  # type: ignore[arg-type]
            raw.get("average_resolution_angstrom"),  # type: ignore[arg-type]
        ), 2),
        "compound_diversity": round(
            log_component(int(raw["distinct_compound_count"] or 0), c_max), 2
        ),
    }


def weight_sum(weights: Sequence[float]) -> float:
    # Rounding removes binary drift (0.3 + 0.3 + 0.15 + 0.15 = 0.8999999999999999).
    return round(sum(weights), 12)


def weighted_total(comps: Mapping[str, float], weights: Mapping[str, float] = DEFAULT_WEIGHTS) -> float:
    w = [float(weights[name]) for name in COMPONENT_ORDER]
    total_w = weight_sum(w)
    if total_w <= 0:
        raise ValueError("At least one PDIS weight must be above zero")
    numerator = 0.0
    for weight, name in zip(w, COMPONENT_ORDER):
        numerator += weight * comps[name]
    return numerator / total_w


def stored_total(comps: Mapping[str, float]) -> float:
    return round(weighted_total(comps, DEFAULT_WEIGHTS), 2)
