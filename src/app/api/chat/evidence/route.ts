import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { isInteractionQuery, matchesScientificAnnotation, parseQuery, scientificAnnotationRelevance, scientificSearchPattern } from "@/lib/query-parser";

export const runtime = "nodejs";

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

async function buildEvidenceResponse(queryValue: unknown) {
  const query = typeof queryValue === "string" ? queryValue.trim().slice(0, 500) : "";
  if (!query || !isInteractionQuery(query)) return NextResponse.json({ matched: false });
  const terms = parseQuery(query).freeText.map(scientificSearchPattern).filter(Boolean);
  if (!terms.length) return NextResponse.json({ matched: false });

  const mongoose = await connectToDatabase();
  const db = mongoose.connection.db;
  if (!db) return NextResponse.json({ error: "KinomeX database is unavailable." }, { status: 503 });
  const catalogue = await db.collection("kinases").find({}, { projection: {
    gene_symbol: 1, full_name: 1, group: 1, uniprot_id: 1, source_url: 1,
    function_annotations: 1, catalytic_activities: 1, subunit_annotations: 1, keywords: 1,
  } }).toArray() as Record<string, unknown>[];
  const matches = catalogue
    .filter((record) => matchesScientificAnnotation(record, terms))
    .sort((a, b) => scientificAnnotationRelevance(b, terms) - scientificAnnotationRelevance(a, terms) || String(a.gene_symbol).localeCompare(String(b.gene_symbol)));
  if (!matches.length) return NextResponse.json({ matched: false });

  const rows = matches.map((record) => {
    const gene = String(record.gene_symbol || "");
    const functions = Array.isArray(record.function_annotations) ? record.function_annotations.filter((v): v is string => typeof v === "string") : [];
    const evidence = functions.find((text) => terms.every((term) => text.toLowerCase().includes(term.toLowerCase()))) || functions[0] || "Reviewed UniProt annotation contains the requested term.";
    const snippet = cell(evidence.length > 420 ? `${evidence.slice(0, 417)}…` : evidence);
    const source = typeof record.source_url === "string" ? record.source_url : record.uniprot_id ? `https://www.uniprot.org/uniprotkb/${record.uniprot_id}/entry` : "";
    return `| [${gene}](/kinases/${gene}) | ${cell(String(record.group || "Other"))} | ${snippet} | ${source ? `[UniProtKB/Swiss-Prot](${source})` : "KinomeX"} |`;
  });
  const content = [
    `Found **${matches.length} kinases** with reviewed annotations matching the requested concept.`,
    "",
    "| Kinase | Group | Curated evidence | Source |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
  return NextResponse.json({ matched: true, content, total: matches.length }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  return buildEvidenceResponse(request.nextUrl.searchParams.get("q"));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { query?: unknown } | null;
  return buildEvidenceResponse(body?.query);
}
