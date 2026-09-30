"""Unit tests for the JMB revision variant rules (Task 7). No network, no database."""
from __future__ import annotations

import pytest

from etl.jmb_revision import variant_rules as rules
from etl.jmb_revision.variants import parse_pubmed_xml, select_klifs_entry

ABL1_POCKET = "HKLGGGQYGEVYEVAVKTLEFLKEAAVMKEIKPNLVQLLGVYIITEFMTYGNLLDYLREYLEKKNFIHRDLAARNCLVVADFGLS"


@pytest.mark.parametrize("status,stars", [
    ("practice guideline", 4),
    ("reviewed by expert panel", 3),
    ("criteria provided, multiple submitters, no conflicts", 2),
    ("criteria provided, conflicting classifications", 1),
    ("criteria provided, single submitter", 1),
    ("Criteria provided,  single submitter ", 1),
    ("no assertion criteria provided", 0),
    ("no classification provided", 0),
    ("no classification for the individual variant", 0),
    ("", None),
    (None, None),
    ("something new", None),
])
def test_review_stars(status, stars):
    assert rules.review_stars(status) == stars


def test_clinvar_fields_resolved():
    summary = {
        "accession": "VCV004810707", "accession_version": "VCV004810707.1",
        "germline_classification": {
            "description": "Uncertain significance", "last_evaluated": "2025/11/08 00:00",
            "review_status": "criteria provided, single submitter",
            "trait_set": [{"trait_name": "not provided"}, {"trait_name": "Leukemia"}, {"trait_name": "Leukemia"}],
        },
        "oncogenicity_classification": {"description": "", "last_evaluated": "1/01/01 00:00"},
        "genes": [{"symbol": "ABL1"}],
    }
    f = rules.clinvar_fields("4810707", summary)
    assert f["clinvar_resolved"] is True
    assert f["pathogenicity"] == f["germline_classification"] == "Uncertain significance"
    assert f["review_stars"] == 1
    assert f["conditions"] == ["Leukemia"]
    assert f["classification_last_evaluated"] == "2025-11-08"
    assert f["oncogenicity_classification"] is None
    assert f["clinvar_url"] == "https://www.ncbi.nlm.nih.gov/clinvar/variation/4810707/"
    assert f["section"] == "clinvar"


@pytest.mark.parametrize("summary", [None, {"uid": "1", "error": "cannot get document summary"}, {}])
def test_clinvar_fields_unresolved(summary):
    f = rules.clinvar_fields("1", summary)
    assert f["clinvar_resolved"] is False
    assert f["germline_classification"] is None and f["review_stars"] is None
    assert f["pathogenicity"] == "unavailable"
    assert f["conditions"] == []


def test_clinvar_date():
    assert rules.clinvar_date("1/01/01 00:00") is None
    assert rules.clinvar_date("2024/3/7 00:00") == "2024-03-07"


def test_gatekeeper_mapping_synthetic():
    pocket = "A" * 41 + "YIITEFMTYGNLLDYLR" + "C" * 27
    assert len(pocket) == 85
    sequence = "MSTK" + "PPPP" + "YIITEFMTYGNLLDYLR" + "WWWW"
    mapped = rules.map_pocket_residue(pocket, sequence)
    assert mapped["position"] == 8 + 3 + 1 and mapped["residue"] == "T"
    assert mapped["exact_match"] is True


def test_gatekeeper_mapping_with_gaps_and_repeats():
    # gap at pocket 49 shortens the anchor to 42-48; the repeated short anchor needs alpha-D
    pocket = list("A" * 85)
    pocket[41:48] = "VIMEYLP"
    pocket[48] = "-"
    pocket = "".join(pocket)
    mapped = rules.map_pocket_residue(pocket, "GGVIMEYLPGG" + "VIMEYLPKK")
    assert mapped is None  # repeated anchor, the second window cannot extend past the gap
    mapped = rules.map_pocket_residue(pocket, "GGVIMEYLPGG" + "VIMEFLPKK")
    assert mapped["position"] == 6 and mapped["residue"] == "E"


def test_gatekeeper_gap_at_45_and_mismatch():
    pocket = "A" * 44 + "-" + "A" * 40
    assert rules.map_pocket_residue(pocket, "AAAA") is None
    pocket = "A" * 41 + "YIITEFMTYGN" + "C" * 33
    mapped = rules.map_pocket_residue(pocket, "KKYIVTEFMSYGNKK")
    assert mapped["position"] == 6 and mapped["exact_match"] is False


def test_gatekeeper_mapping_abl1_like():
    seq = "X" * 272 + "LLGVCTREPPFYIITEFMTYGNLLDYLRECNRQEVNAVVLLYMATQISSAMEYLEKKNFIHRDLAARNCLVGENHLVKVADFGLSRLMTG"
    mapped = rules.map_pocket_residue(ABL1_POCKET, seq)
    assert mapped["residue"] == "T" and mapped["position"] == 272 + 11 + 3 + 1


def test_is_gatekeeper():
    gk = {"residue": "T", "position": 315}
    assert rules.is_gatekeeper("T", 315, gk)
    assert rules.is_gatekeeper("t", "315", gk)
    assert not rules.is_gatekeeper("E", 255, gk)
    assert not rules.is_gatekeeper("A", 315, gk)
    assert not rules.is_gatekeeper("T", 315, None)
    assert not rules.is_gatekeeper("", 0, gk)
    assert not rules.is_gatekeeper("deletion_19", 0, gk)


@pytest.mark.parametrize("context,drugs,diseases,effect", [
    ("Imatinib resistance in CML", ["Imatinib"], ["CML"], "resistance"),
    ("Lorlatinib resistance in NSCLC", ["Lorlatinib"], ["NSCLC"], "resistance"),
    ("Imatinib resistance in DFSP", ["Imatinib"], ["DFSP"], "resistance"),
    ("Osimertinib resistance", ["Osimertinib"], [], "resistance"),
    ("Third-gen TKI resistance", ["Third-gen TKI"], [], "resistance"),
    ("MET inhibitor resistance", ["MET inhibitor"], [], "resistance"),
    ("Ruxolitinib response", ["Ruxolitinib"], [], "other"),
    ("Mastocytosis", [], ["Mastocytosis"], "other"),
    ("Activating mutation in AML", [], ["AML"], "activating"),
    ("", [], [], "other"),
])
def test_parse_context(context, drugs, diseases, effect):
    parsed = rules.parse_context(context)
    assert [d["name"] for d in parsed["drugs"]] == drugs
    assert parsed["diseases"] == diseases
    assert parsed["effect_type"] == effect


def test_curated_fields_require_publication_naming():
    text = "Acquired resistance to imatinib in chronic myeloid leukemia by T315I."
    f = rules.curated_fields("Imatinib resistance in CML", text)
    assert f["affected_drugs"] == ["Imatinib"] and f["unconfirmed_drugs"] == []
    assert f["associated_diseases"] == ["CML"]
    assert f["curation_note"] == "Imatinib resistance in CML"
    assert f["section"] == "literature_curated"
    f = rules.curated_fields("Third-gen TKI resistance", "Resistance to third-generation EGFR TKI AZD9291.")
    assert f["affected_drugs"] == [] and f["unconfirmed_drugs"] == ["Third-gen TKI"]
    f = rules.curated_fields("Ponatinib resistance", None)
    assert f["affected_drugs"] == [] and f["unconfirmed_drugs"] == ["Ponatinib"]
    assert not rules.named_in("imatinibs", "imatinib")


def test_select_klifs_entry_prefers_primary_domain():
    klifs = [
        {"kinase_ID": 439, "name": "JAK2-b", "HGNC": "JAK2-b", "uniprot": "O60674", "pocket": ""},
        {"kinase_ID": 436, "name": "JAK2", "HGNC": "JAK2", "uniprot": "O60674", "pocket": ""},
        {"kinase_ID": 1, "name": "OLD", "HGNC": "OLDNAME", "uniprot": "P99999", "pocket": ""},
    ]
    assert select_klifs_entry({"gene_symbol": "JAK2", "uniprot_id": "O60674"}, klifs)["kinase_ID"] == 436
    assert select_klifs_entry({"gene_symbol": "NEW", "uniprot_id": "P99999"}, klifs)["kinase_ID"] == 1
    assert select_klifs_entry({"gene_symbol": "NONE", "uniprot_id": "Q0"}, klifs) is None


def test_parse_pubmed_xml():
    xml = """<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>1</PMID><Article>
    <ArticleTitle>T315I and <i>imatinib</i></ArticleTitle><Abstract><AbstractText Label="A">One.</AbstractText>
    <AbstractText>Two.</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>"""
    rec = parse_pubmed_xml(xml)["1"]
    assert rec["title"] == "T315I and imatinib" and rec["abstract"] == "One. Two."


def test_gatekeeper_mapping_hinge_insertion():
    # PIM1-like: the sequence carries one extra hinge residue, so only pocket 42-48 is contiguous
    pocket = "A" * 41 + "VLILERPEVQDLFDFITE" + "C" * 26
    sequence = "MKK" + "VLILERPEPVQDLFDFITERG"
    mapped = rules.map_pocket_residue(pocket, sequence)
    assert mapped["anchor_pocket_range"] == [42, 48]
    assert mapped["position"] == 3 + 3 + 1 and mapped["residue"] == "L"


def test_citation_check():
    check = rules.citation_check("ABL1", "T315I", "BCR-ABL1 T315I confers resistance to imatinib.")
    assert check == {"pmid_resolves": True, "names_gene": True, "names_mutation": True}
    check = rules.citation_check("ABL1", "T315I", "Key strategies for reducing avian influenza.")
    assert check == {"pmid_resolves": True, "names_gene": False, "names_mutation": False}
    assert rules.citation_check("ABL1", "T315I", None)["pmid_resolves"] is False
