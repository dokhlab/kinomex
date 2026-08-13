import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { deriveGroup, parseMutationCode } from "@/lib/kinase-utils";
import { developmentCandidatesForGene } from "@/lib/development-candidates";

const profileCache = new Map<string, { data: unknown; expiresAt: number }>();
const PROFILE_CACHE_TTL = 60 * 1000;

const PROFILE_CACHE_HEADERS = {
  "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: { gene: string } }
) {
  try {
    const { gene } = params;

    if (!gene) {
      return NextResponse.json(
        { error: "Gene symbol is required" },
        { status: 400 }
      );
    }

    let normalizedGene: string;
    try {
      normalizedGene = decodeURIComponent(gene).trim().toUpperCase();
    } catch {
      return NextResponse.json({ error: "Invalid gene symbol" }, { status: 400 });
    }
    if (!/^[A-Z0-9][A-Z0-9_.-]{0,39}$/.test(normalizedGene)) {
      return NextResponse.json({ error: "Invalid gene symbol" }, { status: 400 });
    }

    const cacheKey = normalizedGene;
    const cached = profileCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.data, { headers: PROFILE_CACHE_HEADERS });
    }
    profileCache.delete(cacheKey);

    const mongoose = await connectToDatabase();
    const db = mongoose.connection.db!;

    // First fetch the kinase doc to get uniprot_id for ChEMBL lookup
    const kinaseDoc = await db.collection("kinases").findOne(
      { gene_symbol: normalizedGene },
      { projection: { gene_symbol: 1, full_name: 1, kinhub_domains: 1, uniprot_id: 1, reviewed: 1, uniprot_section: 1, function_annotations: 1, catalytic_activities: 1, subunit_annotations: 1, source_url: 1, group: 1, subfamily: 1, keywords: 1, domain_boundaries: 1, protein_sequence: 1, seq_length: 1, ec_number: 1 } }
    );

    if (!kinaseDoc) {
      return NextResponse.json(
        { error: `Kinase "${normalizedGene}" not found` },
        { status: 404 }
      );
    }

    // The dossier's initial response is assembled exclusively from imported
    // local data. Live scientific services must never delay route navigation.
    const [pdisDoc, structures, bioactivities, expression, variants, diseasesDoc] = await Promise.all([
      db.collection("pdis").findOne({
        gene_symbol: normalizedGene,
      }),
      db.collection("structures").find({
        gene_symbols: normalizedGene,
      }, { projection: { pdb_id: 1, title: 1, resolution: 1, experimental_method: 1, bound_ligands: 1 } }).limit(20).toArray().catch(() => []),
      db.collection("bioactivities").aggregate([
        { $match: { target_gene_symbol: normalizedGene } },
        { $addFields: {
          _numeric_value: { $convert: { input: "$standard_value", to: "double", onError: null, onNull: null } },
          _ligand_key: { $concat: [
            { $ifNull: ["$source", "unknown"] }, ":",
            { $ifNull: ["$compound_id", { $toString: { $ifNull: ["$pubchem_cid", "unknown"] } }] },
          ] },
        } },
        // Put the most potent finite measurement first, then retain one row
        // per source compound while reporting how many assays support it.
        { $sort: { _numeric_value: 1, activity_id: 1 } },
        { $group: {
          _id: "$_ligand_key",
          best: { $first: "$$ROOT" },
          assay_count: { $sum: 1 },
        } },
        { $replaceRoot: { newRoot: { $mergeObjects: ["$best", { assay_count: "$assay_count" }] } } },
        { $sort: { _numeric_value: 1, compound_id: 1 } },
        { $project: {
          source: 1, standard_value: 1, standard_units: 1, pubchem_cid: 1,
          compound_name: 1, compound_id: 1, binding_type: 1, assay_type: 1,
          standard_relation: 1, pubmed_ids: 1, pubmed_id: 1, doi: 1,
          document_journal: 1, document_year: 1, assay_chembl_id: 1,
          activity_id: 1, assay_count: 1,
        } },
      ]).toArray().catch(() => []),
      db.collection("expression").find({
        gene_symbol: normalizedGene,
      }, { projection: { tissue_site: 1, median_tpm: 1, organ_system: 1, tau: 1, source: 1 } }).toArray().catch(() => []),
      db.collection("variants").find({
        gene_symbol: normalizedGene,
      }, { projection: { mutation_code: 1, position: 1, pathogenicity: 1, drug_resistance_context: 1, is_gatekeeper: 1, wildtype_aa: 1, mutant_aa: 1, source_title: 1, pubmed_id: 1 } }).toArray().catch(() => []),
      db.collection("diseases").findOne({
        gene_symbol: normalizedGene,
      }).catch(() => null),
    ]);

    // Build the unified kinase profile
    const kinase = {
      gene_symbol: kinaseDoc.gene_symbol,
      name: kinaseDoc.full_name || kinaseDoc.kinhub_domains?.[0]?.kinase_name || "Name unavailable",
      alias: "",
      organism: "Human",
      uniprot_id: kinaseDoc.uniprot_id,
      swiss_prot_annotation: {
        reviewed: kinaseDoc.reviewed === true,
        section: kinaseDoc.uniprot_section || (kinaseDoc.reviewed ? "Swiss-Prot" : "Unavailable"),
        functions: Array.isArray(kinaseDoc.function_annotations) ? kinaseDoc.function_annotations : [],
        catalytic_activities: Array.isArray(kinaseDoc.catalytic_activities) ? kinaseDoc.catalytic_activities : [],
        subunit_annotations: Array.isArray(kinaseDoc.subunit_annotations) ? kinaseDoc.subunit_annotations : [],
        source_url: kinaseDoc.source_url || (kinaseDoc.uniprot_id ? `https://www.uniprot.org/uniprotkb/${kinaseDoc.uniprot_id}/entry` : null),
      },
      pdb_id: structures.length > 0 ? structures[0].pdb_id : "",
      group: kinaseDoc.group || deriveGroup(kinaseDoc.keywords || []),
      subfamily: kinaseDoc.subfamily || "",
      family: "",
      classification: {
        group: kinaseDoc.group || deriveGroup(kinaseDoc.keywords || []),
        subfamily: kinaseDoc.subfamily || "",
        family: "",
      },
      pdis_score: pdisDoc && Number.isFinite(pdisDoc.pdis_total) ? {
        overall_score: pdisDoc.pdis_total / 100,
        citation_component: finiteOrNull(pdisDoc.components?.citation),
        clinical_component: finiteOrNull(pdisDoc.components?.clinical_trials),
        structure_component: finiteOrNull(pdisDoc.components?.structure),
        compound_diversity_component: finiteOrNull(pdisDoc.components?.compound_diversity),
        formula_version: pdisDoc.formula_version || null,
        raw_values: pdisDoc.raw_values || null,
        retrieved_at: pdisDoc.retrieved_at || null,
      } : null,
      pathways: [],
      tissue_expressions: expression.map((e) => ({
        tissue_name: e.tissue_site,
        tpm_value: e.median_tpm,
        organ_system: e.organ_system,
        tau_specificity: e.tau,
        data_source: e.source || null,
      })),
      mutations: variants.map((v) => ({
        mutation_code: v.mutation_code,
        position: (() => {
          const p = v.position;
          if (p && p > 0) return p;
          const mc = v.mutation_code;
          if (typeof mc === "string") {
            return parseMutationCode(mc).position;
          }
          return null;
        })(),
        pathogenicity: v.pathogenicity === "Pathogenic" ? "pathogenic" : v.pathogenicity === "Uncertain Significance" ? "variant_of_uncertain_significance" : v.pathogenicity.toLowerCase().replace(/\s+/g, "_"),
        associated_diseases: v.drug_resistance_context ? [v.drug_resistance_context] : [],
        drug_resistance_effects: v.drug_resistance_context ? [{
          drug_name: v.drug_resistance_context,
          mechanism: v.is_gatekeeper ? "gatekeeper" : "resistance",
        }] : [],
        organ_systems_affected: [],
        wildtype_aa: v.wildtype_aa,
        mutant_aa: v.mutant_aa,
        is_gatekeeper: v.is_gatekeeper,
        source_title: v.source_title,
        pubmed_id: v.pubmed_id,
      })),
      ligand_assays: bioactivities.map((b) => {
        let valueNm = typeof b.standard_value === "number" ? b.standard_value : parseFloat(b.standard_value);
        const units = (b.standard_units || "").toLowerCase();
        if (units.includes("nm")) { /* already nM */ }
        else if (units.includes("um") || units.includes("µm")) valueNm *= 1000;
        else if (units.includes("mm")) valueNm *= 1_000_000;
        else if (units.includes("pm") || units.includes("nmol")) valueNm /= 1000;
        const isPubChem = b.source === "pubchem";
        return {
          ligand_name: b.compound_name || (isPubChem ? `PubChem CID ${b.pubchem_cid}` : b.compound_id || "Unknown"),
          chembl_id: b.compound_id,
          pubchem_cid: b.pubchem_cid || null,
          binding_type: b.binding_type || b.assay_type || "",
          assay_type: b.assay_type || "",
          value_nm: Number.isFinite(valueNm) ? valueNm : null,
          relation: b.standard_relation || "=",
          target_conformation: "",
          source: b.source || "chembl",
          assay_count: b.assay_count || 1,
          source_url: isPubChem && b.pubchem_cid
            ? `https://pubchem.ncbi.nlm.nih.gov/compound/${b.pubchem_cid}`
            : b.compound_id
              ? `https://www.ebi.ac.uk/chembl/explore/compound/${b.compound_id}`
              : b.assay_chembl_id
                ? `https://www.ebi.ac.uk/chembl/explore/assay/${b.assay_chembl_id}`
                : null,
          reference: {
            pubmed_id: b.pubmed_ids?.length ? (Array.isArray(b.pubmed_ids) ? b.pubmed_ids[0] : b.pubmed_ids) : "",
            doi: b.doi || "",
            journal: b.document_journal || "",
            year: b.document_year || null,
          },
        };
      }),
      development_candidates: developmentCandidatesForGene(normalizedGene),
      key_references: buildReferences(normalizedGene, variants, bioactivities, structures),
      organ_systems_impacted: Array.from(new Set(expression.map((e) => e.organ_system).filter(Boolean))),
      diseases_associated: (diseasesDoc?.diseases || []).map((d: { disease_id: string; description: string; omim_id: string }) => ({
        name: d.disease_id,
        description: d.description,
        omim_id: d.omim_id,
      })),
      structures: structures.map((s) => ({
        pdb_id: s.pdb_id,
        title: s.title,
        resolution: s.resolution,
        experimental_method: s.experimental_method,
        bound_ligands: s.bound_ligands,
      })),
      domains: kinaseDoc.domain_boundaries || [],
      protein_sequence: kinaseDoc.protein_sequence || "",
      seq_length: Number.isFinite(kinaseDoc.seq_length)
        ? kinaseDoc.seq_length
        : (kinaseDoc.protein_sequence?.length || null),
      ec_number: kinaseDoc.ec_number || "",
      keywords: kinaseDoc.keywords || [],
    };

    profileCache.set(cacheKey, {
      data: kinase,
      expiresAt: Date.now() + PROFILE_CACHE_TTL,
    });
    return NextResponse.json(kinase, { headers: PROFILE_CACHE_HEADERS });
  } catch (error) {
    console.error(`GET /api/kinases/${params.gene} error:`, error);
    return NextResponse.json(
      { error: "Failed to fetch kinase profile" },
      { status: 500 }
    );
  }
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildReferences(
  gene: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  variants: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bioactivities: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  structures: any[]
): Array<{ pubmed_id: string; citation_text: string; doi?: string; relevance_tag: string }> {
  const refs: Array<{ pubmed_id: string; citation_text: string; doi?: string; relevance_tag: string }> = [];
  const seen = new Set<string>();

  // 1. Collect pubmed_ids from variants
  for (const v of variants) {
    if (v.pubmed_id && !seen.has(String(v.pubmed_id))) {
      seen.add(String(v.pubmed_id));
      refs.push({
        pubmed_id: String(v.pubmed_id),
        citation_text: v.source_title || `Variant study for ${gene}`,
        relevance_tag: "variant",
      });
    }
  }

  // 2. Collect pubmed_ids from bioactivities
  for (const b of bioactivities) {
    const pid = b.pubmed_ids || b.pubmed_id;
    if (pid && !seen.has(String(pid))) {
      seen.add(String(pid));
      refs.push({
        pubmed_id: String(pid),
        citation_text: `Bioactivity assay`,
        relevance_tag: "bioactivity",
      });
    }
  }

  // 3. Collect from structures (RCSB links)
  for (const s of structures) {
    if (s.pdb_id && !seen.has(`pdb:${s.pdb_id}`)) {
      seen.add(`pdb:${s.pdb_id}`);
      refs.push({
        pubmed_id: "",
        citation_text: `PDB: ${s.pdb_id}${s.title ? " — " + s.title : ""}`,
        relevance_tag: "structure",
      });
    }
  }

  return refs;
}
