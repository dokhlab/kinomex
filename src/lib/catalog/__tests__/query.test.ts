import { applyEvidenceFilters, matchesTissueEnriched, queryCatalog } from "@/lib/catalog/query";
import { buildAccounting, buildCatalogRows, displayCategory } from "@/lib/catalog/build";
import { flat, row } from "@/lib/catalog/__tests__/fixtures";

describe("catalog query", () => {
  test("evidence filters for Protocol S1", () => {
    const rows = [
      row("KEEP", { raw_values: { pubmed_publication_count: 100, clinical_trial_count: 0, pdb_count: 1, best_resolution_angstrom: 2, average_resolution_angstrom: 2, distinct_compound_count: 100 } }),
      row("CITED", { raw_values: { pubmed_publication_count: 101, clinical_trial_count: 0, pdb_count: 1, best_resolution_angstrom: 2, average_resolution_angstrom: 2, distinct_compound_count: 500 } }),
      row("NOSTRUCT", { raw_values: { pubmed_publication_count: 5, clinical_trial_count: 0, pdb_count: 0, best_resolution_angstrom: null, average_resolution_angstrom: null, distinct_compound_count: 500 } }),
      row("FEW", { raw_values: { pubmed_publication_count: 5, clinical_trial_count: 0, pdb_count: 3, best_resolution_angstrom: 2, average_resolution_angstrom: 2, distinct_compound_count: 99 } }),
      row("EXT", { partition: "uniprot_extended" }),
    ];
    const kept = applyEvidenceFilters(rows, { partition: "kinhub_core", maxCitations: 100, hasStructure: true, minCompounds: 100 });
    expect(kept.map((r) => r.gene_symbol)).toEqual(["KEEP"]);
  });

  test("tissue enrichment needs tau >= 0.8, top tissue in the organ, and >= 1 TPM", () => {
    const e = (tau: number, organ: string, tpm: number) => row("X", { expression: { tau, top_organ: organ, top_tpm: tpm, top_tissue: "t", gencode_id: null } });
    expect(matchesTissueEnriched(e(0.8, "CNS", 1), "CNS")).toBe(true);
    expect(matchesTissueEnriched(e(0.79, "CNS", 50), "CNS")).toBe(false);
    expect(matchesTissueEnriched(e(0.95, "Hepatic", 50), "CNS")).toBe(false);
    expect(matchesTissueEnriched(e(0.95, "CNS", 0.9), "CNS")).toBe(false);
    expect(matchesTissueEnriched(row("NONE"), "CNS")).toBe(false);
  });

  test("ranks cover the catalog even when a filter narrows the view", () => {
    const rows = [flat("A", 90), flat("B", 80, { partition: "uniprot_extended" }), flat("C", 70)];
    const result = queryCatalog(rows, { partition: "kinhub_core" });
    expect(result.rows.map((r) => [r.gene_symbol, r.rank_weighted])).toEqual([["A", 1], ["C", 3]]);
  });

  test("the histogram ignores the PDIS interval", () => {
    const result = queryCatalog([flat("A", 10), flat("B", 90)], { pdisMin: 50, pdisMax: 100 });
    expect(result.total).toBe(1);
    expect(result.histogram.reduce((s, b) => s + b.count, 0)).toBe(2);
  });
});

describe("catalog build", () => {
  const inputs = {
    kinases: [
      { gene_symbol: "AKT1", uniprot_id: "P31749", catalog_membership: "kinhub_core", group: "AGC", kinhub_domains: [{}], uniprot_record_status: "active" },
      { gene_symbol: "PRKY", uniprot_id: "O43930", catalog_membership: "kinhub_core", group: "AGC", kinhub_domains: [{}, {}], uniprot_record_status: "inactive" },
      { gene_symbol: "PIK3CA", uniprot_id: "P42336", catalog_membership: "uniprot_extended", group: null, extension_class: "Lipid kinase", kinhub_domains: [] },
    ],
    pdis: [{ gene_symbol: "AKT1", pdis_total: 60, rank_default: 1, components: { citation: 60, clinical_trials: 60, structure: 60, compound_diversity: 60 }, raw_values: { pubmed_publication_count: 5, clinical_trial_count: 0 } }],
    expression: [{ _id: "AKT1", records: 54, tau: 0.2, top_tissue: "Brain Cortex", top_organ: "CNS", top_tpm: 10, organ_systems: ["CNS", "Skin"] }],
    variantCounts: [{ _id: { gene: "AKT1", source: "clinvar" }, n: 3 }, { _id: { gene: "NOTCAT", source: "clinvar" }, n: 9 }],
    diseases: [],
    catalogMetadata: null,
    releaseMetadata: { snapshot_date: "2026-09-30" },
    structureGenes: ["AKT1", "NOTCAT"],
    structureCount: 2,
    ligandStats: [{ _id: { gene: "AKT1", source: "chembl" }, pairs: 4, records: 7 }, { _id: { gene: "NOTCAT", source: "pubchem" }, pairs: 1, records: 3 }],
    alphafold: null,
    pharos: null,
    quarantineExpression: null,
    quarantineChembl: null,
  };

  test("display category and partition", () => {
    const rows = buildCatalogRows(inputs as never);
    expect(rows.map((r) => [r.gene_symbol, r.group, r.display_category])).toEqual([
      ["AKT1", "AGC", "AGC"], ["PIK3CA", null, "Lipid kinase"], ["PRKY", "AGC", "AGC"],
    ]);
    expect(displayCategory({ catalog_membership: "uniprot_extended", group: "Atypical" })).toBe("Unclassified extension");
    expect(rows.find((r) => r.gene_symbol === "PIK3CA")!.pdis_default).toBeNull();
  });

  test("accounting counts only catalog genes and marks missing sources unavailable", () => {
    const a = buildAccounting(inputs as never);
    expect([a.total_entries, a.core_entries, a.extension_entries, a.kinhub_domain_rows, a.inactive_historical_entries]).toEqual([3, 2, 1, 3, 1]);
    const src = (k: string) => a.sources.find((s) => s.source === k)!;
    expect([src("ligands").records, src("ligands").entries_with_records, src("ligands").gap]).toEqual([7, 1, 2]);
    expect([src("clinvar").records, src("pdb").entries_with_records]).toEqual([3, 1]);
    expect([src("alphafold").records, src("alphafold").entries_with_records, src("alphafold").gap]).toEqual([null, null, null]);
    expect(a.snapshot_date).toBe("2026-09-30");
  });
});
