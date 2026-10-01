"""Unit tests for the JMB revision formulas and reference data.

Run: python -m pytest etl/tests
"""
from __future__ import annotations

import csv
import statistics
from collections import Counter
from pathlib import Path

import pytest

from etl.jmb_revision import pdis_v3
from etl.jmb_revision.migrate import EXTENSION_CLASSES, compute_pdis_v3, load_extension_classes

DATA = Path(__file__).resolve().parent.parent / "data"
EXPECTED = list(csv.DictReader((DATA / "expected_pdis_2026-09-30.csv").open(encoding="utf-8")))
COMPONENT_COLUMNS = {
    "citation": "citation_component",
    "clinical_trials": "clinical_component",
    "structure": "structure_component",
    "compound_diversity": "compound_diversity_component",
}


def _raw(row):
    return {
        "pubmed_publication_count": int(row["pubmed_publication_count"]),
        "clinical_trial_count": int(row["clinical_trial_count"]),
        "pdb_count": int(row["pdb_count"]),
        "best_resolution_angstrom": float(row["best_resolution_angstrom"]) if row["best_resolution_angstrom"] else None,
        "average_resolution_angstrom": float(row["average_resolution_angstrom"]) if row["average_resolution_angstrom"] else None,
        "distinct_compound_count": int(row["distinct_compound_count"]),
    }


@pytest.fixture(scope="module")
def computed():
    docs = [{"gene_symbol": r["gene_symbol"], "raw_values": _raw(r)} for r in EXPECTED]
    counts = {r["gene_symbol"]: int(r["distinct_compound_count"]) for r in EXPECTED}
    return {r["gene_symbol"]: r for r in compute_pdis_v3(docs, counts)}


def test_expected_table_covers_catalog():
    assert len(EXPECTED) == 678
    assert len({r["gene_symbol"] for r in EXPECTED}) == 678


def test_components_and_totals_match_expected(computed):
    for row in EXPECTED:
        result = computed[row["gene_symbol"]]
        for name, column in COMPONENT_COLUMNS.items():
            assert result["components"][name] == pytest.approx(float(row[column]), abs=0.01), (row["gene_symbol"], name)
        assert result["pdis_total"] == pytest.approx(float(row["pdis_default_0_100"]), abs=1e-9), row["gene_symbol"]
        assert result["rank_default"] == int(row["rank_default"]), row["gene_symbol"]


def test_summary_statistics(computed):
    totals = [r["pdis_total"] for r in computed.values()]
    assert min(totals) == 0
    assert sorted(g for g, r in computed.items() if r["pdis_total"] == 0) == [
        "HYKK", "PDPK2P", "PMS2P1", "PMS2P11", "PRPS1L1"]
    assert max(totals) == 96.36
    assert computed["EGFR"]["components"] == {
        "citation": 100, "clinical_trials": 100, "structure": 83.52, "compound_diversity": 94.62}
    assert statistics.median(totals) == pytest.approx(33.28, abs=0.005)
    assert sum(t >= 50 for t in totals) == 71
    top10 = [(g, r["pdis_total"]) for g, r in sorted(computed.items(), key=lambda x: x[1]["rank_default"])[:10]]
    assert top10 == [("EGFR", 96.36), ("MTOR", 93.29), ("MET", 92.03), ("KIT", 91.88), ("BTK", 91.08),
                     ("ALK", 90.54), ("BCR", 90.00), ("BRAF", 89.44), ("ERBB2", 87.69), ("KDR", 87.52)]
    assert computed["EGFR"]["normalisation"] == {"n_max": 33585, "c_max": 25763}


def test_weight_sum_removes_binary_drift():
    assert pdis_v3.weight_sum([0.3, 0.3, 0.15, 0.15]) == 0.9
    assert pdis_v3.weight_sum([0.25] * 4) == 1.0


def test_structure_component_zero_without_structure():
    assert pdis_v3.structure_component(0, 1.5, 2.0) == 0
    assert pdis_v3.structure_component(3, None, None) == 0
    assert pdis_v3.resolution_score(4.5) == 0
    assert pdis_v3.resolution_score(1.0) == 100


def test_zero_weights_rejected():
    with pytest.raises(ValueError):
        pdis_v3.weighted_total({k: 50 for k in pdis_v3.COMPONENT_ORDER}, {k: 0 for k in pdis_v3.COMPONENT_ORDER})


def test_extension_classes():
    rows = load_extension_classes()
    assert len(rows) == 156
    counts = Counter(r["extension_class"] for r in rows.values())
    assert [counts[c] for c in EXTENSION_CLASSES] == [5, 38, 11, 36, 38, 20, 8]
    assert all(r["classification_basis"].strip() for r in rows.values())
