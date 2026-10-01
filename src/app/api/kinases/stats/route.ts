import { NextResponse } from "next/server";
import { loadCatalog } from "@/lib/catalog/load";
import { sourceByKey } from "@/lib/catalog/build";
import { round2 } from "@/lib/pdis";

export const dynamic = "force-dynamic";

// Totals derive from the same catalog accounting as /api/catalog/accounting.
export async function GET() {
  try {
    const { rows, accounting } = await loadCatalog();
    const records = (key: string) => sourceByKey(accounting, key)?.records ?? null;
    const scored = rows.filter((row) => row.pdis_default !== null);
    const averagePDIS = scored.length
      ? round2(scored.reduce((sum, row) => sum + (row.pdis_default as number), 0) / scored.length)
      : null;
    const clinvar = records("clinvar");
    const curated = records("curated_mutations");

    return NextResponse.json({
      totalKinases: accounting.total_entries,
      catalogAccounting: accounting,
      groupDistribution: accounting.core_group_counts,
      extensionClassDistribution: accounting.extension_class_counts,
      pdisScale: "0-100",
      averagePDIS,
      totalLigands: records("ligands"),
      totalLigandPairs: records("compound_pairs"),
      totalVariants: clinvar === null || curated === null ? null : clinvar + curated,
      totalClinVarRecords: clinvar,
      totalCuratedMutations: curated,
      totalStructures: records("pdb"),
      totalDiseases: records("uniprot_disease"),
      topMutatedKinasesBasis: "ClinVar missense records",
      topMutatedKinases: [...rows]
        .sort((a, b) => b.clinvar_records - a.clinvar_records || a.gene_symbol.localeCompare(b.gene_symbol))
        .slice(0, 10)
        .map((row) => ({
          gene_symbol: row.gene_symbol,
          name: row.name,
          mutation_count: row.clinvar_records,
          pdis_score: row.pdis_default,
          display_category: row.display_category,
        })),
      topDruggableKinases: [...scored]
        .sort((a, b) => (a.rank_default ?? Infinity) - (b.rank_default ?? Infinity))
        .slice(0, 10)
        .map((row) => ({
          gene_symbol: row.gene_symbol,
          name: row.name,
          pdis_score: row.pdis_default,
          group: row.display_category,
          display_category: row.display_category,
        })),
    });
  } catch (error) {
    console.error("GET /api/kinases/stats error:", error);
    return NextResponse.json({ error: "Failed to compute kinome statistics" }, { status: 500 });
  }
}
