import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { normalizeGene } from "@/lib/dossier/gene";
import { LIGAND_PAGE_SIZE, ligandPage, type LigandQuery } from "@/lib/dossier/ligands";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ gene: string }> }) {
  const gene = normalizeGene((await params).gene);
  if (!gene) return NextResponse.json({ error: "Invalid gene symbol" }, { status: 400 });
  const s = new URL(request.url).searchParams;
  const q: LigandQuery = {
    page: Number(s.get("page") ?? 1),
    size: Number(s.get("size") ?? LIGAND_PAGE_SIZE),
    search: (s.get("search") ?? "").trim() || undefined,
    activityType: s.get("activity_type") || undefined,
    source: s.get("source") || undefined,
    uncensoredOnly: s.get("uncensored") === "1",
    maxNm: s.get("max_nm") ? Number(s.get("max_nm")) : null,
    sort: (s.get("sort") as LigandQuery["sort"]) || "value",
  };
  if (!Number.isInteger(q.page) || q.page < 1 || !Number.isInteger(q.size) || q.size < 1 || q.size > 500
    || (q.search && q.search.length > 100) || (q.maxNm !== null && !Number.isFinite(q.maxNm))
    || !["value", "name", "records"].includes(q.sort) || (q.source && !["chembl", "pubchem"].includes(q.source))) {
    return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
  }
  try {
    const db = (await connectToDatabase()).connection.db!;
    const page = await ligandPage(db, gene, q);
    if (!page) return NextResponse.json({ error: "Representative ligand rows are unavailable" }, { status: 503 });
    return NextResponse.json(page);
  } catch (error) {
    console.error(`GET /api/kinases/${gene}/ligands error:`, error);
    return NextResponse.json({ error: "Failed to fetch ligands" }, { status: 500 });
  }
}
