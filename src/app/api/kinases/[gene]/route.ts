import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { normalizeGene } from "@/lib/dossier/gene";
import { buildProfile } from "@/lib/dossier/profile";

const profileCache = new Map<string, { data: unknown; expiresAt: number }>();
const PROFILE_CACHE_TTL = 60 * 1000;
const PROFILE_CACHE_HEADERS = { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" };

// The dossier is assembled only from imported local data; live services never
// delay route navigation. Ligand rows and structure pages load from sub-routes.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ gene: string }> }) {
  const gene = normalizeGene((await params).gene);
  if (!gene) return NextResponse.json({ error: "Invalid gene symbol" }, { status: 400 });

  const cached = profileCache.get(gene);
  if (cached && cached.expiresAt > Date.now()) return NextResponse.json(cached.data, { headers: PROFILE_CACHE_HEADERS });
  profileCache.delete(gene);

  try {
    const db = (await connectToDatabase()).connection.db!;
    const profile = await buildProfile(db, gene);
    if (!profile) return NextResponse.json({ error: `Kinase "${gene}" not found` }, { status: 404 });
    profileCache.set(gene, { data: profile, expiresAt: Date.now() + PROFILE_CACHE_TTL });
    return NextResponse.json(profile, { headers: PROFILE_CACHE_HEADERS });
  } catch (error) {
    console.error(`GET /api/kinases/${gene} error:`, error);
    return NextResponse.json({ error: "Failed to fetch kinase profile" }, { status: 500 });
  }
}
