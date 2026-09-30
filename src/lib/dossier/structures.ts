import type { Db } from "mongodb";

export const STRUCTURE_PAGE_SIZE = 25;
export const ALPHAFOLD_NOTE = "Predicted model; not an experimental structure.";
export const NO_ALPHAFOLD = "No AlphaFold DB model available.";

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function emdbUrl(id: string): string {
  return `https://www.ebi.ac.uk/emdb/${id.startsWith("EMD-") ? id : `EMD-${id}`}`;
}

export function serializeStructure(doc: Doc) {
  const emdb = Array.isArray(doc.emdb_ids) ? doc.emdb_ids : [];
  return {
    pdb_id: doc.pdb_id,
    title: doc.title ?? "",
    experimental_method: doc.experimental_method ?? null,
    resolution: typeof doc.resolution === "number" ? doc.resolution : null,
    release_date: doc.release_date ?? null,
    emdb: emdb.map((id: string) => ({ id, url: emdbUrl(id) })),
    bound_ligands: Array.isArray(doc.bound_ligands) ? doc.bound_ligands : [],
    rcsb_url: `https://www.rcsb.org/structure/${doc.pdb_id}`,
  };
}

// Scored experimental structures (≤3.5 Å) mapped to the entry's UniProt accession.
export async function structurePage(db: Db, uniprotId: string, page = 1, size = STRUCTURE_PAGE_SIZE) {
  const filter = { uniprot_ids: uniprotId };
  const [total, docs, methods] = await Promise.all([
    db.collection("structures").countDocuments(filter),
    db.collection("structures").find(filter).sort({ resolution: 1, pdb_id: 1 }).skip((page - 1) * size).limit(size).toArray(),
    db.collection("structures").aggregate([{ $match: filter }, { $group: { _id: "$experimental_method", n: { $sum: 1 } } }]).toArray(),
  ]);
  return {
    total,
    page,
    page_size: size,
    total_pages: Math.max(1, Math.ceil(total / size)),
    by_method: Object.fromEntries(methods.map((m) => [m._id ?? "unavailable", m.n])),
    entries: docs.map(serializeStructure),
  };
}

export async function otherStructures(db: Db, uniprotId: string) {
  const docs = await db.collection("structures_other").find({ uniprot_ids: uniprotId }).sort({ reason: 1, resolution: 1, pdb_id: 1 }).toArray().catch(() => []);
  return docs.map((doc) => ({ ...serializeStructure(doc), reason: doc.reason ?? null }));
}

export async function alphafoldModel(db: Db, uniprotId: string) {
  const doc = await db.collection("alphafold_models").findOne({ uniprot_id: uniprotId }).catch(() => null);
  if (!doc) return { available: false, message: NO_ALPHAFOLD, entry_url: `https://alphafold.ebi.ac.uk/entry/${uniprotId}` };
  return {
    available: true,
    entry_id: doc.entry_id,
    model_version: doc.model_version ?? null,
    global_plddt: typeof doc.global_plddt === "number" ? doc.global_plddt : null,
    uniprot_start: doc.uniprot_start ?? null,
    uniprot_end: doc.uniprot_end ?? null,
    cif_url: doc.cif_url ?? null,
    pdb_url: doc.pdb_url ?? null,
    pae_image_url: doc.pae_image_url ?? null,
    entry_url: doc.url ?? `https://alphafold.ebi.ac.uk/entry/${uniprotId}`,
    note: ALPHAFOLD_NOTE,
  };
}
