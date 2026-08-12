import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { resolveOrganGenes } from "@/lib/kinase-utils";
import {
  escapeRegExp,
  isKinaseGroup,
  isSafeSort,
  parseFiniteNumber,
} from "@/lib/api-validation";

export const dynamic = "force-dynamic";

const cache = new Map<string, { data: unknown; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key: string) {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiry) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown) {
  cache.set(key, { data, expiry: Date.now() + CACHE_TTL });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const search = (searchParams.get("search") || "").trim();
    const group = (searchParams.get("group") || "").trim();
    const organ_system = (searchParams.get("organ_system") || "").trim();
    const catalog = (searchParams.get("catalog") || "all").trim();
    const minPDIS = parseFiniteNumber(searchParams.get("minPDIS"), 0);
    const maxPDIS = parseFiniteNumber(searchParams.get("maxPDIS"), 1);
    const parsedPage = parseFiniteNumber(searchParams.get("page"), 1);
    const parsedLimit = parseFiniteNumber(searchParams.get("limit"), 20);
    const sort = searchParams.get("sort") || "gene_symbol";
    const hasPdisFilter = searchParams.has("minPDIS") || searchParams.has("maxPDIS");

    if (
      search.length > 100 || organ_system.length > 50 || !isKinaseGroup(group) ||
      !["all", "core", "extended"].includes(catalog) ||
      minPDIS === null || maxPDIS === null || minPDIS < 0 || maxPDIS > 1 || minPDIS > maxPDIS ||
      parsedPage === null || parsedLimit === null || !Number.isInteger(parsedPage) ||
      !Number.isInteger(parsedLimit) || parsedPage < 1 || parsedLimit < 1 || !isSafeSort(sort)
    ) {
      return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
    }

    const page = parsedPage;
    const limit = Math.min(100, parsedLimit);
    const sortDir = sort.startsWith("-") ? -1 : 1;
    const sortField = sort.replace(/^-/, "");

    const cacheKey = JSON.stringify({ search, group, organ_system, catalog, minPDIS, maxPDIS, hasPdisFilter, page, limit, sort });
    const cached = getCached(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const mongoose = await connectToDatabase();
    const db = mongoose.connection.db!;

    const matchStage: Record<string, unknown> = {};

    if (search) {
      const escapedSearch = escapeRegExp(search);
      matchStage.$or = [
        { gene_symbol: { $regex: escapedSearch, $options: "i" } },
        { full_name: { $regex: escapedSearch, $options: "i" } },
      ];
    }

    if (group) {
      matchStage.group = group;
    }
    if (catalog === "core") matchStage.catalog_membership = "kinhub_core";
    if (catalog === "extended") matchStage.catalog_membership = "uniprot_extended";

    // Gene-level filters (organ system, PDIS range) are resolved to gene
    // lists up-front so the total count and pagination only cover matches.
    const geneConditions: Record<string, unknown>[] = [];

    if (organ_system) {
      const organGenes = await resolveOrganGenes(db, organ_system);
      if (organGenes.length === 0) {
        // No kinases match this organ system — return empty
        return NextResponse.json({ kinases: [], total: 0, page, totalPages: 0, groupBreakdown: {} });
      }
      geneConditions.push({ gene_symbol: { $in: organGenes } });
    }

    if (hasPdisFilter) {
      // pdis collection stores scores on a 0-100 scale; resolve matching genes
      // BEFORE pagination so totals and pages reflect only in-range kinases.
      const minTotal = minPDIS * 100;
      const maxTotal = maxPDIS * 100;
      const pdisDocs = await db.collection("pdis")
        .find({ pdis_total: { $gte: minTotal, $lte: maxTotal } })
        .toArray();
      const pdisGenes = new Set((pdisDocs.map((p) => p.gene_symbol)).filter(Boolean) as string[]);
      if (pdisGenes.size === 0) {
        return NextResponse.json({ kinases: [], total: 0, page, totalPages: 0, groupBreakdown: {} });
      }
      geneConditions.push({ gene_symbol: { $in: Array.from(pdisGenes) } });
    }

    if (geneConditions.length > 0) {
      matchStage.$and = geneConditions;
    }

    // Count the complete filtered population before pagination. The breakdown
    // must use this same match stage; deriving it from the returned page makes
    // every group appear capped by the page size.
    const [total, groupRows] = await Promise.all([
      db.collection("kinases").countDocuments(matchStage),
      db.collection("kinases").aggregate([
        { $match: matchStage },
        { $group: { _id: { $ifNull: ["$group", "Atypical"] }, count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ]).toArray(),
    ]);
    const groupBreakdown = Object.fromEntries(
      groupRows.map((row) => [String(row._id), Number(row.count)]),
    );

    // Get kinases with pagination
    const sortDoc: Record<string, 1 | -1> = { [sortField]: sortDir as 1 | -1 };
    const kinases = await db
      .collection("kinases")
      .find(matchStage)
      .sort(sortDoc)
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    const geneSymbols = kinases.map((k) => k.gene_symbol).filter(Boolean);

    // Parallel fetch related data
    const [pdisDocs, varCounts, expDocs, diseaseDocs] = await Promise.all([
      db.collection("pdis").find({ gene_symbol: { $in: geneSymbols } }).toArray(),
      db.collection("variants").aggregate([
        { $match: { gene_symbol: { $in: geneSymbols } } },
        { $group: { _id: "$gene_symbol", count: { $sum: 1 } } },
      ]).toArray().catch(() => []),
      db.collection("expression").aggregate([
        { $match: { gene_symbol: { $in: geneSymbols } } },
        { $group: { _id: "$gene_symbol", systems: { $addToSet: "$organ_system" } } },
      ]).toArray().catch(() => []),
      db.collection("diseases").find({ gene_symbol: { $in: geneSymbols } }).toArray().catch(() => []),
    ]);

    // Build lookup maps
    const pdisMap = new Map(pdisDocs
      .filter((p) => Number.isFinite(p.pdis_total))
      .map((p) => [p.gene_symbol, p.pdis_total / 100]));
    const varCountMap = new Map(varCounts.map((v) => [v._id, v.count]));
    const expMap = new Map(expDocs.map((e) => [e._id, e.systems]));
    const diseaseMap = new Map(diseaseDocs.map((d) => [d.gene_symbol, (d.diseases || []).map((dis: { disease_id: string; description: string; omim_id: string }) => dis.disease_id)]));

    // Enrich kinases
    const enriched = kinases.map((k) => {
      const gene = k.gene_symbol;
      return {
        gene_symbol: gene,
        name: k.full_name || k.kinhub_domains?.[0]?.kinase_name || "Name unavailable",
        uniprot_record_status: k.uniprot_record_status || "active",
        group: k.group || deriveGroup(k.keywords || []),
        subfamily: k.subfamily || "",
        organism: "Human",
        uniprot_id: k.uniprot_id,
        catalog_membership: k.catalog_membership,
        kinase_domain_count: Array.isArray(k.kinhub_domains) ? k.kinhub_domains.length : 0,
        pdis_score: pdisMap.get(gene) ?? null,
        organ_systems_impacted: (expMap.get(gene) || []),
        diseases_associated: diseaseMap.get(gene) || [],
        mutation_count: varCountMap.get(gene) || 0,
      };
    });

    const totalPages = Math.ceil(total / limit);

    const response = { kinases: enriched, total, page, totalPages, groupBreakdown };
    if (total > 0) {
      setCache(cacheKey, response);
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("GET /api/kinases error:", error);
    return NextResponse.json(
      { error: "Failed to fetch kinases" },
      { status: 500 }
    );
  }
}

function deriveGroup(keywords: string[]): string {
  const kw = keywords.map((k) => k.toLowerCase());
  if (kw.some((k) => k.includes("tyrosine-protein kinase"))) return "TK";
  if (kw.some((k) => k.includes("serine/threonine-protein kinase"))) return "CMGC";
  if (kw.some((k) => k.includes("kinase"))) return "Atypical";
  return "Atypical";
}
