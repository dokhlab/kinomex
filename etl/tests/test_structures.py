"""Unit tests for the RCSB metadata rules of Task 8 (no network, no database)."""
from __future__ import annotations

from etl.jmb_revision import rcsb_meta
from etl.jmb_revision.structures import search_body
from etl.jmb_revision.structures_reconcile import entry_reasons


def _np(*comps):
    return [{"nonpolymer_comp": {"chem_comp": {"id": c, "name": n, "type": "non-polymer"}}} for c, n in comps]


ENTRY = {
    "rcsb_id": "7abc",
    "struct": {"title": "Kinase in complex with inhibitor"},
    "exptl": [{"method": "ELECTRON MICROSCOPY"}],
    "rcsb_entry_info": {"resolution_combined": [3.1]},
    "rcsb_accession_info": {"deposit_date": "2025-01-02T00:00:00Z", "initial_release_date": "2025-06-11T00:00:00Z"},
    "rcsb_entry_container_identifiers": {"emdb_ids": ["EMD-12345"], "related_emdb_ids": ["EMD-12346"]},
    "pdbx_database_related": [{"db_name": "EMDB", "db_id": "EMD-12347", "content_type": "other EM volume"},
                              {"db_name": "PDB", "db_id": "6XYZ", "content_type": "unspecified"}],
    "polymer_entities": [
        {"rcsb_polymer_entity_container_identifiers": {"reference_sequence_identifiers": [
            {"database_name": "UniProt", "database_accession": "P48730"}]},
         "rcsb_entity_source_organism": [{"ncbi_scientific_name": "Homo sapiens"}]},
        {"rcsb_polymer_entity_container_identifiers": {"reference_sequence_identifiers": [
            {"database_name": "UniProt", "database_accession": "P62988"},
            {"database_name": "GenBank", "database_accession": "X1"}]}},
    ],
    "nonpolymer_entities": _np(("HOH", "WATER"), ("ANP", "AMP-PNP"), ("MG", "MAGNESIUM ION"),
                               ("GOL", "GLYCEROL"), ("EPE", "HEPES"), ("STU", "STAUROSPORINE"),
                               ("SO4", "SULFATE ION"), ("ANP", "AMP-PNP"), ("UNX", "UNKNOWN")),
}


def test_ligand_filter_keeps_nucleotides_and_drugs():
    ligands = rcsb_meta.bound_ligands(ENTRY["nonpolymer_entities"])
    assert ligands == [{"comp_id": "ANP", "name": "AMP-PNP"}, {"comp_id": "STU", "name": "STAUROSPORINE"}]


def test_exclusion_list_contents():
    for code in ("HOH", "DOD", "NA", "CL", "ZN", "SO4", "PO4", "ACT", "GOL", "EDO", "PEG", "PG4", "DMS",
                 "TRS", "MES", "EPE", "BME", "DTT", "UNX", "UNL", "NAG"):
        assert rcsb_meta.is_excluded_component(code)
    for code in ("ATP", "ADP", "ANP", "ACP", "AMP", "STI", "STU", "GLC", "PYR", "FBP"):
        assert not rcsb_meta.is_excluded_component(code)
    assert rcsb_meta.is_excluded_component("") and rcsb_meta.is_excluded_component(None)
    assert rcsb_meta.bound_ligands(None) == []


def test_parse_entry_fields():
    parsed = rcsb_meta.parse_entry(ENTRY, {"P48730": "CSNK1D"})
    assert parsed["pdb_id"] == "7ABC"
    assert parsed["experimental_method"] == "ELECTRON MICROSCOPY"
    assert parsed["resolution"] == 3.1
    assert parsed["release_date"] == "2025-06-11" and parsed["deposit_date"] == "2025-01-02"
    assert parsed["emdb_ids"] == ["EMD-12345", "EMD-12346", "EMD-12347"]
    assert parsed["uniprot_ids"] == ["P48730"]
    assert parsed["gene_symbols"] == ["CSNK1D"]
    assert parsed["human_source"] is True


def test_parse_entry_handles_nulls():
    parsed = rcsb_meta.parse_entry({"rcsb_id": "1abc", "exptl": [{"method": "SOLUTION NMR"}],
                                    "rcsb_entry_info": {"resolution_combined": None},
                                    "rcsb_entry_container_identifiers": {"emdb_ids": None},
                                    "polymer_entities": None, "nonpolymer_entities": None}, {})
    assert parsed["resolution"] is None and parsed["emdb_ids"] == [] and parsed["bound_ligands"] == []
    assert parsed["release_date"] is None and parsed["human_source"] is False


def test_emdb_prefix_normalised():
    entry = {"rcsb_entry_container_identifiers": {"emdb_ids": ["12345", "EMD-12345"]}}
    assert rcsb_meta.emdb_ids(entry) == ["EMD-12345"]


def test_other_entry_reason():
    assert rcsb_meta.other_entry_reason(["ELECTRON MICROSCOPY"], 3.8) == rcsb_meta.REASON_EM
    assert rcsb_meta.other_entry_reason(["ELECTRON MICROSCOPY"], 3.5) is None
    assert rcsb_meta.other_entry_reason(["ELECTRON MICROSCOPY"], None) is None
    assert rcsb_meta.other_entry_reason(["SOLUTION NMR"], None) == rcsb_meta.REASON_NMR
    assert rcsb_meta.other_entry_reason(["SOLID-STATE NMR"], None) == "NMR"
    assert rcsb_meta.other_entry_reason(["X-RAY DIFFRACTION"], 4.2) is None
    assert rcsb_meta.REASON_EM == "Electron microscopy above 3.5 Å"


def test_reconciliation_reasons():
    base = {"release_date": "2026-08-05", "resolution": 2.0, "human_source": True}
    assert entry_reasons({**base, "release_date": "2026-08-19"}, True) == ["released after the 2026-08-12 import"]
    assert entry_reasons({**base, "release_date": "2026-08-12"}, True) == ["matches the import query today; cause undetermined"]
    assert "resolution exactly 3.5 Å; the import query used < 3.5 Å" in entry_reasons({**base, "resolution": 3.5}, False)
    assert entry_reasons({**base, "human_source": False}, False) == [
        "no Homo sapiens source organism; the import query required one"]
    assert entry_reasons(None, False) == ["no RCSB Data API record"]


def test_search_body_matches_analysis_script():
    body = search_body(["P48730"], [])
    nodes = body["query"]["nodes"]
    assert nodes[0]["parameters"]["value"] == ["P48730"]
    assert nodes[1]["parameters"]["value"] == "UniProt"
    assert body["request_options"]["results_content_type"] == ["experimental"]
    assert body["request_options"]["return_all_hits"] is True
    imported = search_body(["P48730"], [], import_like=True)["query"]["nodes"]
    assert imported[1]["parameters"] == {"attribute": "rcsb_entry_info.resolution_combined", "operator": "less", "value": 3.5}
