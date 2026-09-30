import type { Db } from "mongodb";
import { developmentCandidatesForGene } from "@/lib/development-candidates";
import { parseMutationCode } from "@/lib/kinase-utils";
import { displayCategory } from "@/lib/catalog/build";
import { DEFAULT_WEIGHTS, PDIS_NOTE, COMPONENT_KEYS } from "@/lib/pdis";
import { alphafoldModel, otherStructures, structurePage } from "@/lib/dossier/structures";
import { ligandSummary } from "@/lib/dossier/ligands";

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const GTEX_SOURCE_LABEL = "GTEx v10 median TPM";
export const EXTENSION_BANNER =
  "This entry carries the UniProt Kinase keyword (KW-0418) but has no KinHub row.";

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function gtexGeneUrl(gencodeId: string | null | undefined, gene: string): string {
  return `https://gtexportal.org/home/gene/${encodeURIComponent(gencodeId || gene)}`;
}

export function serializePdis(doc: Doc | null) {
  if (!doc || finite(doc.pdis_total) === null) return null;
  const components = Object.fromEntries(COMPONENT_KEYS.map((k) => [k, finite(doc.components?.[k])]));
  return {
    overall_score: doc.pdis_total,
    scale: "0-100",
    rank_default: finite(doc.rank_default),
    components,
    citation_component: components.citation,
    clinical_component: components.clinical_trials,
    structure_component: components.structure,
    compound_diversity_component: components.compound_diversity,
    raw_values: doc.raw_values ?? null,
    default_weights: Object.fromEntries(COMPONENT_KEYS.map((k, i) => [k, DEFAULT_WEIGHTS[i]])),
    normalisation: doc.normalisation ?? null,
    formula_version: doc.formula_version ?? null,
    retrieved_at: doc.retrieved_at ?? null,
    note: PDIS_NOTE,
  };
}

// ClinVar records keep their source classification; missing fields read as
// unavailable rather than a guessed default.
export function serializeClinvar(v: Doc) {
  const position = v.position > 0 ? v.position : parseMutationCode(v.mutation_code).position || null;
  const resolved = v.germline_classification != null;
  return {
    mutation_code: v.mutation_code,
    position,
    wildtype_aa: v.wildtype_aa ?? null,
    mutant_aa: v.mutant_aa ?? null,
    hgvs: v.source_title ?? null,
    clinvar_uid: v.clinvar_uid ?? null,
    clinvar_accession: v.clinvar_accession ?? null,
    classification: resolved ? v.germline_classification : null,
    review_status: v.review_status ?? null,
    review_stars: finite(v.review_stars),
    conditions: Array.isArray(v.conditions) ? v.conditions : [],
    last_evaluated: v.classification_last_evaluated ?? null,
    url: v.clinvar_url || v.source_url || (v.clinvar_uid ? `https://www.ncbi.nlm.nih.gov/clinvar/variation/${v.clinvar_uid}/` : null),
  };
}

export function serializeCurated(v: Doc) {
  return {
    mutation_code: v.mutation_code,
    position: v.position > 0 ? v.position : parseMutationCode(v.mutation_code).position || null,
    wildtype_aa: v.wildtype_aa ?? null,
    mutant_aa: v.mutant_aa ?? null,
    is_gatekeeper: v.is_gatekeeper === true,
    effect_type: v.effect_type ?? null,
    associated_diseases: Array.isArray(v.associated_diseases) ? v.associated_diseases : [],
    affected_drugs: Array.isArray(v.affected_drugs) ? v.affected_drugs : [],
    unconfirmed_drugs: Array.isArray(v.unconfirmed_drugs) ? v.unconfirmed_drugs : [],
    curation_note: v.curation_note ?? v.drug_resistance_context ?? null,
    gatekeeper_basis: v.gatekeeper_basis ?? null,
    pubmed_id: v.pubmed_id || null,
    // A PubMed link appears only when the cited article resolves and names the gene or the mutation.
    citation_verified: citationVerified(v),
    citation_status: citationStatus(v),
    pubmed_url: v.pubmed_id && citationVerified(v) ? `https://pubmed.ncbi.nlm.nih.gov/${v.pubmed_id}/` : null,
    publication_title: v.publication_title ?? null,
    doi: v.doi || null,
  };
}

function citationVerified(v: Doc): boolean {
  const c = v.citation_check;
  return !!(v.pubmed_id && c && c.pmid_resolves && (c.names_gene || c.names_mutation));
}

function citationStatus(v: Doc): string {
  if (!v.pubmed_id) return "No citation supplied";
  const c = v.citation_check;
  if (!c) return "Citation not checked";
  if (!c.pmid_resolves) return `PMID ${v.pubmed_id} does not resolve in PubMed`;
  if (!c.names_gene && !c.names_mutation) return `PMID ${v.pubmed_id} resolves to an article that names neither the gene nor the mutation`;
  return "Citation names the gene or mutation";
}

export async function buildProfile(db: Db, gene: string) {
  const k = await db.collection("kinases").findOne({ gene_symbol: gene }, { projection: { protein_sequence: 1, gene_symbol: 1, full_name: 1,
    kinhub_domains: 1, uniprot_id: 1, reviewed: 1, uniprot_section: 1, function_annotations: 1, catalytic_activities: 1,
    subunit_annotations: 1, source_url: 1, group: 1, family: 1, subfamily: 1, keywords: 1, domain_boundaries: 1, seq_length: 1,
    ec_number: 1, catalog_membership: 1, extension_class: 1, extension_class_basis: 1, uniprot_record_status: 1, gatekeeper: 1 } });
  if (!k) return null;

  const uniprot = k.uniprot_id as string;
  const [pdisDoc, structures, other, alphafold, ligands, expression, clinvar, curated, diseasesDoc, pharos] = await Promise.all([
    db.collection("pdis").findOne({ gene_symbol: gene }),
    structurePage(db, uniprot),
    otherStructures(db, uniprot),
    alphafoldModel(db, uniprot),
    ligandSummary(db, gene),
    db.collection("expression").find({ gene_symbol: gene, source: "gtex" }).sort({ median_tpm: -1 }).toArray(),
    db.collection("variants").find({ gene_symbol: gene, source: "clinvar" }).toArray(),
    db.collection("variants").find({ gene_symbol: gene, source: "curated" }).toArray(),
    db.collection("diseases").findOne({ gene_symbol: gene }),
    db.collection("pharos_targets").findOne({ gene_symbol: gene }).catch(() => null),
  ]);

  const isExtension = k.catalog_membership === "uniprot_extended";
  const group = isExtension ? null : k.group ?? null;
  const category = displayCategory(k);
  const tau = finite(expression[0]?.tau);

  return {
    gene_symbol: k.gene_symbol,
    name: k.full_name || k.kinhub_domains?.[0]?.kinase_name || "Name unavailable",
    organism: "Human",
    uniprot_id: uniprot,
    uniprot_record_status: k.uniprot_record_status || "active",
    partition: isExtension ? "uniprot_extended" : "kinhub_core",
    catalog_membership: k.catalog_membership,
    group,
    extension_class: isExtension ? k.extension_class ?? null : null,
    extension_class_basis: isExtension ? k.extension_class_basis ?? null : null,
    extension_banner: isExtension
      ? `${EXTENSION_BANNER} Class: ${k.extension_class ?? "unavailable"}. Basis: ${k.extension_class_basis ?? "unavailable"}`
      : null,
    display_category: category,
    classification: { group, display_category: category, family: k.family || "", subfamily: k.subfamily || "" },
    subfamily: k.subfamily || "",
    swiss_prot_annotation: {
      reviewed: k.reviewed === true,
      section: k.uniprot_section || (k.reviewed ? "Swiss-Prot" : "Unavailable"),
      functions: Array.isArray(k.function_annotations) ? k.function_annotations : [],
      catalytic_activities: Array.isArray(k.catalytic_activities) ? k.catalytic_activities : [],
      subunit_annotations: Array.isArray(k.subunit_annotations) ? k.subunit_annotations : [],
      source_url: k.source_url || `https://www.uniprot.org/uniprotkb/${uniprot}/entry`,
    },
    pdis_score: serializePdis(pdisDoc),
    pharos: pharos ? { tdl: pharos.tdl ?? null, url: pharos.url ?? `https://pharos.nih.gov/targets/${uniprot}` } : null,
    gatekeeper: k.gatekeeper ?? null,
    expression: {
      source: GTEX_SOURCE_LABEL,
      gene_url: gtexGeneUrl(expression[0]?.gencode_id, gene),
      tau_specificity: tau,
      top_tissue: expression[0]?.tissue_site ?? null,
    },
    tissue_expressions: expression.map((e) => ({
      tissue_name: e.tissue_site,
      tissue_site_id: e.tissue_site_id ?? null,
      organ_system: e.organ_system,
      tpm_value: e.median_tpm,
      tau_specificity: finite(e.tau),
      data_source: GTEX_SOURCE_LABEL,
      dataset_id: e.dataset_id ?? null,
      gtex_url: gtexGeneUrl(e.gencode_id, gene),
    })),
    organ_systems_impacted: Array.from(new Set(expression.map((e) => e.organ_system).filter(Boolean))),
    structures,
    other_structures: other,
    pdis_structure_input_count: finite(pdisDoc?.raw_values?.pdb_count),
    alphafold,
    ligand_summary: ligands,
    development_candidates: developmentCandidatesForGene(gene),
    clinvar_variants: clinvar.map(serializeClinvar),
    curated_mutations: curated.map(serializeCurated),
    diseases_associated: (diseasesDoc?.diseases || []).map((d: Doc) => ({ name: d.disease_id, description: d.description, omim_id: d.omim_id })),
    key_references: curated
      .filter((v) => citationVerified(v))
      .map((v) => ({ pubmed_id: String(v.pubmed_id), doi: v.doi || undefined, citation_text: v.source_title || `Curated mutation ${v.mutation_code}`, relevance_tag: "curated mutation" })),
    domains: k.domain_boundaries || [],
    protein_sequence: k.protein_sequence || "",
    seq_length: finite(k.seq_length) ?? (k.protein_sequence?.length || null),
    ec_number: k.ec_number || "",
    keywords: k.keywords || [],
  };
}
