"""Unit tests for Pharos GraphQL parsing (no network, no database)."""
from __future__ import annotations

from etl.jmb_revision.pharos import parse_target, tdl_counts


def test_parse_target():
    response = {"data": {"target": {"sym": "CSNK1D", "uniprot": "P48730", "tdl": "Tchem", "fam": "Kinase",
                                    "novelty": 0.00896935}}}
    target = parse_target(response)
    assert target == {"tdl": "Tchem", "fam": "Kinase", "novelty": 0.00896935, "pharos_symbol": "CSNK1D",
                      "pharos_uniprot": "P48730"}


def test_unmapped_and_malformed():
    assert parse_target({"data": {"target": None}}) is None
    assert parse_target({"errors": [{"message": "x"}]}) is None
    assert parse_target(None) is None
    assert parse_target({"data": {"target": {"sym": "X", "tdl": "Tunknown"}}})["tdl"] is None


def test_tdl_counts():
    rows = [{"tdl": "Tclin"}, {"tdl": "Tchem"}, {"tdl": "Tchem"}, {"tdl": None}]
    assert tdl_counts(rows) == {"Tclin": 1, "Tchem": 2, "Tbio": 0, "Tdark": 0, "unmapped": 1}
