"""Unit tests for AlphaFold DB model selection (no network, no database)."""
from __future__ import annotations

from etl.jmb_revision.alphafold import fragment_number, isoform_models, select_model


def _model(entry_id, acc, version=6, plddt=80.0, start=1, end=100):
    return {"entryId": entry_id, "uniprotAccession": acc, "latestVersion": version, "globalMetricValue": plddt,
            "uniprotStart": start, "uniprotEnd": end, "cifUrl": f"https://x/{entry_id}.cif",
            "pdbUrl": f"https://x/{entry_id}.pdb", "paeImageUrl": f"https://x/{entry_id}.png"}


def test_picks_canonical_f1_over_isoform():
    response = [_model("AF-P48730-2-F1", "P48730-2", plddt=81.69), _model("AF-P48730-F1", "P48730", plddt=81.0, end=415)]
    model = select_model("P48730", response)
    assert model["entry_id"] == "AF-P48730-F1"
    assert model["model_version"] == 6 and model["global_plddt"] == 81.0
    assert (model["uniprot_start"], model["uniprot_end"]) == (1, 415)
    assert model["cif_url"].endswith(".cif") and model["pae_image_url"].endswith(".png")
    assert model["fragments"] is None


def test_multiple_fragments_pick_f1():
    response = [_model("AF-Q8WZ42-F2", "Q8WZ42"), _model("AF-Q8WZ42-F1", "Q8WZ42"), _model("AF-Q8WZ42-F3", "Q8WZ42")]
    model = select_model("Q8WZ42", response)
    assert model["entry_id"] == "AF-Q8WZ42-F1" and model["fragments"] == 3


def test_no_model_cases():
    assert select_model("Q13315", None) is None
    assert select_model("Q13315", {"error": "not found"}) is None
    assert select_model("Q13315", []) is None
    isoforms = [_model("AF-Q15772-4-F1", "Q15772-4")]
    assert select_model("Q15772", isoforms) is None
    assert isoform_models("Q15772", isoforms) == ["AF-Q15772-4-F1"]
    assert isoform_models("Q15772", None) == []


def test_fragment_number():
    assert fragment_number("AF-P48730-F1", "P48730") == 1
    assert fragment_number("AF-P48730-2-F1", "P48730") is None
    assert fragment_number("AF-P48730-F12", "p48730") == 12
