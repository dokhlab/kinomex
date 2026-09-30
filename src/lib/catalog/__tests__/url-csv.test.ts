import { explorerHref, paramsFromState, stateFromParams } from "@/lib/catalog/url";
import { catalogCsv, CSV_COLUMNS } from "@/lib/catalog/csv";
import { scoreCatalog } from "@/lib/catalog/query";
import { DEFAULT_WEIGHTS } from "@/lib/pdis";
import { flat, row } from "@/lib/catalog/__tests__/fixtures";

describe("explorer address", () => {
  test("default state has no parameters", () => {
    expect(paramsFromState(stateFromParams(new URLSearchParams())).toString()).toBe("");
    expect(explorerHref({})).toBe("/explorer");
  });

  test("?w=0.25,0.25,0.25,0.25 restores Equal weights", () => {
    const state = stateFromParams(new URLSearchParams("w=0.25,0.25,0.25,0.25"));
    expect(state.weights).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(paramsFromState(state).get("w")).toBe("0.25,0.25,0.25,0.25");
  });

  test("invalid weights fall back to the default", () => {
    expect(stateFromParams(new URLSearchParams("w=0,0,0,0")).weights).toEqual(DEFAULT_WEIGHTS);
  });

  test("Protocol S1 filters round trip", () => {
    const href = explorerHref({
      filters: { partition: "kinhub_core", maxCitations: 100, hasStructure: true, minCompounds: 100 },
      weights: [0, 0, 0.5, 0.5],
    });
    expect(href).toBe("/explorer?partition=kinhub_core&max_citations=100&has_structure=1&min_compounds=100&w=0%2C0%2C0.5%2C0.5");
    const state = stateFromParams(new URLSearchParams(href.split("?")[1]));
    expect(state.filters).toMatchObject({ partition: "kinhub_core", maxCitations: 100, hasStructure: true, minCompounds: 100 });
    expect(state.weights).toEqual([0, 0, 0.5, 0.5]);
  });

  test("PDIS interval and organ enrichment", () => {
    const state = stateFromParams(new URLSearchParams("organ=CNS&enriched=1&pdis=20-60"));
    expect(state.filters).toMatchObject({ organ: "CNS", tissueEnriched: true, pdisMin: 20, pdisMax: 60 });
  });
});

describe("CSV export", () => {
  test("writes components, weights, and weighted score; missing values read unavailable", () => {
    const rows = scoreCatalog([flat("AKT1", 40), row("NOPD", { components: null, raw_values: null, pdis_default: null, display_category: "Lipid kinase, other" })]);
    const lines = catalogCsv(rows, DEFAULT_WEIGHTS).trim().split("\n");
    expect(lines[0].split(",")).toEqual(CSV_COLUMNS);
    expect(lines[1]).toBe("1,AKT1,PAKT1,KinHub core,TK,10,0,1,2,2,10,40,40,40,40,0.3,0.3,0.15,0.15,40,40");
    expect(lines[2]).toContain('"Lipid kinase, other"');
    expect(lines[2]).toContain("unavailable");
    expect(lines[2]).not.toMatch(/,0,0,0,0,0,/);
  });
});
