import type { Db } from "mongodb";
import { actionOf, displayRangeFilter, inDisplayRange, measureOf, PLOTTED_RELATIONS, ACTIONS, MEASURES } from "./ligand-display";

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

/** Query parameters shared by the ligand list and plot endpoints; null when invalid. */
export function parseLigandQuery(s: URLSearchParams): LigandQuery | null {
  const q: LigandQuery = {
    page: Number(s.get("page") ?? 1),
    size: Number(s.get("size") ?? LIGAND_PAGE_SIZE),
    search: (s.get("search") ?? "").trim() || undefined,
    activityType: s.get("activity_type") || undefined,
    source: s.get("source") || undefined,
    uncensoredOnly: s.get("uncensored") === "1",
    maxNm: s.get("max_nm") ? Number(s.get("max_nm")) : null,
    sort: (s.get("sort") as LigandQuery["sort"]) || "value",
  };
  if (!Number.isInteger(q.page) || q.page < 1 || !Number.isInteger(q.size) || q.size < 1 || q.size > 500
    || (q.search && q.search.length > 100) || (q.maxNm !== null && !Number.isFinite(q.maxNm))
    || !["value", "name", "records"].includes(q.sort) || (q.source && !["chembl", "pubchem"].includes(q.source))) {
    return null;
  }
  return q;
}

async function hasRepresentatives(db: Db): Promise<boolean> {
  return (await db.listCollections({ name: "ligand_representatives" }, { nameOnly: true }).toArray()).length > 0;
}

// True once the ETL `display` step has written the in-range measurement; until
// then the frozen representative is shown when it lies inside the range.
let displayStepSeen = false;
async function displayPrefix(db: Db): Promise<string> {
  if (!displayStepSeen) {
    displayStepSeen = (await db.collection("ligand_representatives").findOne({ display: { $exists: true } }, { projection: { _id: 1 } })) !== null;
  }
  return displayStepSeen ? "display." : "";
}

// PubChem rows folded into the ChEMBL row with the same standard InChIKey.
const NOT_MERGED = { merged_into: { $exists: false } };

function reportedFilter(prefix: string): Doc {
  return prefix ? { display: { $ne: null } } : displayRangeFilter();
}

export async function ligandSummary(db: Db, gene: string) {
  if (!(await hasRepresentatives(db))) return null;
  const prefix = await displayPrefix(db);
  const [bySource, byType, reported, compounds, merged] = await Promise.all([
    db.collection("ligand_representatives").aggregate([
      { $match: { gene_symbol: gene } },
      { $group: { _id: "$source", rows: { $sum: 1 }, records: { $sum: "$assay_count" }, both: { $sum: { $cond: ["$also_in_other_source", 1, 0] } } } },
    ]).toArray(),
    db.collection("ligand_representatives").aggregate([
      { $match: { gene_symbol: gene } },
      { $group: { _id: { type: "$activity_type", censored: "$censored" }, n: { $sum: 1 } } },
    ]).toArray(),
    db.collection("ligand_representatives").countDocuments({ gene_symbol: gene, ...reportedFilter(prefix) }),
    db.collection("ligand_representatives").countDocuments({ gene_symbol: gene, ...NOT_MERGED }),
    db.collection("ligand_representatives").countDocuments({ gene_symbol: gene, merged_from: { $exists: true } }),
  ]);
  const sum = (key: "rows" | "records" | "both") => bySource.reduce((s, r) => s + (r[key] ?? 0), 0);
  return {
    representative_rows: compounds,
    records: sum("records"),
    rows_in_both_sources: prefix ? merged : sum("both"),
    reported_rows: reported,
    hidden_rows: compounds - reported,
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

export function ligandFilter(gene: string, q: LigandQuery, prefix = "display."): Doc {
  const filter: Doc = { gene_symbol: gene, ...reportedFilter(prefix) };
  if (q.search) {
    const re = { $regex: escapeRegExp(q.search), $options: "i" };
    filter.$or = [{ compound_name: re }, { compound_id: re }, { compound_key: re }, { merged_from: re }, { inchikey: re }];
  }
  if (q.activityType) filter[`${prefix}activity_type`] = q.activityType;
  if (q.source) filter[prefix ? "sources" : "source"] = q.source;
  if (q.uncensoredOnly) filter[`${prefix}censored`] = false;
  if (q.maxNm != null) filter[`${prefix}value_nm`] = { ...(prefix ? {} : filter.value_nm), $lte: q.maxNm };
  return filter;
}

function sortFor(sort: LigandQuery["sort"], prefix: string): Doc {
  if (sort === "name") return { compound_name: 1, compound_key: 1 };
  if (sort === "records") return { assay_count: -1, compound_key: 1 };
  return { [`${prefix}tier`]: 1, [`${prefix}value_nm`]: 1, compound_key: 1 };
}

// The measurement a row reports: the in-range `display` sub-document, or the
// frozen representative before the display step has run.
function measurementOf(doc: Doc): Doc {
  return doc.display !== undefined ? (doc.display ?? {}) : doc;
}

export function serializeRepresentative(doc: Doc) {
  const m = measurementOf(doc);
  const rep = m.representative ?? {};
  const pubchemCids: number[] = doc.source === "pubchem" ? [doc.pubchem_cid] : (doc.merged_pubchem_cids ?? []);
  return {
    compound_key: doc.compound_key,
    source: doc.source,
    sources: doc.sources ?? [doc.source],
    compound_id: doc.compound_id ?? null,
    pubchem_cid: doc.pubchem_cid ?? null,
    pubchem_cids: pubchemCids,
    ligand_name: doc.compound_name || doc.compound_id || (doc.pubchem_cid ? `PubChem CID ${doc.pubchem_cid}` : "Name unavailable"),
    compound_url: doc.compound_url ?? null,
    inchikey: doc.inchikey ?? null,
    also_in_other_source: doc.also_in_other_source === true,
    activity_type: m.activity_type ?? null,
    relation: m.relation ?? "=",
    value_nm: typeof m.value_nm === "number" ? m.value_nm : null,
    censored: m.censored === true,
    tier: m.tier ?? null,
    assay_count: m.record_count ?? doc.assay_count ?? 1,
    in_range_count: m.in_range_count ?? null,
    action: actionOf(m.activity_type, doc.binding_mode),
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
  const prefix = await displayPrefix(db);
  const filter = ligandFilter(gene, q, prefix);
  const [total, docs, types] = await Promise.all([
    db.collection("ligand_representatives").countDocuments(filter),
    db.collection("ligand_representatives").find(filter).sort(sortFor(q.sort, prefix)).skip((q.page - 1) * q.size).limit(q.size).toArray(),
    db.collection("ligand_representatives").distinct(`${prefix}activity_type`, { gene_symbol: gene, ...reportedFilter(prefix) }),
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

// Every plotted point (a reported point value) for the current filters, as
// compact columns: measure and action are indexes into MEASURES and ACTIONS.
export async function ligandPlot(db: Db, gene: string, q: LigandQuery) {
  if (!(await hasRepresentatives(db))) return null;
  const prefix = await displayPrefix(db);
  const filter = ligandFilter(gene, q, prefix);
  const docs = await db.collection("ligand_representatives")
    .find(filter, { projection: { _id: 0, compound_key: 1, compound_id: 1, pubchem_cid: 1, compound_name: 1, binding_mode: 1, "display.activity_type": 1, "display.relation": 1, "display.value_nm": 1, activity_type: 1, relation: 1, value_nm: 1 } })
    .toArray();
  const columns = { key: [] as string[], name: [] as string[], measure: [] as number[], action: [] as number[], value_nm: [] as number[], activity_type: [] as string[] };
  let bounds = 0;
  for (const doc of docs) {
    const m = measurementOf(doc);
    if (!PLOTTED_RELATIONS.includes(m.relation ?? "=") || !inDisplayRange(m.relation, m.value_nm)) { bounds += 1; continue; }
    columns.key.push(doc.compound_key);
    columns.name.push(doc.compound_name || doc.compound_id || `PubChem CID ${doc.pubchem_cid}`);
    columns.measure.push(MEASURES.indexOf(measureOf(m.activity_type)));
    columns.action.push(ACTIONS.indexOf(actionOf(m.activity_type, doc.binding_mode)));
    columns.value_nm.push(m.value_nm);
    columns.activity_type.push(m.activity_type ?? "");
  }
  return { total: docs.length, plotted: columns.key.length, bounds, measures: MEASURES, actions: ACTIONS, ...columns };
}

function toNm(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function keyMatch(compoundKey: string): Doc | null {
  const [source, id] = compoundKey.split(":", 2) as [string, string | undefined];
  if (!id || !["chembl", "pubchem"].includes(source)) return null;
  return source === "chembl" ? { source, compound_id: id } : { source, pubchem_cid: Number(id) };
}

// Every underlying record of one compound-kinase pair, including the PubChem
// records merged into a ChEMBL row, with its source link.
export async function ligandRecords(db: Db, gene: string, compoundKey: string) {
  const own = keyMatch(compoundKey);
  if (!own) return null;
  const row = await db.collection("ligand_representatives").findOne(
    { gene_symbol: gene, compound_key: compoundKey }, { projection: { merged_from: 1 } });
  const matches = [own, ...((row?.merged_from ?? []) as string[]).map(keyMatch).filter((m): m is Doc => m !== null)];
  const docs = await db.collection("bioactivities").find({ target_gene_symbol: gene, $or: matches }).limit(5000).toArray();
  const all = docs.map((b) => ({
      source: b.source as string,
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
      source_url: b.source === "chembl"
        ? (b.assay_chembl_id ? `https://www.ebi.ac.uk/chembl/explore/assay/${b.assay_chembl_id}` : null)
        : `https://pubchem.ncbi.nlm.nih.gov/bioassay/${b.assay_aid ?? 1433}`,
    }));
  const records = all
    .filter((r) => inDisplayRange(r.relation, r.value_nm))
    .sort((a, b) => (a.value_nm ?? Infinity) - (b.value_nm ?? Infinity));
  return { records, hidden: all.length - records.length };
}
