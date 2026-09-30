/**
 * @jest-environment node
 *
 * Database integration test for the release data. It runs only with
 * KINOMEX_DB_TESTS=1 and MONGODB_URI/MONGODB_DB_NAME pointing at a migrated database.
 */
import mongoose from "mongoose";
import { readCatalogInputs } from "@/lib/catalog/load";
import { buildAccounting, buildCatalogRows, sourceByKey } from "@/lib/catalog/build";
import { queryCatalog } from "@/lib/catalog/query";
import { DEFAULT_WEIGHTS, WEIGHT_PRESETS, weightedScore, type PdisWeights } from "@/lib/pdis";
import type { CatalogAccounting, CatalogRow } from "@/lib/catalog/types";

const run = process.env.KINOMEX_DB_TESTS === "1" ? describe : describe.skip;
const preset = (id: string) => WEIGHT_PRESETS.find((p) => p.id === id)!.weights as PdisWeights;

run("release catalog (database)", () => {
  let rows: CatalogRow[];
  let accounting: CatalogAccounting;

  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI!, { dbName: process.env.MONGODB_DB_NAME });
    const inputs = await readCatalogInputs(mongoose.connection.db!);
    rows = buildCatalogRows(inputs);
    accounting = buildAccounting(inputs);
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect();
  });

  test("catalog accounting", () => {
    expect(accounting.total_entries).toBe(678);
    expect(accounting.core_entries).toBe(522);
    expect(accounting.extension_entries).toBe(156);
    expect(accounting.kinhub_domain_rows).toBe(536);
    expect(accounting.inactive_entries).toEqual([{ gene_symbol: "PRKY", uniprot_id: "O43930" }]);
    expect(accounting.core_group_counts).toEqual({
      AGC: 63, CAMK: 74, CK1: 12, CMGC: 63, STE: 47, TK: 90, TKL: 43, RGC: 5, Atypical: 44, Other: 81,
    });
    expect(Object.values(accounting.extension_class_counts)).toEqual([5, 38, 11, 36, 38, 20, 8]);
    expect(accounting.snapshot_date).toBe("2026-09-30");
  });

  test("source coverage", () => {
    const pick = (key: string) => {
      const s = sourceByKey(accounting, key)!;
      return [s.records, s.entries_with_records, s.gap];
    };
    expect(pick("pdb")).toEqual([10043, 476, 202]);
    expect(sourceByKey(accounting, "pdb")!.core_entries_with_records).toBe(384);
    expect(pick("ligands")).toEqual([1021421, 566, 112]);
    expect(sourceByKey(accounting, "ligands")!.core_entries_with_records).toBe(472);
    expect(pick("chembl")[0]).toBe(1019354);
    expect(pick("pubchem")[0]).toBe(2067);
    expect(pick("compound_pairs")[0]).toBe(717452);
    expect(pick("gtex")).toEqual([36396, 674, 4]);
    expect(pick("clinvar")).toEqual([63649, 260, 418]);
    expect(pick("curated_mutations")).toEqual([87, 36, 642]);
    expect(pick("uniprot_disease")).toEqual([256, 256, 422]);
    expect(pick("pdis")).toEqual([678, 678, 0]);
    expect(pick("pubmed").slice(1)).toEqual([671, 7]);
    expect(pick("clinicaltrials").slice(1)).toEqual([168, 510]);
    const quarantine = accounting.quarantine.find((q) => q.collection === "expression_quarantine")!;
    expect([quarantine.records, quarantine.genes]).toEqual([322, 161]);
  });

  test("default PDIS", () => {
    const result = queryCatalog(rows, {}, DEFAULT_WEIGHTS);
    for (const row of result.rows) {
      expect(row.pdis_weighted).toBe(row.pdis_default);
      expect(Math.abs(weightedScore(row.components!, DEFAULT_WEIGHTS) - row.pdis_default!)).toBeLessThanOrEqual(0.005 + 1e-9);
      expect(row.rank_weighted).toBe(row.rank_default);
    }
    expect(result.rows.slice(0, 10).map((r) => [r.gene_symbol, r.pdis_default])).toEqual([
      ["EGFR", 96.36], ["MTOR", 93.29], ["MET", 92.03], ["KIT", 91.88], ["BTK", 91.08],
      ["ALK", 90.54], ["BCR", 90.0], ["BRAF", 89.44], ["ERBB2", 87.69], ["KDR", 87.52],
    ]);
    expect(result.rows.filter((r) => (r.pdis_default ?? 0) >= 50)).toHaveLength(71);
  });

  test("equal weights", () => {
    const equal = queryCatalog(rows, {}, preset("equal")).rows;
    expect(equal.slice(0, 5).map((r) => r.gene_symbol)).toEqual(["EGFR", "BTK", "MTOR", "MET", "KIT"]);
    const top50 = new Set(queryCatalog(rows, {}).rows.slice(0, 50).map((r) => r.gene_symbol));
    expect(equal.slice(0, 50).filter((r) => top50.has(r.gene_symbol))).toHaveLength(45);
  });

  test("Protocol S1: under-cited, tractable core kinases", () => {
    const result = queryCatalog(rows, {
      partition: "kinhub_core", maxCitations: 100, hasStructure: true, minCompounds: 100,
    }, preset("tractability-only"));
    expect(result.total).toBe(93);
    expect(result.rows.slice(0, 4).map((r) => [r.gene_symbol, Math.round(r.pdis_weighted! * 10) / 10])).toEqual([
      ["CSNK1D", 84.4], ["CSNK2A2", 83.0], ["BRD2", 82.2], ["MAPK9", 81.8],
    ]);
  });

  test("Protocol S2: CNS tissue-enriched entries", () => {
    const result = queryCatalog(rows, { organ: "CNS", tissueEnriched: true });
    expect(result.total).toBe(47);
    expect(result.rows.filter((r) => r.partition === "kinhub_core")).toHaveLength(39);
    expect(result.rows.slice(0, 5).map((r) => r.gene_symbol)).toEqual(["FLT3", "FGFR2", "CDC7", "PRKCG", "DCLK1"]);
    const camkk2 = rows.find((r) => r.gene_symbol === "CAMKK2")!.expression!;
    expect([camkk2.top_tissue, Math.round(camkk2.top_tpm * 10) / 10, Math.round(camkk2.tau * 1000) / 1000])
      .toEqual(["Brain Cerebellar Hemisphere", 457.5, 0.921]);
  });
});
