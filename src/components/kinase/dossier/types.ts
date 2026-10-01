import type { PdisComponents } from "@/lib/pdis";
import type { PdisRawValues } from "@/lib/catalog/types";

export interface StructureEntry {
  pdb_id: string;
  title: string;
  experimental_method: string | null;
  resolution: number | null;
  release_date: string | null;
  emdb: { id: string; url: string }[];
  bound_ligands: { comp_id: string; name: string }[];
  rcsb_url: string;
  reason?: string | null;
}

export interface StructurePage {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  by_method: Record<string, number>;
  entries: StructureEntry[];
}

export interface AlphaFoldInfo {
  available: boolean;
  message?: string;
  entry_id?: string;
  model_version?: number | null;
  global_plddt?: number | null;
  uniprot_start?: number | null;
  uniprot_end?: number | null;
  cif_url?: string | null;
  pdb_url?: string | null;
  pae_image_url?: string | null;
  entry_url: string;
  note?: string;
}

export interface PdisScore {
  overall_score: number;
  rank_default: number | null;
  components: Record<keyof PdisComponents, number | null>;
  raw_values: PdisRawValues | null;
  default_weights: Record<keyof PdisComponents, number>;
  normalisation: { n_max: number; c_max: number } | null;
  formula_version: string | null;
  note: string;
}

export interface TissueExpression {
  tissue_name: string;
  tissue_site_id: string | null;
  organ_system: string;
  tpm_value: number;
  tau_specificity: number | null;
  data_source: string;
  gtex_url: string;
}

export interface ClinvarVariant {
  mutation_code: string;
  position: number | null;
  hgvs: string | null;
  clinvar_uid: string | null;
  clinvar_accession: string | null;
  classification: string | null;
  review_status: string | null;
  review_stars: number | null;
  conditions: string[];
  last_evaluated: string | null;
  url: string | null;
}

export interface CuratedMutation {
  mutation_code: string;
  position: number | null;
  is_gatekeeper: boolean;
  effect_type: string | null;
  associated_diseases: string[];
  affected_drugs: string[];
  unconfirmed_drugs: string[];
  curation_note: string | null;
  gatekeeper_basis: string | null;
  pubmed_id: string | null;
  citation_verified: boolean;
  citation_status: string;
  publication_title: string | null;
  pubmed_url: string | null;
  doi: string | null;
}

export interface LigandSummary {
  representative_rows: number;
  records: number;
  rows_in_both_sources: number;
  by_source: Record<string, { rows: number; records: number }>;
}

export interface KinaseDetail {
  gene_symbol: string;
  name: string;
  uniprot_id: string;
  uniprot_record_status: string;
  partition: "kinhub_core" | "uniprot_extended";
  group: string | null;
  extension_class: string | null;
  extension_class_basis: string | null;
  extension_banner: string | null;
  display_category: string;
  classification: { group: string | null; display_category: string; family: string; subfamily: string };
  swiss_prot_annotation?: {
    reviewed: boolean;
    section: string;
    functions: string[];
    catalytic_activities: string[];
    subunit_annotations: string[];
    source_url: string | null;
  };
  ec_number?: string;
  pdis_score: PdisScore | null;
  pharos: { tdl: string | null; url: string } | null;
  gatekeeper: { residue: string; position: number; source_url?: string } | null;
  expression: { source: string; gene_url: string; tau_specificity: number | null; top_tissue: string | null };
  tissue_expressions: TissueExpression[];
  organ_systems_impacted: string[];
  structures: StructurePage;
  other_structures: StructureEntry[];
  pdis_structure_input_count: number | null;
  alphafold: AlphaFoldInfo;
  ligand_summary: LigandSummary | null;
  development_candidates: Array<{ name: string; mechanism: string; status: string; sourceLabel: string; sourceUrl: string }>;
  clinvar_variants: ClinvarVariant[];
  curated_mutations: CuratedMutation[];
  diseases_associated: { name: string; description: string; omim_id: string }[];
  key_references: { pubmed_id: string; citation_text: string; doi?: string; relevance_tag: string }[];
  domains?: { name: string; start: number; end: number }[];
}
