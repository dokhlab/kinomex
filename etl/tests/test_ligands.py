"""Unit tests for ligand representative selection (Task 5.1).

Run: python -m pytest etl/tests/test_ligands.py
"""
from __future__ import annotations

import pytest

from etl.jmb_revision import ligands_select as sel
from etl.jmb_revision.ligands import _binding_mode, merge_plan, old_rule_check


def rec(activity_id, assay_type, relation, value, **extra):
    return {"activity_id": activity_id, "assay_type": assay_type, "standard_relation": relation,
            "standard_value": value, "source": "chembl", **extra}


def test_censored_lower_value_loses_to_uncensored_higher_value():
    recs = [rec(1, "IC50", ">", "1.0"), rec(2, "IC50", "=", "5000")]
    assert sel.select_representative(recs)["activity_id"] == 2


def test_kd_beats_lower_ic50():
    recs = [rec(1, "IC50", "=", "0.5"), rec(2, "KD", "=", "800")]
    assert sel.select_representative(recs)["activity_id"] == 2


def test_ki_and_kd_share_tier_one():
    recs = [rec(1, "KD", "=", "30"), rec(2, "KI", "=", "3")]
    assert sel.select_representative(recs)["activity_id"] == 2


def test_ic50_beats_potency_and_other_types():
    recs = [rec(1, "POTENCY", "=", "0.1"), rec(2, "GI50", "=", "0.2"), rec(3, "EC50", "=", "90")]
    assert sel.select_representative(recs)["activity_id"] == 3


def test_other_uncensored_beats_censored_kd():
    recs = [rec(1, "KD", ">", "10"), rec(2, "POTENCY", "=", "20000")]
    assert sel.select_representative(recs)["activity_id"] == 2


def test_only_censored_records_pick_lowest_bound():
    recs = [rec(1, "KD", ">", "10000"), rec(2, "IC50", ">=", "3000"), rec(3, "KI", ">>", "50000")]
    summary = sel.summarize_pair(recs)
    assert summary["record"]["activity_id"] == 2
    assert summary["tier"] == 4 and summary["censored"] is True
    assert summary["relation"] == ">=" and summary["uncensored_count"] == 0


def test_null_relation_reads_as_equal():
    recs = [rec(7, "POTENCY", None, "12.5")]
    summary = sel.summarize_pair(recs)
    assert summary["relation"] == "=" and summary["relation_original"] is None
    assert summary["censored"] is False and summary["tier"] == 3
    assert sel.tier_of("KI", None) == 1


@pytest.mark.parametrize("relation", ["<", "<=", "~", "="])
def test_uncensored_relations(relation):
    assert sel.tier_of("KD", relation) == 1
    assert not sel.is_censored(relation)


def test_unknown_relation_raises():
    with pytest.raises(ValueError):
        sel.is_censored("!=")


def test_ties_go_to_lower_activity_id():
    recs = [rec(9, "KI", "=", "10.0"), rec(4, "KD", "=", "10"), rec(6, "KI", "=", 10)]
    assert sel.select_representative(recs)["activity_id"] == 4


def test_numeric_comparison_not_lexical():
    recs = [rec(1, "IC50", "=", "100"), rec(2, "IC50", "=", "9")]
    assert sel.select_representative(recs)["activity_id"] == 2


def test_pubchem_records_without_activity_id():
    recs = [{"_id": "b", "source": "pubchem", "assay_type": "KD", "standard_relation": "=", "standard_value": 5.0},
            {"_id": "a", "source": "pubchem", "assay_type": "KD", "standard_relation": "=", "standard_value": 5.0}]
    assert sel.select_representative(recs)["_id"] == "a"


def test_summary_counts():
    recs = [rec(1, "IC50", "=", "5"), rec(2, "KI", ">", "10000"), rec(3, "POTENCY", None, "7"), rec(4, "IC50", "<", "1")]
    summary = sel.summarize_pair(recs)
    assert summary["assay_count"] == 4 and summary["uncensored_count"] == 3
    assert summary["activity_type_counts"] == {"IC50": 2, "Ki": 1, "POTENCY": 1}
    assert summary["record"]["activity_id"] == 4 and summary["relation"] == "<" and summary["value_nm"] == 1.0


@pytest.mark.parametrize("raw,expected", [
    ("KD", "Kd"), ("KI", "Ki"), ("ic50", "IC50"), ("EC50", "EC50"), ("POTENCY", "POTENCY"),
    ("KDAPP", "KDAPP"), ("% INHIBITION", "% INHIBITION"), (None, ""),
])
def test_activity_type_normalization(raw, expected):
    assert sel.normalize_activity_type(raw) == expected


def test_compound_keys():
    assert sel.compound_key("chembl", "CHEMBL68920", None) == "chembl:CHEMBL68920"
    assert sel.compound_key("pubchem", "pubchem:11667893", 11667893) == "pubchem:11667893"
    assert sel.compound_key("pubchem", "pubchem:42", None) == "pubchem:42"
    assert sel.compound_key("pubchem", None, 42.0) == "pubchem:42"
    with pytest.raises(ValueError):
        sel.compound_key("chembl", "", None)


def test_old_rule_takes_lowest_value_regardless_of_relation_and_type():
    recs = [rec(1, "KD", "=", "50"), rec(2, "POTENCY", ">", "3"), rec(3, "IC50", "=", "3")]
    assert sel.select_old_rule(recs)["activity_id"] == 2
    check = old_rule_check([sel.select_old_rule(recs)])
    assert check["relation_uncensored_set"]["uncensored_ic50_ki_kd_ec50"] == 0


def test_binding_mode_requires_mechanism_record():
    mech = {("CHEMBL203", "CHEMBL939"): {"mec_id": 5, "action_type": "INHIBITOR", "molecule_chembl_id": "CHEMBL939",
                                          "target_chembl_id": "CHEMBL203", "mechanism_of_action": "EGFR inhibitor",
                                          "mechanism_refs": []}}
    hit = _binding_mode({"CHEMBL203"}, "CHEMBL939", mech)
    assert hit["binding_mode"] == "INHIBITOR" and hit["binding_mode_source"]["id"] == 5
    assert hit["binding_mode_source"]["label"] == "ChEMBL mechanism"
    miss = _binding_mode({"CHEMBL203"}, "CHEMBL1", mech)
    assert miss == {"binding_mode": None, "binding_mode_source": None, "mechanism_of_action": None}


@pytest.mark.parametrize("relation,value,expected", [
    ("=", "0.0", False), ("=", "0", False), ("=", None, False), ("=", "-3", False),
    ("=", "0.5", True), ("=", "10000", True), ("=", "10000.1", False), ("<", "20000", False),
    (">", "1000", True), (">", "10000", False), (">=", "10000", False), ("~", "9999", True),
])
def test_display_range(relation, value, expected):
    assert sel.in_display_range(rec(1, "IC50", relation, value)) is expected


def test_display_reselects_inside_range():
    recs = [rec(1, "KD", "=", "25000"), rec(2, "IC50", "=", "40"), rec(3, "IC50", "=", "0.0")]
    assert sel.select_representative(recs)["activity_id"] == 1
    shown = sel.display_summary(recs)
    assert shown["record"]["activity_id"] == 2
    assert (shown["activity_type"], shown["value_nm"], shown["tier"], shown["in_range_count"]) == ("IC50", 40.0, 2, 1)


def test_display_is_none_without_in_range_record():
    assert sel.display_summary([rec(1, "IC50", "=", "0.0"), rec(2, "KD", ">", "10000")]) is None


def test_merge_plan_folds_pubchem_into_lowest_chembl_key():
    rows = [
        {"gene_symbol": "EGFR", "compound_key": "pubchem:5291", "source": "pubchem",
         "other_source_compound_keys": ["chembl:CHEMBL939", "chembl:CHEMBL1"]},
        {"gene_symbol": "EGFR", "compound_key": "pubchem:7", "source": "pubchem", "other_source_compound_keys": []},
        {"gene_symbol": "EGFR", "compound_key": "chembl:CHEMBL939", "source": "chembl",
         "other_source_compound_keys": ["pubchem:5291"]},
    ]
    assert merge_plan(rows) == {("EGFR", "pubchem:5291"): "chembl:CHEMBL1"}
