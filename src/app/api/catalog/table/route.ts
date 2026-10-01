import { NextResponse } from "next/server";
import { loadCatalog } from "@/lib/catalog/load";

export const dynamic = "force-dynamic";

// All catalog entries with the four stored PDIS components, so the Explorer can
// re-weight, re-rank, and filter in the browser without further requests.
export async function GET() {
  try {
    const { rows, accounting } = await loadCatalog();
    return NextResponse.json(
      { rows, snapshot_date: accounting.snapshot_date, total_entries: accounting.total_entries },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch (error) {
    console.error("GET /api/catalog/table error:", error);
    return NextResponse.json({ error: "Catalog table is unavailable" }, { status: 503 });
  }
}
