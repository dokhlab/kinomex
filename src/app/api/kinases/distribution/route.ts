import { NextRequest, NextResponse } from "next/server";
import { loadCatalog } from "@/lib/catalog/load";
import { parseCatalogQuery } from "@/lib/catalog/params";
import { queryCatalog } from "@/lib/catalog/query";

export const dynamic = "force-dynamic";

// 20-bin histogram (0-100) of the weighted PDIS over the evidence-filtered set.
export async function GET(request: NextRequest) {
  const parsed = parseCatalogQuery(new URL(request.url).searchParams);
  if ("error" in parsed) {
    return NextResponse.json({ error: `Invalid query parameters: ${parsed.error}` }, { status: 400 });
  }
  try {
    const { rows } = await loadCatalog();
    const { pdisMin: _min, pdisMax: _max, ...evidence } = parsed.filters; // eslint-disable-line @typescript-eslint/no-unused-vars
    const result = queryCatalog(rows, evidence, parsed.weights);
    const scored = result.rows.filter((row) => row.pdis_weighted !== null).length;
    return NextResponse.json({ buckets: result.histogram, total: scored, unscored: result.total - scored, weights: parsed.weights });
  } catch (error) {
    console.error("GET /api/kinases/distribution error:", error);
    return NextResponse.json({ error: "Failed to compute PDIS distribution" }, { status: 500 });
  }
}
