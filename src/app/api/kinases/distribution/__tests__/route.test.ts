import { GET } from "@/app/api/kinases/distribution/route";
import { connectToDatabase } from "@/lib/mongodb";
import { resolveOrganGenes } from "@/lib/kinase-utils";

jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));
jest.mock("@/lib/mongodb", () => ({ connectToDatabase: jest.fn() }));
jest.mock("@/lib/kinase-utils", () => ({ resolveOrganGenes: jest.fn() }));

type Doc = Record<string, any>;
const kinases = ["ZERO", "FIVE", "HUNDRED", "MISSING", "INVALID"].map((gene_symbol) => ({ gene_symbol, group: "TK" }));
const pdis = [
  { gene_symbol: "ZERO", pdis_total: 0 },
  { gene_symbol: "FIVE", pdis_total: 5 },
  { gene_symbol: "HUNDRED", pdis_total: 100 },
  { gene_symbol: "INVALID", pdis_total: 101 },
];

function collection(name: string) {
  const docs: Doc[] = name === "kinases" ? kinases : pdis;
  return {
    find: jest.fn((query: Doc = {}) => ({
      toArray: async () => docs.filter((doc) => {
        if (query.group && doc.group !== query.group) return false;
        if (query.gene_symbol?.$in && !query.gene_symbol.$in.includes(doc.gene_symbol)) return false;
        return true;
      }),
    })),
  };
}

beforeEach(() => {
  (connectToDatabase as jest.Mock).mockResolvedValue({ connection: { db: { collection } } });
  (resolveOrganGenes as jest.Mock).mockResolvedValue([]);
});

describe("GET /api/kinases/distribution", () => {
  it("places 0, internal edges, and 100 in the correct inclusive endpoint buckets", async () => {
    const response = await GET({ url: "http://localhost/api/kinases/distribution?group=TK" } as any);
    const body = await response.json();
    expect(body.buckets[0].count).toBe(1);
    expect(body.buckets[1].count).toBe(1);
    expect(body.buckets[19].count).toBe(1);
    expect(body).toMatchObject({ total: 3, unscored: 2 });
  });

  it("applies organ filtering before building the distribution", async () => {
    (resolveOrganGenes as jest.Mock).mockResolvedValue(["FIVE", "MISSING"]);
    const response = await GET({ url: "http://localhost/api/kinases/distribution?organ_system=Liver" } as any);
    const body = await response.json();
    expect(body.buckets.reduce((sum: number, bucket: Doc) => sum + bucket.count, 0)).toBe(1);
    expect(body).toMatchObject({ total: 1, unscored: 1 });
  });
});
