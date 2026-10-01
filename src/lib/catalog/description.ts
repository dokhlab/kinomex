import type { CatalogAccounting } from "@/lib/catalog/types";

// Site-wide page description; the numbers come from the catalog accounting.
export function siteDescription(a: Pick<CatalogAccounting, "total_entries" | "core_entries" | "extension_entries"> | null): string {
  if (!a) {
    return "Explore human kinase entries (KinHub core plus reviewed UniProt extensions) with source-linked structures, ligands, expression, variants, and networks.";
  }
  return `Explore ${a.total_entries} human kinase entries (${a.core_entries} KinHub core + ${a.extension_entries} reviewed UniProt extensions) with source-linked structures, ligands, expression, variants, and networks.`;
}
