import type { Db } from "mongodb";

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const LIGAND_PAGE_SIZE = 100;
export const NOT_ANNOTATED = "Not annotated";
export const QUANTITATIVE_TYPES = ["Kd", "Ki", "IC50", "EC50"];

export interface LigandQuery {
  page: number;
  size: number;
  search?: string;
  activityType?: string;
  source?: string;
  uncensoredOnly?: boolean;
  maxNm?: number | null;
  sort: "value" | "name" | "records";
}

async function hasRepresentatives(db: Db): Promise<boolean> {
  return (await db.listCollections({ name: "ligand_representatives" }, { nameOnly: true }).toArray()).length > 0;
}

export async function ligandSummary(db: Db, gene: string) {
  if (!(await hasRepresentatives(db))) return null;
  const [bySource, byType] = await Promise.all([
    db.collection("ligand_representatives").aggregate([
      { $match: { gene_symbol: gene } },
      { $group: { _id: "$source", rows: { $sum: 1 }, records: { $sum: "$assay_count" }, both: { $sum: { $cond: ["$also_in_other_source", 1, 0] } } } },
    ]).toArray(),
    db.collection("ligand_representatives").aggregate([
      { $match: { gene_symbol: gene } },
      { $group: { _id: { type: "$activity_type", censored: "$censored" }, n: { $sum: 1 } } },
    ]).toArray(),
  ]);
  const sum = (key: "rows" | "records" | "both") => bySource.reduce((s, r) => s + (r[key] ?? 0), 0);
  return {
    representative_rows: sum("rows"),
    records: sum("records"),
    rows_in_both_sources: sum("both"),
    by_source: Object.fromEntries(bySource.map((r) => [r._id, { rows: r.rows, records: r.records }])),
    by_activity_type: byType.reduce((acc: Record<string, { uncensored: number; censored: number }>, r) => {
      const entry = (acc[r._id.type ?? "unavailable"] ??= { uncensored: 0, censored: 0 });
      entry[r._id.censored ? "censored" : "uncensored"] += r.n;
      return acc;
    }, {}),
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function ligandFilter(gene: string, q: LigandQuery): Doc {
  const filter: Doc = { gene_symbol: gene };
  if (q.search) {
    const re = { $regex: escapeRegExp(q.search), $options: "i" };
    filter.$or = [{ compound_name: re }, { compound_id: re }, { compound_key: re }, { inchikey: re }];
  }
  if (q.activityType) filter.activity_type = q.activityType;
  if (q.source) filter.source = q.source;
  if (q.uncensoredOnly) filter.censored = false;
  if (q.maxNm != null) filter.value_nm = { $lte: q.maxNm };
  return filter;
}

const SORTS: Record<LigandQuery["sort"], Doc> = {
  value: { tier: 1, value_nm: 1, compound_key: 1 },
  name: { compound_name: 1, compound_key: 1 },
  records: { assay_count: -1, compound_key: 1 },
};

export function serializeRepresentative(doc: Doc) {
  const rep = doc.representative ?? {};
  return {
    compound_key: doc.compound_key,
    source: doc.source,
    compound_id: doc.compound_id ?? null,
    pubchem_cid: doc.pubchem_cid ?? null,
    ligand_name: doc.compound_name || doc.compound_id || (doc.pubchem_cid ? `PubChem CID ${doc.pubchem_cid}` : "Name unavailable"),
    compound_url: doc.compound_url ?? null,
    inchikey: doc.inchikey ?? null,
    also_in_other_source: doc.also_in_other_source === true,
    other_source_label: doc.also_in_other_source ? (doc.source === "chembl" ? "Also in PubChem" : "Also in ChEMBL") : null,
    activity_type: doc.activity_type ?? null,
    relation: doc.relation ?? "=",
    value_nm: typeof doc.value_nm === "number" ? doc.value_nm : null,
    censored: doc.censored === true,
    tier: doc.tier ?? null,
    assay_count: doc.assay_count ?? 1,
    binding_mode: doc.binding_mode || NOT_ANNOTATED,
    binding_mode_source: doc.binding_mode_source ?? null,
    reference: {
      document_chembl_id: rep.document_chembl_id ?? null,
      pubmed_id: rep.pubmed_id ?? null,
      doi: rep.doi ?? null,
      journal: rep.journal ?? null,
      year: rep.year ?? null,
      source_url: rep.source_url ?? null,
      assay_chembl_id: rep.assay_chembl_id ?? null,
      assay_aid: rep.assay_aid ?? null,
    },
  };
}

export async function ligandPage(db: Db, gene: string, q: LigandQuery) {
  if (!(await hasRepresentatives(db))) return null;
  const filter = ligandFilter(gene, q);
  const [total, docs, types] = await Promise.all([
    db.collection("ligand_representatives").countDocuments(filter),
    db.collection("ligand_representatives").find(filter).sort(SORTS[q.sort]).skip((q.page - 1) * q.size).limit(q.size).toArray(),
    db.collection("ligand_representatives").distinct("activity_type", { gene_symbol: gene }),
  ]);
  return {
    total,
    page: q.page,
    page_size: q.size,
    total_pages: Math.max(1, Math.ceil(total / q.size)),
    activity_types: (types as string[]).filter(Boolean).sort(),
    rows: docs.map(serializeRepresentative),
  };
}

function toNm(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

// Every underlying record of one compound-kinase pair, with its source link.
export async function ligandRecords(db: Db, gene: string, compoundKey: string) {
  const [source, id] = compoundKey.split(":", 2) as [string, string | undefined];
  if (!id || !["chembl", "pubchem"].includes(source)) return null;
  const match: Doc = { target_gene_symbol: gene, source };
  if (source === "chembl") match.compound_id = id;
  else match.pubchem_cid = Number(id);
  const docs = await db.collection("bioactivities").find(match).limit(5000).toArray();
  return docs
    .map((b) => ({
      activity_id: b.activity_id ?? null,
      activity_type: b.assay_type ?? null,
      relation: b.standard_relation ?? "=",
      relation_original: b.standard_relation ?? null,
      value_nm: toNm(b.standard_value),
      units: b.standard_units ?? null,
      pchembl_value: toNm(b.pchembl_value),
      assay_chembl_id: b.assay_chembl_id ?? null,
      assay_aid: b.assay_aid ?? null,
      document_chembl_id: b.document_chembl_id ?? null,
      pubmed_id: b.pubmed_id ?? (Array.isArray(b.pubmed_ids) ? b.pubmed_ids[0] : null) ?? null,
      doi: b.doi || null,
      journal: b.document_journal || null,
      year: b.document_year ?? null,
      source_url: source === "chembl"
        ? (b.assay_chembl_id ? `https://www.ebi.ac.uk/chembl/explore/assay/${b.assay_chembl_id}` : null)
        : `https://pubchem.ncbi.nlm.nih.gov/bioassay/${b.assay_aid ?? 1433}`,
    }))
    .sort((a, b) => (a.value_nm ?? Infinity) - (b.value_nm ?? Infinity));
}
