import { DEFAULT_WEIGHTS, parseWeightsParam, type PdisWeights } from "@/lib/pdis";
import type { CatalogFilters, CatalogSort } from "@/lib/catalog/query";
import { EXTENSION_CLASSES, KINHUB_GROUPS, type Partition } from "@/lib/catalog/types";

const SORTS: CatalogSort[] = ["pdis", "-pdis", "gene_symbol", "-gene_symbol", "category", "citations", "compounds"];
const CATEGORIES = new Set<string>([...KINHUB_GROUPS, ...EXTENSION_CLASSES]);
const PARTITION_ALIASES: Record<string, Partition | "all"> = {
  all: "all",
  kinhub_core: "kinhub_core",
  core: "kinhub_core",
  uniprot_extended: "uniprot_extended",
  extended: "uniprot_extended",
};

export interface ParsedCatalogQuery {
  filters: CatalogFilters;
  weights: PdisWeights;
  sort: CatalogSort;
  page: number;
  limit: number;
}

function optionalInt(value: string | null, name: string, errors: string[]): number | null {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    errors.push(`${name} must be a non-negative integer`);
    return null;
  }
  return parsed;
}

function flag(value: string | null): boolean {
  return value === "1" || value === "true";
}

// Accepts the Explorer parameters plus the legacy names (catalog, group, organ_system).
export function parseCatalogQuery(params: URLSearchParams, maxLimit = 1000): ParsedCatalogQuery | { error: string } {
  const errors: string[] = [];
  const search = (params.get("search") || "").trim();
  if (search.length > 100) errors.push("search is too long");

  const partitionRaw = (params.get("partition") || params.get("catalog") || "all").trim();
  const partition = PARTITION_ALIASES[partitionRaw];
  if (!partition) errors.push("partition must be kinhub_core, uniprot_extended, or all");

  const category = (params.get("category") || params.get("group") || "").trim();
  if (category && !CATEGORIES.has(category)) errors.push("unknown category");

  const organ = (params.get("organ") || params.get("organ_system") || "").trim();
  if (organ.length > 50) errors.push("organ is too long");

  let weights: PdisWeights = DEFAULT_WEIGHTS;
  const weightsRaw = params.get("weights") ?? params.get("w");
  if (weightsRaw !== null) {
    const parsed = parseWeightsParam(weightsRaw);
    if (!parsed) errors.push("weights must be four non-negative numbers with at least one above zero");
    else weights = parsed;
  }

  const pdisMin = params.has("minPDIS") ? Number(params.get("minPDIS")) : 0;
  const pdisMax = params.has("maxPDIS") ? Number(params.get("maxPDIS")) : 100;
  if (!Number.isFinite(pdisMin) || !Number.isFinite(pdisMax) || pdisMin < 0 || pdisMax > 100 || pdisMin > pdisMax) {
    errors.push("minPDIS and maxPDIS must satisfy 0 <= minPDIS <= maxPDIS <= 100");
  }

  const sort = (params.get("sort") || "pdis") as CatalogSort;
  if (!SORTS.includes(sort)) errors.push(`sort must be one of ${SORTS.join(", ")}`);

  const page = params.has("page") ? Number(params.get("page")) : 1;
  const limit = params.has("limit") ? Number(params.get("limit")) : 20;
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1) errors.push("page and limit must be positive integers");

  const filters: CatalogFilters = {
    search,
    partition: partition ?? "all",
    category: category || undefined,
    organ: organ || undefined,
    tissueEnriched: flag(params.get("tissue_enriched")),
    maxCitations: optionalInt(params.get("max_citations"), "max_citations", errors),
    hasStructure: flag(params.get("has_structure")),
    minCompounds: optionalInt(params.get("min_compounds"), "min_compounds", errors),
    pdisMin,
    pdisMax,
  };

  if (errors.length) return { error: errors.join("; ") };
  return { filters, weights, sort, page, limit: Math.min(maxLimit, limit) };
}
