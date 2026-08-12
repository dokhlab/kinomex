import { NextRequest } from "next/server";
import OpenAI from "openai";
import { connectToDatabase } from "@/lib/mongodb";
import { escapeRegExp, validateChatMessages } from "@/lib/api-validation";
import { isInteractionQuery, matchesScientificAnnotation, parseQuery, scientificAnnotationRelevance, scientificSearchPattern, shouldSearchExternalEvidence } from "@/lib/query-parser";
import { resolveStructuredGeneSet } from "@/lib/search-filters";
import { externalClaimsAreCited, extractExternalCitations, verifyExternalCitations } from "@/lib/external-citations";
import { findMentionedKinases, searchPubMedEvidence } from "@/lib/pubmed";
import { fetchStringAssociations, stringAssociationUrl, type StringInteraction } from "@/lib/string-network";
import type { Db } from "mongodb";
import { currentUser, decryptSecret } from "@/lib/auth";

type AiVendor = "openai" | "gemini" | "anthropic" | "nvidia" | "ollama";
type RequestAiSettings = { vendor: AiVendor; apiKey: string; model: string; baseUrl: string };
const VENDOR_BASE_URLS: Record<AiVendor, string> = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
  anthropic: "https://api.anthropic.com/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  ollama: "http://localhost:11434/v1",
};

function parseAiSettings(body: unknown): RequestAiSettings | null {
  if (!body || typeof body !== "object" || !("aiSettings" in body)) return null;
  const raw = (body as { aiSettings?: Record<string, unknown> }).aiSettings;
  const vendor = raw?.vendor;
  if (typeof vendor !== "string" || !(vendor in VENDOR_BASE_URLS)) return null;
  const typedVendor = vendor as AiVendor;
  const apiKey = typeof raw?.apiKey === "string" ? raw.apiKey.trim() : "";
  const model = typeof raw?.model === "string" ? raw.model.trim().slice(0, 120) : "";
  if (!model || (typedVendor !== "ollama" && !apiKey)) return null;
  // Provider endpoints are fixed server-side to prevent user-controlled SSRF.
  return { vendor: typedVendor, apiKey, model, baseUrl: VENDOR_BASE_URLS[typedVendor] };
}

function normalizeLegacyOllamaModel(settings: RequestAiSettings): RequestAiSettings {
  if (settings.vendor !== "ollama") return settings;
  const legacyModels: Record<string, string> = { qwen3: "qwen3:14b", mistral: "mistral:latest" };
  return { ...settings, model: legacyModels[settings.model.toLowerCase()] || settings.model };
}

function providerFailureMessage(error: unknown, settings: RequestAiSettings): string {
  const details = error instanceof Error ? error.message : String(error);
  if (settings.vendor === "ollama" && /fetch failed|connect|ECONNREFUSED/i.test(details)) {
    return "Ollama is configured, but its local service is not running at localhost:11434. Start Ollama, confirm the selected model is installed, and try again.";
  }
  if (/404|not found|model.*(missing|unknown)|does not exist/i.test(details)) {
    return `The configured ${settings.vendor} model “${settings.model}” is unavailable. Select an installed or permitted model in User & AI settings.`;
  }
  if (/401|403|unauthorized|authentication|api key|permission/i.test(details)) {
    return `The ${settings.vendor} provider rejected the saved credentials. Replace the API key in User & AI settings.`;
  }
  if (/429|rate.?limit|quota/i.test(details)) {
    return `The ${settings.vendor} provider has reached its rate limit or quota. Try again later or select another provider.`;
  }
  return `The configured ${settings.vendor} AI provider could not complete the request. Test the connection in User & AI settings.`;
}

async function anthropicCompletion(settings: RequestAiSettings, messages: OpenAI.Chat.ChatCompletionMessageParam[]): Promise<string> {
  const system = messages.filter((m) => m.role === "system").map((m) => typeof m.content === "string" ? m.content : "").join("\n\n");
  const conversation = messages.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" }));
  const response = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": settings.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: settings.model, system, messages: conversation, max_tokens: 2048, temperature: 0.1 }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw new Error(`Claude provider returned ${response.status}`);
  const data = await response.json() as { content?: Array<{ type: string; text?: string }> };
  return data.content?.filter((item) => item.type === "text").map((item) => item.text || "").join("") || "";
}

const SYSTEM_PROMPT_BASE = `You are KinomeX AI, a helpful assistant specialized in the human kinome — the complete set of protein kinases encoded in the human genome. You help researchers and students explore kinase data, understand kinase biology, and discover connections between kinases, diseases, tissues, and drugs.

You have access to the current KinomeX database snapshot.

DATABASE SCHEMA:
- gene_symbol (string, e.g. "EGFR", "BRAF", "CDK2") — standard HGNC gene symbol
- full_name (string, e.g. "Epidermal growth factor receptor")
- group (string: AGC, CAMK, CK1, CMGC, STE, TK, TKL, Atypical)
- family (string) — kinase family within the group
- pdis_score (number or null, 0-1) — Pharmaceutical Development Interest Score; null means no verified score
- organ_systems_impacted (string[]) — tissues where the kinase is expressed
- diseases_associated (string[]) — diseases linked to the kinase
- mutation_count (number) — number of ClinVar missense variants
- ligand_count (number) — number of assayed compounds

KINASE GROUPS:
- TK — Tyrosine Kinases (e.g. EGFR, SRC, ABL1, JAK2, MET)
- TKL — Tyrosine Kinase-Like (e.g. RAF1, BRAF, MLK, IRAK)
- STE — Sterile (e.g. MAP2K, MAP3K, PAK)
- CMGC — CDK/MAPK/GSK3/CLK (e.g. CDK1/2/4/6, MAPK1/3, GSK3B)
- AGC — PKA/PKG/PKC (e.g. AKT1/2, PRKACA, ROCK1/2, SGK)
- CAMK — Calcium/Calmodulin (e.g. CAMK2A/B, DAPK, PINK1)
- CK1 — Casein Kinase 1 (e.g. CSNK1A1/D1/E)
- Atypical — atypical kinases (e.g. MTOR, ATM, ATR, CHEK1/2)

PDIS (Pharmaceutical Development Interest Score):
- Ranges 0-1 and summarizes verified publication, trial, structure, and compound-diversity evidence.
- Higher values indicate more recorded development activity, not biological importance or a clinical recommendation.
- Never infer a zero score from a missing PDIS record; report it as unavailable.

Guidelines:
- Answer based on the provided context. If the context doesn't have the data, say you don't know rather than guessing.
- Be concise and scientific. Use markdown for formatting.
- Use standard gene symbols in UPPERCASE (e.g. EGFR, BRAF).
- When listing kinases, include their group and PDIS score.
- If the user asks about a query format you don't understand, ask clarifying questions.
- Do NOT mention internal implementation details.
- When the user asks for "top" or "high PDIS" or "PDIS above/below X", the RELEVANT KINASES FROM DATABASE section contains the actual data — use it to answer with real scores and rankings.
- If the context lists kinases, prefer answering from that list rather than making up examples.
- WEBSITE-GROUNDING RULE: Facts in RELEVANT KINASES FROM DATABASE may be reported as KinomeX data without an external citation. Do not add scientific facts that are absent from that context unless they are supported by a real PubMed-indexed article.
- SOURCE-AWARE EVIDENCE RULE: Cite the authoritative source that supplied each claim. STRING association claims must include the supplied direct STRING link. UniProt annotations must include the supplied UniProt link. KinomeX records may use their supplied dossier link. Literature-derived claims must include a verified PMID and matching DOI. Do not demand a PMID or DOI for a database record whose primary evidence is STRING, UniProt, ClinVar, GTEx, RCSB PDB, or ChEMBL.
- COPYRIGHT RULE: PubMed abstracts can be publisher- or author-copyrighted. Paraphrase supplied abstracts in your own concise scientific language. Do not reproduce an abstract, article passage, or substantial verbatim excerpt; provide PMID and DOI links so the user can consult the source.
- Never invent or approximate a source, identifier, association, or link. If no connected source supplies a claim, say it is unavailable.`;

function buildSystemPrompt(context: Record<string, unknown>[]): string {
  if (!context.length) return SYSTEM_PROMPT_BASE;

  const ctxStr = context
    .map((k) => {
      const parts = [
        `${k.gene_symbol}`,
        `Link:/kinases/${k.gene_symbol}`,
        k.full_name ? `(${k.full_name})` : "",
        `[${k.group}]`,
        k.pdis_score != null ? `PDIS:${k.pdis_score}` : "",
        Array.isArray(k.tissues) && k.tissues.length ? `Tissues:${k.tissues.join(",")}` : "",
        Array.isArray(k.tissues) && k.tissues.length ? "TissueSource:https://gtexportal.org/home/" : "",
        typeof k.ligand_count === "number" ? `Ligands:${k.ligand_count}` : "",
        Array.isArray(k.binding_types) && k.binding_types.length ? `Binding:${k.binding_types.join(",")}` : "",
        typeof k.ligand_count === "number" && k.ligand_count > 0 ? "LigandSource:https://www.ebi.ac.uk/chembl/" : "",
        Array.isArray(k.curated_functions) && k.curated_functions.length ? `CuratedFunction:${k.curated_functions.join(" ")}` : "",
        k.uniprot_url ? `UniProtSource:${k.uniprot_url}` : "",
      ];
      return parts.filter(Boolean).join(" ");
    })
    .join("\n");

  return `${SYSTEM_PROMPT_BASE}\n\nRELEVANT KINASES FROM DATABASE:\n${ctxStr}\n\nAnswer using only the KinomeX context and any additional source evidence explicitly supplied below. Do not supplement it with model memory. When the user asks which kinases or requests a kinase list, return a Markdown table and make every gene symbol a link to its supplied /kinases/GENE profile.`;
}

async function fetchKinaseContext(
  db: import("mongodb").Db,
  query: string
): Promise<Record<string, unknown>[]> {
  const lowerQuery = query.toLowerCase();
  const filters = parseQuery(query);
  const structuredGenes = await resolveStructuredGeneSet(db, filters);

  // If only PDIS/disease keywords without specific kinase names, fetch top by PDIS
  const hasPdisQuery = /pdis/.test(lowerQuery);
  const diseaseWords = ["cancer", "tumor", "disease", "diseases", "mutation", "mutations",
    "glioblastoma", "breast", "lung", "colorectal", "melanoma", "leukemia", "lymphoma",
    "carcinoma", "sarcoma", "neuroblastoma", "alzheimer", "parkinson", "diabetes"];
  const hasDiseaseQuery = diseaseWords.some((d) => lowerQuery.includes(d));

  // Use meaningful kinase-related search terms only
  const expandedTerms = filters.freeText.flatMap((t) => [t, ...t.split(/[-/]/)]);
  const meaningfulTerms = Array.from(new Set(expandedTerms)).filter(
    (t) => t.length >= 2 && /[a-z]{3,}/.test(t)
  ).map(scientificSearchPattern);

  const match: Record<string, unknown> = {};

  if (filters.groups.length) {
    match.group = { $in: filters.groups };
  }
  if (structuredGenes !== null) {
    match.gene_symbol = { $in: structuredGenes };
  }
  if (meaningfulTerms.length) {
    const orConditions = meaningfulTerms.map((t) => ({
      $or: [
        { gene_symbol: { $regex: escapeRegExp(t), $options: "i" } },
        { full_name: { $regex: escapeRegExp(t), $options: "i" } },
        { function_annotations: { $regex: escapeRegExp(t), $options: "i" } },
        { catalytic_activities: { $regex: escapeRegExp(t), $options: "i" } },
        { subunit_annotations: { $regex: escapeRegExp(t), $options: "i" } },
        { keywords: { $regex: escapeRegExp(t), $options: "i" } },
      ],
    }));
    match.$and = orConditions;
  }

  let kinases: Record<string, unknown>[] | undefined;

  if (Object.keys(match).length) {
    const queryLimit = meaningfulTerms.length && isInteractionQuery(query) ? 1000 : 50;
    kinases = await db.collection("kinases").find(match).limit(queryLimit).toArray() as Record<string, unknown>[];
  }

  if (kinases?.length && meaningfulTerms.length && isInteractionQuery(query)) {
    kinases.sort((a, b) =>
      scientificAnnotationRelevance(b, meaningfulTerms) - scientificAnnotationRelevance(a, meaningfulTerms)
    );
    kinases = kinases.slice(0, 30);
  }

  // Mongo deployments can differ in how regex predicates behave over legacy
  // array-shaped annotation fields. For interaction questions, use a bounded
  // catalogue scan as a deterministic fallback so curated Swiss-Prot text is
  // not silently skipped before STRING retrieval.
  if (!kinases?.length && meaningfulTerms.length) {
    const annotatedCatalogue = await db.collection("kinases").find({}, {
      projection: {
        gene_symbol: 1, full_name: 1, group: 1, family: 1, uniprot_id: 1,
        source_url: 1, function_annotations: 1, catalytic_activities: 1,
        subunit_annotations: 1, keywords: 1,
      },
    }).limit(1000).toArray() as Record<string, unknown>[];
    kinases = annotatedCatalogue
      .filter((record) => matchesScientificAnnotation(record, meaningfulTerms))
      .sort((a, b) => scientificAnnotationRelevance(b, meaningfulTerms) - scientificAnnotationRelevance(a, meaningfulTerms))
      .slice(0, 30);
  }

  // Fallback: PDIS query → top by PDIS score
  if (!kinases?.length && hasPdisQuery && !meaningfulTerms.length) {
    const pdisDocs = await db.collection("pdis")
      .find()
      .sort({ pdis_total: -1 })
      .limit(15)
      .toArray();
    const genes = pdisDocs.map((p) => p.gene_symbol as string).filter(Boolean);
    if (genes.length) {
      kinases = await db.collection("kinases")
        .find({ gene_symbol: { $in: genes } })
        .toArray() as Record<string, unknown>[];
      const geneOrder = new Map(genes.map((g, i) => [g, i]));
      kinases.sort((a, b) => (geneOrder.get(a.gene_symbol as string) ?? 99) - (geneOrder.get(b.gene_symbol as string) ?? 99));
    }
  }

  // Fallback: disease query → match disease names
  if (!kinases?.length && hasDiseaseQuery && !meaningfulTerms.length) {
    const diseaseWords = lowerQuery.match(/\b(glioblastoma|breast\s+cancer|lung\s+cancer|colorectal\s+cancer|melanoma|leukemia|lymphoma|diabetes|alzheimer|parkinson)\b/g);
    if (diseaseWords) {
      const diseaseName = escapeRegExp(diseaseWords[0]);
      const diseaseDocs = await db.collection("diseases")
        .find({ "diseases.description": { $regex: diseaseName, $options: "i" } })
        .limit(15)
        .toArray()
        .catch(() => []);
      const genes = Array.from(new Set(diseaseDocs.map((d) => d.gene_symbol as string).filter(Boolean)));
      if (genes.length) {
        kinases = await db.collection("kinases")
          .find({ gene_symbol: { $in: genes } })
          .limit(15)
          .toArray() as Record<string, unknown>[];
      }
    }
  }

  if (!kinases?.length) return [];

  const geneSymbols = kinases.map((k) => k.gene_symbol).filter(Boolean);

  const [pdisDocs, varCounts, diseaseDocs, expDocs, ligandCounts] = await Promise.all([
    db.collection("pdis").find({ gene_symbol: { $in: geneSymbols } }).toArray(),
    db.collection("variants").aggregate([
      { $match: { gene_symbol: { $in: geneSymbols } } },
      { $group: { _id: "$gene_symbol", count: { $sum: 1 } } },
    ]).toArray().catch(() => []),
    db.collection("diseases").find({ gene_symbol: { $in: geneSymbols } }).toArray().catch(() => []),
    db.collection("expression").aggregate([
      { $match: { gene_symbol: { $in: geneSymbols } } },
      { $group: { _id: "$gene_symbol", tissues: { $addToSet: "$tissue_site" } } },
    ]).toArray().catch(() => []),
    db.collection("bioactivities").aggregate([
      { $match: { target_gene_symbol: { $in: geneSymbols } } },
      { $group: { _id: "$target_gene_symbol", compounds: { $addToSet: "$compound_id" }, bindingTypes: { $addToSet: "$binding_type" } } },
    ]).toArray().catch(() => []),
  ]);

  const pdisMap = new Map(pdisDocs.filter((p) => Number.isFinite(p.pdis_total)).map((p) => [p.gene_symbol, p.pdis_total / 100]));
  const varCountMap = new Map(varCounts.map((v) => [v._id, v.count]));
  const diseaseMap = new Map(
    diseaseDocs.map((d) => [
      d.gene_symbol,
      (d.diseases || []).map((dis: { disease_id: string }) => dis.disease_id),
    ])
  );
  const expMap = new Map(expDocs.map((doc) => [doc._id, doc.tissues.filter(Boolean)]));
  const ligandMap = new Map(ligandCounts.map((doc) => [doc._id, {
    count: doc.compounds.filter(Boolean).length,
    bindingTypes: doc.bindingTypes.filter(Boolean),
  }]));

  let context = kinases.map((k) => ({
    gene_symbol: k.gene_symbol,
    full_name: k.full_name,
    group: k.group,
    family: k.family,
    pdis_score: pdisMap.get(k.gene_symbol) ?? null,
    mutation_count: varCountMap.get(k.gene_symbol) || 0,
    diseases: diseaseMap.get(k.gene_symbol) || [],
    tissues: expMap.get(k.gene_symbol) || [],
    ligand_count: ligandMap.get(k.gene_symbol)?.count || 0,
    binding_types: ligandMap.get(k.gene_symbol)?.bindingTypes || [],
    curated_functions: Array.isArray(k.function_annotations) ? k.function_annotations : [],
    uniprot_url: k.source_url || (k.uniprot_id ? `https://www.uniprot.org/uniprotkb/${k.uniprot_id}/entry` : null),
  }));
  if (filters.minPdis !== null) {
    context = context.filter((item) => item.pdis_score !== null && item.pdis_score >= filters.minPdis!);
  }
  if (filters.maxPdis !== null) {
    context = context.filter((item) => item.pdis_score !== null && item.pdis_score <= filters.maxPdis!);
  }
  return context;
}

interface StringEvidenceRow {
  gene: string;
  partner: string;
  score: number;
  url: string;
}

async function fetchStringContext(context: Record<string, unknown>[]): Promise<StringEvidenceRow[]> {
  const genes = context.map((item) => String(item.gene_symbol || "")).filter(Boolean).slice(0, 15);
  const results = await Promise.all(genes.map(async (gene) => ({
    gene,
    edges: await fetchStringAssociations(gene, 10, 700).catch(() => []),
  })));
  const evidence: StringEvidenceRow[] = [];
  for (const { gene, edges } of results) {
    const direct = edges.filter((edge: StringInteraction) =>
      edge.source.toUpperCase() === gene.toUpperCase() || edge.target.toUpperCase() === gene.toUpperCase()
    ).sort((a, b) => b.score - a.score).slice(0, 10);
    for (const edge of direct) {
      const partner = edge.source.toUpperCase() === gene.toUpperCase() ? edge.target : edge.source;
      evidence.push({ gene, partner, score: edge.score, url: stringAssociationUrl(gene, partner) });
    }
  }
  return evidence;
}

async function fetchDirectAnnotationFallback(db: Db, query: string): Promise<Record<string, unknown>[]> {
  const terms = parseQuery(query).freeText.map(scientificSearchPattern).filter(Boolean);
  if (!terms.length) return [];
  const match = { $and: terms.map((term) => ({ $or: [
    { function_annotations: { $regex: escapeRegExp(term), $options: "i" } },
    { catalytic_activities: { $regex: escapeRegExp(term), $options: "i" } },
    { subunit_annotations: { $regex: escapeRegExp(term), $options: "i" } },
    { keywords: { $regex: escapeRegExp(term), $options: "i" } },
  ] })) };
  const records = await db.collection("kinases").find(match, { projection: {
    gene_symbol: 1, full_name: 1, group: 1, family: 1, uniprot_id: 1,
    source_url: 1, function_annotations: 1, catalytic_activities: 1,
    subunit_annotations: 1, keywords: 1,
  } }).limit(50).toArray() as Record<string, unknown>[];
  return records
    .sort((a, b) => scientificAnnotationRelevance(b, terms) - scientificAnnotationRelevance(a, terms))
    .slice(0, 30)
    .map((record) => ({
      ...record,
      curated_functions: Array.isArray(record.function_annotations) ? record.function_annotations : [],
      uniprot_url: record.source_url || (record.uniprot_id ? `https://www.uniprot.org/uniprotkb/${record.uniprot_id}/entry` : null),
    }));
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function buildInteractionEvidenceTable(
  context: Record<string, unknown>[],
  stringEvidence: StringEvidenceRow[],
): string {
  const rows = context.map((kinase) => {
    const gene = String(kinase.gene_symbol || "");
    const functions = Array.isArray(kinase.curated_functions)
      ? kinase.curated_functions.filter((item): item is string => typeof item === "string")
      : [];
    const functionText = functions[0]
      ? markdownCell(functions[0].length > 360 ? `${functions[0].slice(0, 357)}…` : functions[0])
      : "No matching curated function text available.";
    const associations = stringEvidence.filter((item) => item.gene === gene).slice(0, 5);
    const associationText = associations.length
      ? associations.map((item) => `[${item.partner}](${item.url}) (${item.score.toFixed(3)})`).join(", ")
      : "No STRING association met the 0.70 threshold.";
    const uniprotUrl = typeof kinase.uniprot_url === "string" ? kinase.uniprot_url : "";
    const sources = [
      uniprotUrl ? `[UniProtKB/Swiss-Prot](${uniprotUrl})` : "",
      associations.length ? `[STRING network](${associations[0].url})` : "",
    ].filter(Boolean).join(" · ") || "KinomeX dossier";
    return `| [${gene}](/kinases/${gene}) | ${functionText} | ${associationText} | ${sources} |`;
  });
  return [
    "Kinases whose reviewed annotations match the requested biological concept are listed below. STRING scores are association confidence, not proof of direct physical binding.",
    "",
    "| Kinase | Curated functional evidence | High-confidence STRING associations | Sources |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    let aiSettings = parseAiSettings(body);
    if (!aiSettings) {
      const account = await currentUser();
      if (account?.aiSettings) aiSettings = {
        vendor: account.aiSettings.vendor as AiVendor,
        model: account.aiSettings.model,
        baseUrl: account.aiSettings.baseUrl,
        apiKey: decryptSecret(account.aiSettings.encryptedApiKey),
      };
    }
    if (aiSettings) aiSettings = normalizeLegacyOllamaModel(aiSettings);
    const messages = validateChatMessages(
      typeof body === "object" && body !== null && "messages" in body
        ? body.messages
        : undefined
    );

    if (!messages) {
      return new Response(JSON.stringify({ error: "Invalid messages payload" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!aiSettings) {
      return new Response(
        JSON.stringify({
          error: "Configure an AI provider and API key in User & AI settings.",
        }),
        { status: 501, headers: { "Content-Type": "application/json" } }
      );
    }

    const lastUserMsg = [...messages]
      .reverse()
      .find((m) => m.role === "user");

    let context: Record<string, unknown>[] = [];
    let database: Db | null = null;
    if (lastUserMsg) {
      try {
        const mongoose = await connectToDatabase();
        const db = mongoose.connection.db;
        if (!db) throw new Error("MongoDB connection returned no db instance");
        database = db;
        context = await fetchKinaseContext(db, lastUserMsg.content);
      } catch (dbErr) {
        console.error("POST /api/chat db error:", dbErr);
        return new Response(
          JSON.stringify({
            error: "Kinase context is temporarily unavailable",
          }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    if (!context.length && database && lastUserMsg && isInteractionQuery(lastUserMsg.content)) {
      context = await fetchDirectAnnotationFallback(database, lastUserMsg.content);
    }
    const stringEvidence = context.length && lastUserMsg && isInteractionQuery(lastUserMsg.content)
      ? await fetchStringContext(context)
      : [];
    // A reviewed UniProt annotation is already verifiable evidence. Do not
    // block an interaction/association answer on an unrelated PubMed request.
    // STRING augments these rows when it is available.
    if (context.length && lastUserMsg && isInteractionQuery(lastUserMsg.content)) {
      const content = buildInteractionEvidenceTable(context, stringEvidence);
      return new Response(
        `data: ${JSON.stringify({ content })}\n\ndata: [DONE]\n\n`,
        { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
      );
    }
    const externalEvidence = lastUserMsg && (context.length === 0 || shouldSearchExternalEvidence(lastUserMsg.content))
      ? await searchPubMedEvidence(lastUserMsg.content, 16).catch(() => [])
      : [];
    const mentionedKinases = database && externalEvidence.length
      ? await findMentionedKinases(database, externalEvidence).catch(() => [])
      : [];
    const externalEvidenceText = externalEvidence.map((article) =>
      `PMID: ${article.pmid}; DOI: ${article.doi}\nTITLE: ${article.title}\nABSTRACT: ${article.abstract}`
    ).join("\n\n");
    const kinaseLinkText = mentionedKinases.map((kinase) =>
      `${kinase.gene_symbol}: /kinases/${kinase.gene_symbol} (supported by PMID ${kinase.evidence.map((article) => article.pmid).join(", ")})`
    ).join("\n");
    const systemMessage = externalEvidence.length
      ? `${SYSTEM_PROMPT_BASE}\n\nPUBMED EVIDENCE:\n${externalEvidenceText}\n\nKINOMEX KINASE LINKS:\n${kinaseLinkText || "No catalog gene symbol was identified in the retrieved abstracts."}\n\nUse only the supplied abstracts. For a question asking which kinases, return a Markdown table with columns Kinase, Evidence, and References. Link each kinase as [GENE](/kinases/GENE). In References, include clickable [PubMed](https://pubmed.ncbi.nlm.nih.gov/PMID/) and [DOI](https://doi.org/DOI) links plus the literal identifiers [PMID: 12345678; DOI: 10.xxxx/xxxxx]. Put one kinase per row and do not include a kinase unless its supporting abstract is supplied. Every factual table row or prose line must contain its supporting literal PMID and DOI pair.`
      : buildSystemPrompt(context);

    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemMessage },
      ...messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ];
    const client = aiSettings.vendor === "anthropic" ? null : new OpenAI({
      apiKey: aiSettings.apiKey || "ollama-local",
      baseURL: aiSettings.baseUrl,
    });

    // Answers without KinomeX context necessarily use outside knowledge. Hold
    // the completion until every PMID/DOI pair has been checked against NCBI;
    // otherwise no unsupported text is released to the client stream.
    if (externalEvidence.length || context.length === 0) {
      if (!externalEvidence.length) {
        const content = "No connected KinomeX, STRING, UniProt, or PubMed source returned verifiable evidence for this request.";
        return new Response(
          `data: ${JSON.stringify({ content })}\n\ndata: [DONE]\n\n`,
          { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
        );
      }
      try {
        const completionContent = aiSettings.vendor === "anthropic"
          ? await anthropicCompletion(aiSettings, openaiMessages)
          : (await client!.chat.completions.create({
          model: aiSettings.model,
          messages: openaiMessages,
          stream: false,
          temperature: 0.1,
          max_tokens: 2048,
        })).choices?.[0]?.message?.content || "";
        let content = completionContent;
        const allowedCitations = externalEvidence.map(({ pmid, doi }) => ({ pmid, doi }));
        const isVerified = async (answer: string) => {
          const citations = extractExternalCitations(answer);
          return Boolean(answer) && externalClaimsAreCited(answer, allowedCitations) &&
            await verifyExternalCitations(citations);
        };
        if (!await isVerified(content)) {
          const rewriteMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
              ...openaiMessages,
              { role: "assistant", content },
              { role: "user", content: "Rewrite the answer as a Markdown table with columns Kinase, Evidence, and References. Use [GENE](/kinases/GENE) links supplied in KINOMEX KINASE LINKS. Put one kinase per row. End every row with clickable PubMed and DOI links plus the literal [PMID: ...; DOI: ...] pair from the supplied evidence. Include no uncited factual prose." },
            ];
          content = aiSettings.vendor === "anthropic"
            ? await anthropicCompletion(aiSettings, rewriteMessages)
            : (await client!.chat.completions.create({
            model: aiSettings.model,
            messages: rewriteMessages,
            stream: false,
            temperature: 0,
            max_tokens: 2048,
          })).choices?.[0]?.message?.content || "";
        }
        if (!await isVerified(content)) {
          content = [
            "| Kinase | Evidence | References |",
            "|---|---|---|",
            ...(mentionedKinases.length ? mentionedKinases.map((kinase) => {
              const article = kinase.evidence[0];
              return `| [${kinase.gene_symbol}](/kinases/${kinase.gene_symbol}) | Mentioned in “${article.title}”. | [PubMed](https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/) · [DOI](https://doi.org/${article.doi}) [PMID: ${article.pmid}; DOI: ${article.doi}] |`;
            }) : externalEvidence.map((article) =>
              `| Not mapped to KinomeX | “${article.title}” | [PubMed](https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/) · [DOI](https://doi.org/${article.doi}) [PMID: ${article.pmid}; DOI: ${article.doi}] |`
            )),
          ].join("\n");
        }
        return new Response(
          `data: ${JSON.stringify({ content })}\n\ndata: [DONE]\n\n`,
          { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
        );
      } catch (externalErr) {
        console.error("POST /api/chat external verification error:", externalErr);
        return new Response(
          `data: ${JSON.stringify({ content: providerFailureMessage(externalErr, aiSettings) })}\n\ndata: [DONE]\n\n`,
          { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
        );
      }
    }

    let stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk> | null = null;
    let anthropicContent = "";
    try {
      if (aiSettings.vendor === "anthropic") {
        anthropicContent = await anthropicCompletion(aiSettings, openaiMessages);
      } else stream = await client!.chat.completions.create({
        model: aiSettings.model,
        messages: openaiMessages,
        stream: true,
        temperature: 0.3,
        max_tokens: 2048,
      });
    } catch (llmErr) {
      console.error("POST /api/chat LLM error:", llmErr);
      return new Response(
        JSON.stringify({ error: providerFailureMessage(llmErr, aiSettings) }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        try {
          if (anthropicContent) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: anthropicContent })}\n\n`));
          for await (const chunk of stream || []) {
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: delta })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: "Stream error" })}\n\n`
            )
          );
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("POST /api/chat error:", error);
    return new Response(JSON.stringify({ error: "Chat request failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
