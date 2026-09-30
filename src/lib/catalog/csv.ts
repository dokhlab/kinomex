import { COMPONENT_KEYS, type PdisWeights } from "@/lib/pdis";
import type { ScoredRow } from "@/lib/catalog/query";
import { PARTITION_LABELS } from "@/lib/catalog/types";

function cell(value: unknown): string {
  if (value === null || value === undefined) return "unavailable";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CSV_COLUMNS = [
  "rank_weighted", "gene_symbol", "uniprot_id", "partition", "category",
  "pubmed_publication_count", "clinical_trial_count", "pdb_count", "best_resolution_angstrom",
  "average_resolution_angstrom", "distinct_compound_count",
  "citation_component", "clinical_trial_component", "structure_component", "compound_component",
  "weight_citation", "weight_trials", "weight_structure", "weight_compounds",
  "pdis_default", "pdis_weighted",
];

// One row per filtered entry; missing values read "unavailable", never 0.
export function catalogCsv(rows: ScoredRow[], weights: PdisWeights): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    const raw = row.raw_values;
    lines.push([
      row.rank_weighted, row.gene_symbol, row.uniprot_id, PARTITION_LABELS[row.partition], row.display_category,
      raw?.pubmed_publication_count, raw?.clinical_trial_count, raw?.pdb_count, raw?.best_resolution_angstrom,
      raw?.average_resolution_angstrom, raw?.distinct_compound_count,
      ...COMPONENT_KEYS.map((key) => row.components?.[key]),
      ...weights,
      row.pdis_default, row.pdis_weighted,
    ].map(cell).join(","));
  }
  return `${lines.join("\n")}\n`;
}
