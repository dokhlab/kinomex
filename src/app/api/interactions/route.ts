import { NextRequest, NextResponse } from "next/server";
import { parseStringNetworkTsv } from "@/lib/string-network";

export const dynamic = "force-dynamic";

const cache = new Map<string, { expires: number; data: unknown }>();

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const genes = Array.from(new Set((params.get("genes") || "")
    .split(/[\s,;]+/).map((gene) => gene.trim().toUpperCase()).filter(Boolean)));
  const requiredScore = Number(params.get("score") || 400);
  const addNodes = Number(params.get("add_nodes") || 0);
  const networkType = params.get("network_type") || "functional";
  if (!genes.length || genes.length > 50 || genes.some((gene) => !/^[A-Z0-9-]{1,20}$/.test(gene)) ||
      !Number.isInteger(requiredScore) || requiredScore < 0 || requiredScore > 1000 ||
      !Number.isInteger(addNodes) || addNodes < 0 || addNodes > 50 ||
      !["functional", "physical"].includes(networkType)) {
    return NextResponse.json({ error: "Invalid STRING network parameters" }, { status: 400 });
  }

  const cacheKey = JSON.stringify({ genes: [...genes].sort(), requiredScore, addNodes, networkType });
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return NextResponse.json(cached.data);

  const body = new URLSearchParams({
    identifiers: genes.join("\r"),
    species: "9606",
    required_score: String(requiredScore),
    add_nodes: String(addNodes),
    network_type: networkType,
    caller_identity: "KinomeX",
  });
  try {
    const response = await fetch("https://string-db.org/api/tsv/network", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/tab-separated-values" },
      body,
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`STRING returned ${response.status}`);
    const interactions = parseStringNetworkTsv(await response.text());
    const nodes = Array.from(new Set(interactions.flatMap((edge) => [edge.source, edge.target])))
      .map((id) => ({ id }));
    const data = {
      nodes,
      interactions,
      query: { genes, species: 9606, requiredScore, addNodes, networkType },
      source: "STRING",
      sourceUrl: "https://string-db.org/",
    };
    cache.set(cacheKey, { expires: Date.now() + 15 * 60_000, data });
    return NextResponse.json(data);
  } catch (error) {
    console.error("GET /api/interactions error:", error);
    return NextResponse.json({ error: "STRING interaction data is temporarily unavailable" }, { status: 502 });
  }
}
