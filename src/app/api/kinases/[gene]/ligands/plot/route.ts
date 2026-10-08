import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { normalizeGene } from "@/lib/dossier/gene";
import { ligandPlot, parseLigandQuery } from "@/lib/dossier/ligands";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ gene: string }> }) {
  const gene = normalizeGene((await params).gene);
  if (!gene) return NextResponse.json({ error: "Invalid gene symbol" }, { status: 400 });
  const q = parseLigandQuery(new URL(request.url).searchParams);
  if (!q) return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
  try {
    const db = (await connectToDatabase()).connection.db!;
    const result = await ligandPlot(db, gene, q);
    if (!result) return NextResponse.json({ error: "Representative ligand rows are unavailable" }, { status: 503 });
    return NextResponse.json(result);
  } catch (error) {
    console.error(`GET /api/kinases/${gene}/ligands/plot error:`, error);
    return NextResponse.json({ error: "Failed to fetch the ligand plot" }, { status: 500 });
  }
}
