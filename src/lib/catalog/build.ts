import { COMPONENT_KEYS, type PdisComponents } from "@/lib/pdis";
import {
  EXTENSION_CLASSES,
  KINHUB_GROUPS,
  type CatalogAccounting,
  type CatalogRow,
  type Partition,
  type PdisRawValues,
  type SourceCoverage,
} from "@/lib/catalog/types";

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface CatalogInputs {
  kinases: Doc[];
  pdis: Doc[];
  expression: Doc[];
  variantCounts: { _id: { gene: string; source: string }; n: number }[];
  diseases: Doc[];
  catalogMetadata: Doc | null;
  releaseMetadata: Doc | null;
  structureGenes: string[];
  structureCount: number;
  ligandStats: { _id: { gene: string; source: string }; pairs: number; records: number }[];
  alphafold: Doc[] | null;
  pharos: Doc[] | null;
  quarantineExpression: Doc[] | null;
  quarantineChembl: Doc[] | null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function displayCategory(doc: Doc): string {
  if (doc.catalog_membership === "uniprot_extended") return doc.extension_class || "Unclassified extension";
  return doc.group || "Unassigned";
}

function components(doc: Doc | undefined): PdisComponents | null {
  if (!doc?.components) return null;
  const out = {} as PdisComponents;
  for (const key of COMPONENT_KEYS) {
    const value = finite(doc.components[key]);
    if (value === null) return null;
    out[key] = value;
  }
  return out;
}

function rawValues(doc: Doc | undefined): PdisRawValues | null {
  const raw = doc?.raw_values;
  if (!raw) return null;
  return {
    pubmed_publication_count: finite(raw.pubmed_publication_count),
    clinical_trial_count: finite(raw.clinical_trial_count),
    pdb_count: finite(raw.pdb_count),
    best_resolution_angstrom: finite(raw.best_resolution_angstrom),
    average_resolution_angstrom: finite(raw.average_resolution_angstrom),
    distinct_compound_count: finite(raw.distinct_compound_count),
  };
}

export function buildCatalogRows(inputs: CatalogInputs): CatalogRow[] {
  const pdis = new Map(inputs.pdis.map((d) => [d.gene_symbol, d]));
  const expression = new Map(inputs.expression.map((d) => [d._id, d]));
  const diseases = new Map(inputs.diseases.map((d) => [d.gene_symbol, (d.diseases || []).map((x: Doc) => x.disease_id).filter(Boolean)]));
  const variants = new Map<string, { clinvar: number; curated: number }>();
  for (const v of inputs.variantCounts) {
    const entry = variants.get(v._id.gene) ?? { clinvar: 0, curated: 0 };
    if (v._id.source === "clinvar") entry.clinvar += v.n;
    if (v._id.source === "curated") entry.curated += v.n;
    variants.set(v._id.gene, entry);
  }
  const alphafold = new Set((inputs.alphafold ?? []).map((d) => d.gene_symbol));
  const pharos = new Map((inputs.pharos ?? []).map((d) => [d.gene_symbol, d.tdl ?? null]));

  return inputs.kinases
    .map((k): CatalogRow => {
      const p = pdis.get(k.gene_symbol);
      const e = expression.get(k.gene_symbol);
      const comps = components(p);
      const partition: Partition = k.catalog_membership === "uniprot_extended" ? "uniprot_extended" : "kinhub_core";
      return {
        gene_symbol: k.gene_symbol,
        uniprot_id: k.uniprot_id,
        name: k.full_name || k.kinhub_domains?.[0]?.kinase_name || "Name unavailable",
        partition,
        group: partition === "kinhub_core" ? k.group ?? null : null,
        extension_class: partition === "uniprot_extended" ? k.extension_class ?? null : null,
        display_category: displayCategory(k),
        subfamily: k.subfamily || "",
        uniprot_record_status: k.uniprot_record_status || "active",
        kinase_domain_count: Array.isArray(k.kinhub_domains) ? k.kinhub_domains.length : 0,
        components: comps,
        raw_values: rawValues(p),
        pdis_default: comps ? finite(p?.pdis_total) : null,
        rank_default: finite(p?.rank_default),
        expression: e && finite(e.tau) !== null ? {
          tau: e.tau,
          top_tissue: e.top_tissue,
          top_organ: e.top_organ,
          top_tpm: e.top_tpm,
          gencode_id: e.gencode_id ?? null,
        } : null,
        organ_systems: e ? [...e.organ_systems].sort() : [],
        diseases: diseases.get(k.gene_symbol) ?? [],
        clinvar_records: variants.get(k.gene_symbol)?.clinvar ?? 0,
        curated_mutations: variants.get(k.gene_symbol)?.curated ?? 0,
        has_alphafold: alphafold.has(k.gene_symbol),
        pharos_tdl: pharos.get(k.gene_symbol) ?? null,
      };
    })
    .sort((a, b) => a.gene_symbol.localeCompare(b.gene_symbol));
}

function coverage(
  source: string,
  label: string,
  records: number | null,
  genes: Iterable<string> | null,
  catalog: Map<string, Partition>,
  note?: string,
): SourceCoverage {
  if (genes === null) return { source, label, records, entries_with_records: null, gap: null, core_entries_with_records: null, note };
  const covered = new Set(Array.from(genes).filter((g) => catalog.has(g)));
  const core = Array.from(covered).filter((g) => catalog.get(g) === "kinhub_core").length;
  return { source, label, records, entries_with_records: covered.size, gap: catalog.size - covered.size, core_entries_with_records: core, note };
}

export function buildAccounting(inputs: CatalogInputs): CatalogAccounting {
  const catalog = new Map<string, Partition>(inputs.kinases.map((k) => [
    k.gene_symbol, k.catalog_membership === "uniprot_extended" ? "uniprot_extended" : "kinhub_core",
  ]));
  const core = inputs.kinases.filter((k) => catalog.get(k.gene_symbol) === "kinhub_core");
  const extensions = inputs.kinases.filter((k) => catalog.get(k.gene_symbol) === "uniprot_extended");

  const coreGroups: Record<string, number> = Object.fromEntries(KINHUB_GROUPS.map((g) => [g, 0]));
  for (const k of core) coreGroups[k.group || "Unassigned"] = (coreGroups[k.group || "Unassigned"] ?? 0) + 1;
  const extensionClasses: Record<string, number> = Object.fromEntries(EXTENSION_CLASSES.map((c) => [c, 0]));
  for (const k of extensions) {
    const cls = k.extension_class || "Unclassified extension";
    extensionClasses[cls] = (extensionClasses[cls] ?? 0) + 1;
  }

  const ligandGenes: Record<string, Set<string>> = { chembl: new Set(), pubchem: new Set(), all: new Set() };
  const ligandTotals: Record<string, { pairs: number; records: number }> = {
    chembl: { pairs: 0, records: 0 }, pubchem: { pairs: 0, records: 0 }, all: { pairs: 0, records: 0 },
  };
  for (const row of inputs.ligandStats) {
    if (!catalog.has(row._id.gene)) continue;
    for (const key of [row._id.source, "all"]) {
      if (!ligandTotals[key]) continue;
      ligandTotals[key].pairs += row.pairs;
      ligandTotals[key].records += row.records;
      ligandGenes[key].add(row._id.gene);
    }
  }

  const variantGenes: Record<string, Set<string>> = { clinvar: new Set(), curated: new Set() };
  const variantRecords: Record<string, number> = { clinvar: 0, curated: 0 };
  for (const v of inputs.variantCounts) {
    if (!(v._id.source in variantGenes) || !catalog.has(v._id.gene)) continue;
    variantGenes[v._id.source].add(v._id.gene);
    variantRecords[v._id.source] += v.n;
  }

  const pdisGenes = (predicate: (raw: Doc) => boolean) =>
    inputs.pdis.filter((p) => p.raw_values && predicate(p.raw_values)).map((p) => p.gene_symbol);
  const gtexRecords = inputs.expression.reduce((sum, e) => sum + (e.records ?? 0), 0);
  const quarantineGenes = (docs: Doc[] | null, field: string) => (docs ? new Set(docs.map((d) => d[field])).size : null);

  const sources: SourceCoverage[] = [
    coverage("uniprot", "UniProtKB/Swiss-Prot entries", inputs.kinases.length, catalog.keys(), catalog),
    coverage("pdb", "Experimental structures (≤3.5 Å, RCSB PDB)", inputs.structureCount, inputs.structureGenes, catalog),
    coverage("alphafold", "AlphaFold DB models", inputs.alphafold ? inputs.alphafold.length : null,
      inputs.alphafold ? inputs.alphafold.map((d) => d.gene_symbol) : null, catalog),
    coverage("ligands", "Ligand records (ChEMBL + PubChem)", ligandTotals.all.records, ligandGenes.all, catalog),
    coverage("chembl", "ChEMBL activity records", ligandTotals.chembl.records, ligandGenes.chembl, catalog),
    coverage("pubchem", "PubChem AID 1433 records", ligandTotals.pubchem.records, ligandGenes.pubchem, catalog),
    { ...coverage("compound_pairs", "Compound–kinase pairs", ligandTotals.all.pairs, ligandGenes.all, catalog) },
    coverage("gtex", "GTEx v10 median expression records", gtexRecords, inputs.expression.map((e) => e._id), catalog),
    coverage("clinvar", "ClinVar missense records", variantRecords.clinvar, variantGenes.clinvar, catalog),
    coverage("curated_mutations", "Literature-curated mutations", variantRecords.curated, variantGenes.curated, catalog),
    coverage("uniprot_disease", "UniProt disease documents", inputs.diseases.length, inputs.diseases.map((d) => d.gene_symbol), catalog),
    coverage("pdis", "PDIS documents", inputs.pdis.length, inputs.pdis.map((p) => p.gene_symbol), catalog),
    coverage("pubmed", "Entries with ≥1 PubMed count", null, pdisGenes((r) => r.pubmed_publication_count > 0), catalog),
    coverage("clinicaltrials", "Entries with ≥1 counted trial", null, pdisGenes((r) => r.clinical_trial_count > 0), catalog),
    coverage("pharos", "Pharos TDL assignments", inputs.pharos ? inputs.pharos.filter((d) => d.tdl).length : null,
      inputs.pharos ? inputs.pharos.filter((d) => d.tdl).map((d) => d.gene_symbol) : null, catalog),
  ];

  const meta = inputs.catalogMetadata;
  const snapshot = inputs.releaseMetadata?.snapshot_date;
  return {
    snapshot_date: typeof snapshot === "string" ? snapshot : null,
    total_entries: inputs.kinases.length,
    core_entries: core.length,
    extension_entries: extensions.length,
    kinhub_domain_rows: core.reduce((sum, k) => sum + (Array.isArray(k.kinhub_domains) ? k.kinhub_domains.length : 0), 0),
    inactive_historical_entries: inputs.kinases.filter((k) => k.uniprot_record_status === "inactive").length,
    inactive_entries: inputs.kinases
      .filter((k) => k.uniprot_record_status === "inactive")
      .map((k) => ({ gene_symbol: k.gene_symbol, uniprot_id: k.uniprot_id })),
    reviewed_uniprot_keyword_entries: finite(meta?.reviewed_uniprot_keyword_entries),
    kinhub_keyword_overlap_entries: finite(meta?.kinhub_keyword_overlap_entries),
    kinhub_supplemental_entries: finite(meta?.kinhub_supplemental_entries),
    core_group_counts: coreGroups,
    extension_class_counts: extensionClasses,
    sources,
    quarantine: [
      { collection: "expression_quarantine", records: inputs.quarantineExpression?.length ?? null,
        genes: quarantineGenes(inputs.quarantineExpression, "gene_symbol"), reason: "no GTEx identifier or source record" },
      { collection: "bioactivities_quarantine", records: inputs.quarantineChembl?.length ?? null,
        genes: quarantineGenes(inputs.quarantineChembl, "target_gene_symbol"), reason: "legacy ChEMBL rows without a current activity record" },
    ],
    generated_at: new Date().toISOString(),
  };
}

export function sourceByKey(accounting: CatalogAccounting, key: string): SourceCoverage | undefined {
  return accounting.sources.find((s) => s.source === key);
}
