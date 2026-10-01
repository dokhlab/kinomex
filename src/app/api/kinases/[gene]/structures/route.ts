import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { STRUCTURE_PAGE_SIZE, structurePage } from "@/lib/dossier/structures";
import { normalizeGene } from "@/lib/dossier/gene";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ gene: string }> }) {
  const gene = normalizeGene((await params).gene);
  if (!gene) return NextResponse.json({ error: "Invalid gene symbol" }, { status: 400 });
  const search = new URL(request.url).searchParams;
  const page = Number(search.get("page") ?? 1);
  const size = Number(search.get("size") ?? STRUCTURE_PAGE_SIZE);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(size) || size < 1 || size > 200) {
    return NextResponse.json({ error: "page and size must be positive integers (size ≤ 200)" }, { status: 400 });
  }
  try {
    const db = (await connectToDatabase()).connection.db!;
    const kinase = await db.collection("kinases").findOne({ gene_symbol: gene }, { projection: { uniprot_id: 1 } });
    if (!kinase) return NextResponse.json({ error: `Kinase "${gene}" not found` }, { status: 404 });
    return NextResponse.json(await structurePage(db, kinase.uniprot_id, page, size));
  } catch (error) {
    console.error(`GET /api/kinases/${gene}/structures error:`, error);
    return NextResponse.json({ error: "Failed to fetch structures" }, { status: 500 });
  }
}
