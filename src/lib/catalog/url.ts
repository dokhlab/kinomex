import { DEFAULT_WEIGHTS, formatWeightsParam, parseWeightsParam, type PdisWeights } from "@/lib/pdis";
import type { CatalogFilters, CatalogSort } from "@/lib/catalog/query";
import type { Partition } from "@/lib/catalog/types";

export interface ExplorerState {
  filters: CatalogFilters;
  weights: PdisWeights;
  sort: CatalogSort;
}

const SORTS: CatalogSort[] = ["pdis", "-pdis", "gene_symbol", "-gene_symbol", "category", "citations", "compounds"];

function intOrNull(value: string | null): number | null {
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// Explorer address parameters. Default values produce no parameter, so the
// default view has a clean address and `?w=0.25,0.25,0.25,0.25` restores Equal weights.
export function stateFromParams(params: URLSearchParams): ExplorerState {
  const partition = params.get("partition");
  const [min, max] = (params.get("pdis") ?? "").split("-").map(Number);
  const sort = params.get("sort") as CatalogSort | null;
  return {
    filters: {
      search: params.get("q") ?? "",
      partition: partition === "kinhub_core" || partition === "uniprot_extended" ? (partition as Partition) : "all",
      category: params.get("category") || undefined,
      organ: params.get("organ") || undefined,
      tissueEnriched: params.get("enriched") === "1",
      maxCitations: intOrNull(params.get("max_citations")),
      hasStructure: params.get("has_structure") === "1",
      minCompounds: intOrNull(params.get("min_compounds")),
      pdisMin: Number.isFinite(min) && min >= 0 && min <= 100 ? min : 0,
      pdisMax: Number.isFinite(max) && max >= 0 && max <= 100 && max >= (min || 0) ? max : 100,
    },
    weights: parseWeightsParam(params.get("w")) ?? DEFAULT_WEIGHTS,
    sort: sort && SORTS.includes(sort) ? sort : "pdis",
  };
}

export function paramsFromState(state: ExplorerState): URLSearchParams {
  const p = new URLSearchParams();
  const f = state.filters;
  if (f.search) p.set("q", f.search);
  if (f.partition && f.partition !== "all") p.set("partition", f.partition);
  if (f.category) p.set("category", f.category);
  if (f.organ) p.set("organ", f.organ);
  if (f.organ && f.tissueEnriched) p.set("enriched", "1");
  if (f.maxCitations != null) p.set("max_citations", String(f.maxCitations));
  if (f.hasStructure) p.set("has_structure", "1");
  if (f.minCompounds != null) p.set("min_compounds", String(f.minCompounds));
  if ((f.pdisMin ?? 0) > 0 || (f.pdisMax ?? 100) < 100) p.set("pdis", `${f.pdisMin ?? 0}-${f.pdisMax ?? 100}`);
  const w = formatWeightsParam(state.weights);
  if (w) p.set("w", w);
  if (state.sort !== "pdis") p.set("sort", state.sort);
  return p;
}

export function explorerHref(state: Partial<ExplorerState> & { filters?: CatalogFilters }): string {
  const query = paramsFromState({ filters: state.filters ?? {}, weights: state.weights ?? DEFAULT_WEIGHTS, sort: state.sort ?? "pdis" }).toString();
  return query ? `/explorer?${query}` : "/explorer";
}
