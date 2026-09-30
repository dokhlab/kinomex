import { GET } from "@/app/api/kinases/distribution/route";
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

async function call(query = "") {
  const response = await GET({ url: `http://localhost/api/kinases/distribution?${query}` } as never);
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  (loadCatalog as jest.Mock).mockResolvedValue({
    rows: [flat("ZERO", 0), flat("FIVE", 5, { expression: cns }), flat("HUNDRED", 100), flat("MISSING", null)],
    accounting: {},
  });
});

describe("GET /api/kinases/distribution", () => {
  it("places 0, internal edges, and 100 in the correct inclusive endpoint buckets", async () => {
    const { body } = await call();
    expect(body.buckets).toHaveLength(20);
    expect(body.buckets[0].count).toBe(1);
    expect(body.buckets[1].count).toBe(1);
    expect(body.buckets[19].count).toBe(1);
    expect(body.total).toBe(3);
    expect(body.unscored).toBe(1);
  });

  it("applies evidence filters before building the distribution and ignores the PDIS interval", async () => {
    const { body } = await call("organ=CNS&minPDIS=50&maxPDIS=100");
    expect(body.total).toBe(1);
    expect(body.buckets[1].count).toBe(1);
  });
});
