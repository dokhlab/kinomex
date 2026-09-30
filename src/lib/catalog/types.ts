import type { PdisComponents } from "@/lib/pdis";

export type Partition = "kinhub_core" | "uniprot_extended";

export const KINHUB_GROUPS = ["AGC", "CAMK", "CK1", "CMGC", "STE", "TK", "TKL", "RGC", "Atypical", "Other"] as const;

export const EXTENSION_CLASSES = [
  "Protein kinase outside KinHub roster",
  "Lipid kinase",
  "Inositol phosphate kinase",
  "Nucleotide, nucleoside or nucleic-acid kinase",
  "Carbohydrate or central-metabolism kinase",
  "Cofactor, amino-acid or other small-molecule kinase",
  "Keyword-annotated entry without established kinase catalytic role",
] as const;

export const EXTENSION_RING_LABEL = "UniProt KW-0418 extensions";

export const PARTITION_LABELS: Record<Partition, string> = {
  kinhub_core: "KinHub core",
  uniprot_extended: "UniProt extensions",
};

export interface PdisRawValues {
  pubmed_publication_count: number | null;
  clinical_trial_count: number | null;
  pdb_count: number | null;
  best_resolution_angstrom: number | null;
  average_resolution_angstrom: number | null;
  distinct_compound_count: number | null;
}

export interface ExpressionSummary {
  tau: number;
  top_tissue: string;
  top_organ: string;
  top_tpm: number;
  gencode_id: string | null;
}

export interface CatalogRow {
  gene_symbol: string;
  uniprot_id: string;
  name: string;
  partition: Partition;
  group: string | null;
  extension_class: string | null;
  display_category: string;
  family: string;
  subfamily: string;
  uniprot_record_status: string;
  kinase_domain_count: number;
  components: PdisComponents | null;
  raw_values: PdisRawValues | null;
  pdis_default: number | null;
  rank_default: number | null;
  expression: ExpressionSummary | null;
  organ_systems: string[];
  diseases: string[];
  clinvar_records: number;
  curated_mutations: number;
  has_alphafold: boolean;
  pharos_tdl: string | null;
}

export interface SourceCoverage {
  source: string;
  label: string;
  records: number | null;
  entries_with_records: number | null;
  gap: number | null;
  core_entries_with_records?: number | null;
  note?: string;
}

export interface CatalogAccounting {
  snapshot_date: string | null;
  total_entries: number;
  core_entries: number;
  extension_entries: number;
  kinhub_domain_rows: number;
  inactive_historical_entries: number;
  inactive_entries: { gene_symbol: string; uniprot_id: string }[];
  reviewed_uniprot_keyword_entries: number | null;
  kinhub_keyword_overlap_entries: number | null;
  kinhub_supplemental_entries: number | null;
  core_group_counts: Record<string, number>;
  extension_class_counts: Record<string, number>;
  sources: SourceCoverage[];
  quarantine: { collection: string; records: number | null; genes: number | null; reason: string }[];
  generated_at: string;
}
