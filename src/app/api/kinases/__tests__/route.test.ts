import { GET } from "@/app/api/kinases/route";
import { loadCatalog } from "@/lib/catalog/load";
import { flat } from "@/lib/catalog/__tests__/fixtures";

jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));
jest.mock("@/lib/catalog/load", () => ({ loadCatalog: jest.fn() }));

const cns = { tau: 0.9, top_tissue: "Brain Cortex", top_organ: "CNS", top_tpm: 20, gencode_id: null };
const rows = [
  flat("LOW", 10.49),
  flat("EDGE_MIN", 10.5),
  flat("MID", 50, { expression: cns }),
  flat("EDGE_MAX", 90.5, { expression: cns }),
  flat("HIGH", 90.51),
  flat("MISSING", null),
  flat("EXT", 30, { partition: "uniprot_extended", group: null, extension_class: "Lipid kinase", display_category: "Lipid kinase" }),
];

async function call(query: string) {
  const response = await GET({ url: `http://localhost/api/kinases?${query}` } as never);
  return { status: response.status, body: await response.json() };
}

const genes = (body: { kinases: { gene_symbol: string }[] }) => body.kinases.map((k) => k.gene_symbol).sort();

beforeEach(() => {
  (loadCatalog as jest.Mock).mockResolvedValue({ rows, accounting: { snapshot_date: "2026-09-30" } });
});

describe("GET /api/kinases", () => {
  it("uses inclusive PDIS boundaries on the 0-100 scale", async () => {
    const { body } = await call("minPDIS=10.5&maxPDIS=90.5&limit=100");
    expect(genes(body)).toEqual(["EDGE_MAX", "EDGE_MIN", "EXT", "MID"]);
  });

  it("returns entries without PDIS only when no interval is requested", async () => {
    expect(genes((await call("limit=100")).body)).toContain("MISSING");
    expect(genes((await call("minPDIS=0&maxPDIS=100&limit=100")).body)).toContain("MISSING");
    expect(genes((await call("minPDIS=1&maxPDIS=100&limit=100")).body)).not.toContain("MISSING");
  });

  it("intersects organ and PDIS filters", async () => {
    const { body } = await call("organ=CNS&tissue_enriched=1&minPDIS=60&maxPDIS=100");
    expect(genes(body)).toEqual(["EDGE_MAX"]);
  });

  it("computes totals and breakdowns before pagination", async () => {
    const { body } = await call("limit=2&page=2&sort=pdis");
    expect(body.total).toBe(7);
    expect(body.totalPages).toBe(4);
    expect(body.kinases.map((k: { gene_symbol: string }) => k.gene_symbol)).toEqual(["MID", "EXT"]);
    expect(body.categoryBreakdown).toEqual({ TK: 6, "Lipid kinase": 1 });
    expect(body.partitionBreakdown).toEqual({ kinhub_core: 6, uniprot_extended: 1 });
  });

  it("filters by partition and category and returns both group and display_category", async () => {
    const { body } = await call("partition=uniprot_extended");
    expect(body.kinases).toHaveLength(1);
    expect(body.kinases[0]).toMatchObject({ group: null, display_category: "Lipid kinase", extension_class: "Lipid kinase" });
    expect((await call("catalog=core")).body.total).toBe(6);
    expect((await call("category=Lipid%20kinase")).body.total).toBe(1);
  });

  it("returns weighted scores and ranks", async () => {
    const tilted = [
      flat("A", null, { components: { citation: 100, clinical_trials: 0, structure: 0, compound_diversity: 0 }, pdis_default: 33.33 }),
      flat("B", null, { components: { citation: 0, clinical_trials: 0, structure: 0, compound_diversity: 100 }, pdis_default: 16.67 }),
    ];
    (loadCatalog as jest.Mock).mockResolvedValue({ rows: tilted, accounting: {} });
    const { body } = await call("weights=0,0,0,1&sort=pdis");
    expect(body.kinases.map((k: { gene_symbol: string; pdis_weighted: number; rank_weighted: number }) =>
      [k.gene_symbol, k.pdis_weighted, k.rank_weighted])).toEqual([["B", 100, 1], ["A", 0, 2]]);
    expect(body.kinases[0].pdis_default).toBe(16.67);
    expect(body.weights).toEqual([0, 0, 0, 1]);
  });

  it("rejects invalid parameters", async () => {
    for (const query of ["weights=0,0,0,0", "weights=1,2", "partition=other", "category=Nope", "minPDIS=5&maxPDIS=1", "maxPDIS=101", "sort=$where", "max_citations=-1"]) {
      expect((await call(query)).status).toBe(400);
    }
  });
});
