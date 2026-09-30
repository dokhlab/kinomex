import type { Db } from "mongodb";
import { connectToDatabase } from "@/lib/mongodb";
import { buildAccounting, buildCatalogRows, type CatalogInputs } from "@/lib/catalog/build";
import type { CatalogAccounting, CatalogRow } from "@/lib/catalog/types";

const TTL_MS = 10 * 60 * 1000;

interface CatalogSnapshot {
  rows: CatalogRow[];
  accounting: CatalogAccounting;
  loadedAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var kinomexCatalogCache: { snapshot: CatalogSnapshot | null; pending: Promise<CatalogSnapshot> | null } | undefined;
}

const cache = global.kinomexCatalogCache ?? { snapshot: null, pending: null };
global.kinomexCatalogCache = cache;

async function collectionExists(db: Db, name: string): Promise<boolean> {
  return (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
}

async function optional<T>(db: Db, name: string, load: () => Promise<T[]>): Promise<T[] | null> {
  return (await collectionExists(db, name)) ? load() : null;
}

export async function readCatalogInputs(db: Db): Promise<CatalogInputs> {
  const [
    kinases, pdis, expression, variantCounts, diseases, catalogMetadata, releaseMetadata,
    structureGenes, structureCount, ligandStats, alphafold, pharos, quarantineExpression,
    quarantineChembl,
  ] = await Promise.all([
    db.collection("kinases").find({}, { projection: {
      gene_symbol: 1, uniprot_id: 1, full_name: 1, kinhub_domains: 1, catalog_membership: 1, group: 1,
      extension_class: 1, subfamily: 1, uniprot_record_status: 1,
    } }).toArray(),
    db.collection("pdis").find({}, { projection: { gene_symbol: 1, components: 1, raw_values: 1, pdis_total: 1, rank_default: 1, formula_version: 1 } }).toArray(),
    db.collection("expression").aggregate([
      { $match: { source: "gtex" } },
      { $sort: { gene_symbol: 1, median_tpm: -1 } },
      { $group: {
        _id: "$gene_symbol",
        records: { $sum: 1 },
        tau: { $first: "$tau" },
        top_tissue: { $first: "$tissue_site" },
        top_organ: { $first: "$organ_system" },
        top_tpm: { $first: "$median_tpm" },
        gencode_id: { $first: "$gencode_id" },
        organ_systems: { $addToSet: "$organ_system" },
      } },
    ]).toArray(),
    db.collection("variants").aggregate([
      { $group: { _id: { gene: "$gene_symbol", source: "$source" }, n: { $sum: 1 } } },
    ]).toArray(),
    db.collection("diseases").find({}, { projection: { gene_symbol: 1, "diseases.disease_id": 1 } }).toArray(),
    db.collection("catalog_metadata").findOne({ _id: "human-kinase-catalog" as never }),
    db.collection("catalog_metadata").findOne({ _id: "release" as never }),
    db.collection("structures").distinct("gene_symbols"),
    db.collection("structures").countDocuments(),
    readLigandStats(db),
    optional(db, "alphafold_models", () => db.collection("alphafold_models").find({}, { projection: { gene_symbol: 1 } }).toArray()),
    optional(db, "pharos_targets", () => db.collection("pharos_targets").find({}, { projection: { gene_symbol: 1, tdl: 1 } }).toArray()),
    optional(db, "expression_quarantine", () => db.collection("expression_quarantine").find({}, { projection: { gene_symbol: 1 } }).toArray()),
    optional(db, "bioactivities_quarantine", () => db.collection("bioactivities_quarantine").find({}, { projection: { target_gene_symbol: 1 } }).toArray()),
  ]);

  return {
    kinases, pdis, expression, variantCounts, diseases, catalogMetadata, releaseMetadata,
    structureGenes: structureGenes as string[], structureCount, ligandStats, alphafold, pharos,
    quarantineExpression, quarantineChembl,
  } as CatalogInputs;
}

// Representative ligand rows exist after the release migration; before that the
// same statistics come from the raw bioactivity records.
async function readLigandStats(db: Db) {
  if (await collectionExists(db, "ligand_representatives")) {
    return db.collection("ligand_representatives").aggregate([
      { $group: { _id: { gene: "$gene_symbol", source: "$source" }, pairs: { $sum: 1 }, records: { $sum: "$assay_count" } } },
    ]).toArray();
  }
  return db.collection("bioactivities").aggregate([
    { $group: { _id: {
      gene: "$target_gene_symbol",
      source: "$source",
      compound: { $ifNull: ["$compound_id", { $toString: "$pubchem_cid" }] },
    }, records: { $sum: 1 } } },
    { $group: { _id: { gene: "$_id.gene", source: "$_id.source" }, pairs: { $sum: 1 }, records: { $sum: "$records" } } },
  ], { allowDiskUse: true }).toArray();
}

export async function loadCatalog(options: { fresh?: boolean } = {}): Promise<CatalogSnapshot> {
  if (!options.fresh && cache.snapshot && Date.now() - cache.snapshot.loadedAt < TTL_MS) return cache.snapshot;
  if (!cache.pending) {
    cache.pending = (async () => {
      const mongoose = await connectToDatabase();
      const inputs = await readCatalogInputs(mongoose.connection.db!);
      const snapshot = {
        rows: buildCatalogRows(inputs),
        accounting: buildAccounting(inputs),
        loadedAt: Date.now(),
      };
      cache.snapshot = snapshot;
      return snapshot;
    })().finally(() => {
      cache.pending = null;
    });
  }
  return cache.pending;
}
