import {
  DEFAULT_WEIGHTS,
  histogram,
  rankScores,
  round2,
  weightedScore,
  type HistogramBin,
  type PdisWeights,
} from "@/lib/pdis";
import type { CatalogRow, Partition } from "@/lib/catalog/types";

export const TISSUE_ENRICHED_TAU = 0.8;
export const TISSUE_ENRICHED_MIN_TPM = 1;

export interface CatalogFilters {
  search?: string;
  partition?: Partition | "all";
  category?: string;
  organ?: string;
  tissueEnriched?: boolean;
  maxCitations?: number | null;
  hasStructure?: boolean;
  minCompounds?: number | null;
  pdisMin?: number;
  pdisMax?: number;
}

export type CatalogSort = "pdis" | "-pdis" | "gene_symbol" | "-gene_symbol" | "category" | "citations" | "compounds";

export interface ScoredRow extends CatalogRow {
  pdis_weighted: number | null;
  rank_weighted: number | null;
}

// Scores and ranks every entry with the given weights. Ranks cover the whole
// catalog, so a filtered view keeps each entry's catalog-wide rank.
export function scoreCatalog(rows: CatalogRow[], weights: PdisWeights = DEFAULT_WEIGHTS): ScoredRow[] {
  const exact = new Map<CatalogRow, number>();
  for (const row of rows) {
    if (row.components) exact.set(row, weightedScore(row.components, weights));
  }
  const scored = rows.filter((row) => exact.has(row));
  const ranks = rankScores(scored, (row) => exact.get(row)!, (row) => row.gene_symbol);
  return rows.map((row) => ({
    ...row,
    pdis_weighted: exact.has(row) ? round2(exact.get(row)!) : null,
    rank_weighted: ranks.get(row) ?? null,
  }));
}

export function matchesTissueEnriched(row: CatalogRow, organ: string): boolean {
  const e = row.expression;
  return !!e && e.top_organ === organ && e.tau >= TISSUE_ENRICHED_TAU && e.top_tpm >= TISSUE_ENRICHED_MIN_TPM;
}

// Filters that do not depend on the PDIS interval.
export function applyEvidenceFilters<T extends CatalogRow>(rows: T[], filters: CatalogFilters): T[] {
  const needle = (filters.search ?? "").trim().toLowerCase();
  return rows.filter((row) => {
    if (needle && !row.gene_symbol.toLowerCase().includes(needle) && !row.name.toLowerCase().includes(needle)
      && !row.uniprot_id.toLowerCase().includes(needle)) return false;
    if (filters.partition && filters.partition !== "all" && row.partition !== filters.partition) return false;
    if (filters.category && row.display_category !== filters.category) return false;
    if (filters.organ) {
      if (filters.tissueEnriched) {
        if (!matchesTissueEnriched(row, filters.organ)) return false;
      } else if (row.expression?.top_organ !== filters.organ) {
        return false;
      }
    }
    const raw = row.raw_values;
    if (filters.maxCitations != null && !(raw?.pubmed_publication_count != null && raw.pubmed_publication_count <= filters.maxCitations)) return false;
    if (filters.hasStructure && !((raw?.pdb_count ?? 0) > 0)) return false;
    if (filters.minCompounds != null && !((raw?.distinct_compound_count ?? 0) >= filters.minCompounds)) return false;
    return true;
  });
}

export function applyPdisInterval(rows: ScoredRow[], min = 0, max = 100): ScoredRow[] {
  if (min <= 0 && max >= 100) return rows;
  return rows.filter((row) => row.pdis_weighted !== null && row.pdis_weighted >= min && row.pdis_weighted <= max);
}

export function sortRows(rows: ScoredRow[], sort: CatalogSort = "pdis"): ScoredRow[] {
  const byGene = (a: ScoredRow, b: ScoredRow) => a.gene_symbol.localeCompare(b.gene_symbol);
  const byRank = (a: ScoredRow, b: ScoredRow) => (a.rank_weighted ?? Infinity) - (b.rank_weighted ?? Infinity) || byGene(a, b);
  const comparators: Record<CatalogSort, (a: ScoredRow, b: ScoredRow) => number> = {
    pdis: byRank,
    "-pdis": (a, b) => -byRank(a, b),
    gene_symbol: byGene,
    "-gene_symbol": (a, b) => -byGene(a, b),
    category: (a, b) => a.display_category.localeCompare(b.display_category) || byGene(a, b),
    citations: (a, b) => (b.raw_values?.pubmed_publication_count ?? -1) - (a.raw_values?.pubmed_publication_count ?? -1) || byGene(a, b),
    compounds: (a, b) => (b.raw_values?.distinct_compound_count ?? -1) - (a.raw_values?.distinct_compound_count ?? -1) || byGene(a, b),
  };
  return [...rows].sort(comparators[sort]);
}

export function countBy<T>(rows: T[], key: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[key(row)] = (counts[key(row)] ?? 0) + 1;
  return counts;
}

export interface CatalogQueryResult {
  rows: ScoredRow[];
  total: number;
  categoryBreakdown: Record<string, number>;
  partitionBreakdown: Record<string, number>;
  histogram: HistogramBin[];
}

// The histogram shows the weighted scores of the evidence-filtered set before
// the PDIS interval, so the interval brush stays meaningful.
export function queryCatalog(
  rows: CatalogRow[],
  filters: CatalogFilters,
  weights: PdisWeights = DEFAULT_WEIGHTS,
  sort: CatalogSort = "pdis",
): CatalogQueryResult {
  const scored = scoreCatalog(rows, weights);
  const evidence = applyEvidenceFilters(scored, filters);
  const filtered = sortRows(applyPdisInterval(evidence, filters.pdisMin, filters.pdisMax), sort);
  return {
    rows: filtered,
    total: filtered.length,
    categoryBreakdown: countBy(filtered, (row) => row.display_category),
    partitionBreakdown: countBy(filtered, (row) => row.partition),
    histogram: histogram(evidence.filter((row) => row.pdis_weighted !== null).map((row) => row.pdis_weighted as number)),
  };
}
