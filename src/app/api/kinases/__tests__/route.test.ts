import { GET } from "@/app/api/kinases/route";
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

const kinases: Doc[] = [
  { gene_symbol: "LOW", full_name: "Low", group: "TK" },
  { gene_symbol: "EDGE_MIN", full_name: "Minimum edge", group: "TK" },
  { gene_symbol: "MID", full_name: "Middle", group: "TK" },
  { gene_symbol: "EDGE_MAX", full_name: "Maximum edge", group: "TK" },
  { gene_symbol: "HIGH", full_name: "High", group: "TK" },
  { gene_symbol: "MISSING", full_name: "Missing", group: "TK" },
];

const pdis: Doc[] = [
  { gene_symbol: "LOW", pdis_total: 10.49 },
  { gene_symbol: "EDGE_MIN", pdis_total: 10.5 },
  { gene_symbol: "MID", pdis_total: 50 },
  { gene_symbol: "EDGE_MAX", pdis_total: 90.5 },
  { gene_symbol: "HIGH", pdis_total: 90.51 },
];

function matches(doc: Doc, query: Doc): boolean {
  return Object.entries(query).every(([key, condition]) => {
    if (key === "$and") return (condition as Doc[]).every((part) => matches(doc, part));
    if (key === "$or") return (condition as Doc[]).some((part) => matches(doc, part));
    const value = doc[key];
    if (condition && typeof condition === "object") {
      if ("$in" in condition) return condition.$in.includes(value);
      if ("$regex" in condition) return new RegExp(condition.$regex, condition.$options).test(value || "");
      if ("$gte" in condition && value < condition.$gte) return false;
      if ("$lte" in condition && value > condition.$lte) return false;
      return true;
    }
    return value === condition;
  });
}

function cursor(docs: Doc[]) {
  let result = [...docs];
  const api: {
    sort: jest.Mock;
    skip: jest.Mock;
    limit: jest.Mock;
    toArray: jest.Mock;
  } = {
    sort: jest.fn((sort: Doc) => {
      const [field, direction] = Object.entries(sort)[0] as [string, number];
      result.sort((a, b) => String(a[field]).localeCompare(String(b[field])) * direction);
      return api;
    }),
    skip: jest.fn((count: number) => { result = result.slice(count); return api; }),
    limit: jest.fn((count: number) => { result = result.slice(0, count); return api; }),
    toArray: jest.fn(async () => result),
  };
  return api;
}

function collection(name: string) {
  const docs = name === "kinases" ? kinases : name === "pdis" ? pdis : [];
  return {
    find: jest.fn((query: Doc = {}) => cursor(docs.filter((doc) => matches(doc, query)))),
    countDocuments: jest.fn(async (query: Doc = {}) => docs.filter((doc) => matches(doc, query)).length),
    aggregate: jest.fn((pipeline: Doc[] = []) => {
      if (name !== "kinases" || !pipeline.some((stage) => stage.$group)) return cursor([]);
      const matchStage = pipeline.find((stage) => stage.$match)?.$match || {};
      const counts = new Map<string, number>();
      for (const doc of docs.filter((item) => matches(item, matchStage))) {
        const group = doc.group || "Atypical";
        counts.set(group, (counts.get(group) || 0) + 1);
      }
      return cursor(Array.from(counts, ([_id, count]) => ({ _id, count })));
    }),
  };
}

beforeEach(() => {
  (connectToDatabase as jest.Mock).mockResolvedValue({ connection: { db: { collection } } });
  (resolveOrganGenes as jest.Mock).mockResolvedValue([]);
});

async function request(query: string) {
  const response = await GET({ url: `http://localhost/api/kinases?${query}` } as any);
  return { response, body: await response.json() };
}

describe("GET /api/kinases filtering", () => {
  it("uses inclusive fractional PDIS boundaries without rounding", async () => {
    const { body } = await request("minPDIS=0.105&maxPDIS=0.905&limit=20");
    expect(body.kinases.map((k: Doc) => k.gene_symbol)).toEqual(["EDGE_MAX", "EDGE_MIN", "MID"]);
    expect(body.kinases.map((k: Doc) => k.pdis_score)).toEqual([0.905, 0.105, 0.5]);
    expect(body.total).toBe(3);
  });

  it("returns missing PDIS records only when no interval was requested", async () => {
    const unfiltered = await request("limit=20&search=Missing");
    expect(unfiltered.body.kinases[0].pdis_score).toBeNull();

    const filtered = await request("limit=20&search=Missing&minPDIS=0&maxPDIS=1");
    expect(filtered.body).toMatchObject({ kinases: [], total: 0, totalPages: 0 });
  });

  it("intersects organ and PDIS gene sets", async () => {
    (resolveOrganGenes as jest.Mock).mockResolvedValue(["LOW", "EDGE_MIN", "MISSING"]);
    const { body } = await request("organ_system=Liver&minPDIS=0.105&maxPDIS=0.5&limit=20");
    expect(body.kinases.map((k: Doc) => k.gene_symbol)).toEqual(["EDGE_MIN"]);
    expect(body.total).toBe(1);
  });

  it("computes totals and pages before pagination", async () => {
    const { body } = await request("minPDIS=0.105&maxPDIS=0.905&page=2&limit=2");
    expect(body.kinases.map((k: Doc) => k.gene_symbol)).toEqual(["MID"]);
    expect(body).toMatchObject({ total: 3, page: 2, totalPages: 2 });
    expect(body.groupBreakdown).toEqual({ TK: 3 });
    expect(Object.values(body.groupBreakdown).reduce((sum: number, count) => sum + Number(count), 0)).toBe(body.total);
  });
});
