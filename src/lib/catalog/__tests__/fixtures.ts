import type { CatalogRow } from "@/lib/catalog/types";

export function row(gene: string, overrides: Partial<CatalogRow> = {}): CatalogRow {
  return {
    gene_symbol: gene,
    uniprot_id: `P${gene}`,
    name: `${gene} kinase`,
    partition: "kinhub_core",
    group: "TK",
    extension_class: null,
    display_category: "TK",
    subfamily: "",
    uniprot_record_status: "active",
    kinase_domain_count: 1,
    components: { citation: 50, clinical_trials: 50, structure: 50, compound_diversity: 50 },
    raw_values: {
      pubmed_publication_count: 10, clinical_trial_count: 0, pdb_count: 1,
      best_resolution_angstrom: 2, average_resolution_angstrom: 2, distinct_compound_count: 10,
    },
    pdis_default: 50,
    rank_default: 1,
    expression: null,
    organ_systems: [],
    diseases: [],
    clinvar_records: 0,
    curated_mutations: 0,
    has_alphafold: true,
    pharos_tdl: null,
    ...overrides,
  };
}

export function flat(gene: string, score: number | null, overrides: Partial<CatalogRow> = {}): CatalogRow {
  return row(gene, {
    components: score === null ? null : { citation: score, clinical_trials: score, structure: score, compound_diversity: score },
    pdis_default: score,
    ...overrides,
  });
}
