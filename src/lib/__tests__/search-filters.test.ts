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
          : resultCursor([{ target_gene_symbol: "EGFR" }, { target_gene_symbol: "BRAF" }])),
      })),
    };
    const genes = await resolveStructuredGeneSet(
      db as any,
      parseQuery("TK kinases in brain with Type II inhibitors"),
    );
    expect(genes).toEqual(["EGFR"]);
  });

  it("returns null when no evidence-backed gene filter was requested", async () => {
    expect(await resolveStructuredGeneSet({} as any, parseQuery("EGFR"))).toBeNull();
  });
});
