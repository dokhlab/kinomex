import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { normalizeGene } from "@/lib/dossier/gene";
import { ligandRecords } from "@/lib/dossier/ligands";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ gene: string }> }) {
  const gene = normalizeGene((await params).gene);
  const key = new URL(request.url).searchParams.get("compound_key") ?? "";
  if (!gene || !/^(chembl:CHEMBL\d+|pubchem:\d+)$/.test(key)) {
    return NextResponse.json({ error: "Invalid gene symbol or compound_key" }, { status: 400 });
  }
  try {
    const db = (await connectToDatabase()).connection.db!;
    const result = await ligandRecords(db, gene, key);
    return NextResponse.json({ compound_key: key, records: result?.records ?? [], hidden: result?.hidden ?? 0 });
  } catch (error) {
    console.error(`GET /api/kinases/${gene}/ligands/records error:`, error);
    return NextResponse.json({ error: "Failed to fetch ligand records" }, { status: 500 });
  }
}
