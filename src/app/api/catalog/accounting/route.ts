import { NextResponse } from "next/server";
import { loadCatalog } from "@/lib/catalog/load";

export const dynamic = "force-dynamic";

// Single source of catalog counts: every page, the README check, and
// /api/kinases/stats read these values from the database through this module.
export async function GET() {
  try {
    const { accounting } = await loadCatalog();
    return NextResponse.json(accounting, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (error) {
    console.error("GET /api/catalog/accounting error:", error);
    return NextResponse.json({ error: "Catalog accounting is unavailable" }, { status: 503 });
  }
}
