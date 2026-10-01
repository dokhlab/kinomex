import { NextRequest, NextResponse } from "next/server";
import { loadCatalog } from "@/lib/catalog/load";
import { parseCatalogQuery } from "@/lib/catalog/params";
import { queryCatalog } from "@/lib/catalog/query";
import { serializeEntry } from "@/lib/catalog/serialize";
import { DEFAULT_WEIGHTS, PDIS_FORMULA_VERSION } from "@/lib/pdis";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const parsed = parseCatalogQuery(new URL(request.url).searchParams);
  if ("error" in parsed) {
    return NextResponse.json({ error: `Invalid query parameters: ${parsed.error}` }, { status: 400 });
  }
  try {
    const { rows, accounting } = await loadCatalog();
    const result = queryCatalog(rows, parsed.filters, parsed.weights, parsed.sort);
    const start = (parsed.page - 1) * parsed.limit;
    return NextResponse.json({
      kinases: result.rows.slice(start, start + parsed.limit).map(serializeEntry),
      total: result.total,
      page: parsed.page,
      limit: parsed.limit,
      totalPages: Math.ceil(result.total / parsed.limit),
      weights: parsed.weights,
      default_weights: DEFAULT_WEIGHTS,
      formula_version: PDIS_FORMULA_VERSION,
      categoryBreakdown: result.categoryBreakdown,
      groupBreakdown: result.categoryBreakdown,
      partitionBreakdown: result.partitionBreakdown,
      histogram: result.histogram,
      snapshot_date: accounting.snapshot_date,
    });
  } catch (error) {
    console.error("GET /api/kinases error:", error);
    return NextResponse.json({ error: "Failed to fetch kinases" }, { status: 500 });
  }
}
