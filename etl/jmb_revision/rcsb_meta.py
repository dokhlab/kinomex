"""Pure parsing rules for RCSB entry metadata (Task 8): ligands, EMDB links, classes.

``bound_ligands`` keeps every non-polymer chemical component of a PDB entry except
the components in ``EXCLUDED_COMPONENTS``: solvent, ions, crystallisation and
cryoprotection additives, buffers, detergents, reductants, placeholder components
and N-glycan sugars. Nucleotides (ATP, ADP, ANP, ACP, AMP and others), cofactors,
substrates and drug-like ligands stay in the list.
"""
from __future__ import annotations

from typing import Any, Iterable

SOLVENTS = frozenset({"HOH", "DOD", "WAT", "H2O", "DIS"})
IONS = frozenset({
    # alkali, alkaline-earth and transition-metal ions
    "LI", "NA", "K", "RB", "CS", "MG", "CA", "SR", "BA", "MN", "MN3", "FE", "FE2", "CO", "3CO",
    "NI", "CU", "CU1", "ZN", "CD", "HG", "AG", "AL", "GA", "TL", "PB",
    # lanthanides and heavy atoms used for phasing
    "YB", "SM", "GD", "LU", "HO", "TB", "EU", "LA", "CE", "PR", "ER", "YT3", "OS", "IR", "PT4",
    # halides and simple inorganic anions/cations
    "F", "CL", "BR", "IOD", "I", "OH", "O", "NH4", "SO4", "SUL", "PO4", "PI", "2HP", "NO3",
    "NO2", "CO3", "BCT", "AZI", "CYN", "SCN", "PER", "SO3", "S", "SE", "SE4", "WO4", "MOO",
    "NH3", "ACT",
})
ADDITIVES = frozenset({
    # polyols, polyethylene glycols and cryoprotectants
    "GOL", "EDO", "PEG", "PG4", "PGE", "1PE", "P6G", "2PE", "12P", "15P", "PE4", "PE5",
    "PE8", "P33", "PG0", "PG5", "PG6", "XPE", "7PE", "MPD", "MRD", "PGO", "PGR", "HEZ",
    "BU3", "BU1", "1BO", "IPA", "EOH", "MOH", "ETE", "TOE", "P4C", "PDO", "SRT",
    "PE3", "ETX", "DIO", "SGM",
    # organic solvents
    "DMS", "DMF", "ACN", "ACE", "NH2",
    # carboxylic acids and their salts
    "FMT", "ACY", "CIT", "FLC", "TAR", "TLA", "MLI", "MLA", "SIN", "OXL", "LAC", "MAE",
    "FUM", "GLY", "MLT", "PPI", "PHS",
    # buffers
    "TRS", "TAM", "MES", "EPE", "HEPES", "MPO", "PIN", "CXS", "B3P", "BTB", "CAC", "IMD",
    "BIC", "BCN", "NHE", "TBU", "144", "TMA", "BEN",
    # reducing agents
    "BME", "DTT", "DTU", "DTV", "DTD", "TCE", "TCEP",
    # detergents and lipids used as additives
    "BOG", "LDA", "LMT", "BNG", "C8E", "SDS", "DMU", "UMQ", "HTG", "CPS", "Y01",
    # placeholder components
    "UNX", "UNL", "UNK",
    # N-glycan sugars
    "NAG", "NDG", "BMA", "MAN", "FUC",
})
EXCLUDED_COMPONENTS = SOLVENTS | IONS | ADDITIVES

NMR_METHODS = frozenset({"SOLUTION NMR", "SOLID-STATE NMR"})
EM_METHOD = "ELECTRON MICROSCOPY"
SCORED_MAX_RESOLUTION = 3.5
REASON_EM = "Electron microscopy above 3.5 Å"
REASON_NMR = "NMR"


def is_excluded_component(comp_id: str | None) -> bool:
    return not comp_id or comp_id.strip().upper() in EXCLUDED_COMPONENTS


def bound_ligands(nonpolymer_entities: Iterable[dict[str, Any]] | None) -> list[dict[str, str]]:
    """Unique retained ligands in entity order: [{comp_id, name}]."""
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for entity in nonpolymer_entities or []:
        comp = ((entity or {}).get("nonpolymer_comp") or {}).get("chem_comp") or {}
        comp_id = str(comp.get("id") or "").strip().upper()
        if is_excluded_component(comp_id) or comp_id in seen:
            continue
        seen.add(comp_id)
        out.append({"comp_id": comp_id, "name": str(comp.get("name") or "").strip()})
    return out


def emdb_ids(entry: dict[str, Any]) -> list[str]:
    """Associated EMDB maps first, then related EMDB entries of the PDB entry."""
    ids: list[str] = []
    containers = entry.get("rcsb_entry_container_identifiers") or {}
    candidates = list(containers.get("emdb_ids") or []) + list(containers.get("related_emdb_ids") or [])
    for rel in entry.get("pdbx_database_related") or []:
        if str((rel or {}).get("db_name") or "").upper() == "EMDB" and rel.get("db_id"):
            candidates.append(rel["db_id"])
    for value in candidates:
        value = str(value).strip().upper()
        if not value:
            continue
        if not value.startswith("EMD-"):
            value = f"EMD-{value}"
        if value not in ids:
            ids.append(value)
    return ids


def uniprot_accessions(entry: dict[str, Any]) -> list[str]:
    accs: list[str] = []
    for entity in entry.get("polymer_entities") or []:
        ids = ((entity or {}).get("rcsb_polymer_entity_container_identifiers") or {})
        for ref in ids.get("reference_sequence_identifiers") or []:
            if (ref or {}).get("database_name") == "UniProt" and ref.get("database_accession"):
                acc = str(ref["database_accession"]).strip().upper()
                if acc not in accs:
                    accs.append(acc)
    return accs


def has_human_source(entry: dict[str, Any]) -> bool:
    for entity in entry.get("polymer_entities") or []:
        for org in (entity or {}).get("rcsb_entity_source_organism") or []:
            if (org or {}).get("ncbi_scientific_name") == "Homo sapiens":
                return True
    return False


def _date(value: Any) -> str | None:
    return str(value)[:10] if value else None


def parse_entry(entry: dict[str, Any], acc_to_gene: dict[str, str]) -> dict[str, Any]:
    """Flatten one GraphQL ``entries`` item into the fields KinomeX stores."""
    methods = [str(m.get("method")) for m in entry.get("exptl") or [] if m and m.get("method")]
    res = (entry.get("rcsb_entry_info") or {}).get("resolution_combined")
    if isinstance(res, list):
        res = res[0] if res else None
    accession = entry.get("rcsb_accession_info") or {}
    accs = uniprot_accessions(entry)
    catalog = [a for a in accs if a in acc_to_gene]
    return {
        "pdb_id": str(entry.get("rcsb_id") or "").upper(),
        "experimental_method": methods[0] if methods else None,
        "methods": methods,
        "resolution": float(res) if res is not None else None,
        "title": ((entry.get("struct") or {}).get("title") or ""),
        "release_date": _date(accession.get("initial_release_date")),
        "deposit_date": _date(accession.get("deposit_date")),
        "revision_date": _date(accession.get("revision_date")),
        "emdb_ids": emdb_ids(entry),
        "uniprot_ids": catalog,
        "gene_symbols": sorted({acc_to_gene[a] for a in catalog}),
        "bound_ligands": bound_ligands(entry.get("nonpolymer_entities")),
        "human_source": has_human_source(entry),
    }


def other_entry_reason(methods: Iterable[str], resolution: float | None) -> str | None:
    """Reason an experimental entry is listed as 'other' (not scored), else None."""
    methods = [str(m).upper() for m in methods]
    if any(m in NMR_METHODS for m in methods):
        return REASON_NMR
    if EM_METHOD in methods and resolution is not None and resolution > SCORED_MAX_RESOLUTION:
        return REASON_EM
    return None
