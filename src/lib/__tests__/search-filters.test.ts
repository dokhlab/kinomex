import { resolveStructuredGeneSet } from "@/lib/search-filters";
import { parseQuery } from "@/lib/query-parser";

function resultCursor(docs: Record<string, string>[]) {
  const cursor: { project: jest.Mock; toArray: jest.Mock } = {
    project: jest.fn(() => cursor),
    toArray: jest.fn(async () => docs),
  };
  return cursor;
}

describe("resolveStructuredGeneSet", () => {
  it("intersects tissue and binding evidence by gene", async () => {
    const db = {
      collection: jest.fn((name: string) => ({
        find: jest.fn(() => name === "expression"
          ? resultCursor([{ gene_symbol: "ABL1" }, { gene_symbol: "EGFR" }])
          : resultCursor([{ gene_symbol: "EGFR" }, { gene_symbol: "BRAF" }])),
      })),
    };
    const genes = await resolveStructuredGeneSet(
      db as any,
      parseQuery("TK kinases in brain with allosteric inhibitors"),
    );
    expect(genes).toEqual(["EGFR"]);
  });

  it("matches no gene for a binding mode that no source annotates", async () => {
    const db = { collection: jest.fn(() => ({ find: jest.fn(() => resultCursor([{ gene_symbol: "ABL1" }])) })) };
    expect(await resolveStructuredGeneSet(db as any, parseQuery("kinases in brain with Type II binding"))).toEqual([]);
  });

  it("returns null when no evidence-backed gene filter was requested", async () => {
    expect(await resolveStructuredGeneSet({} as any, parseQuery("EGFR"))).toBeNull();
  });
});
