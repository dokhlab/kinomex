#!/usr/bin/env node

import fs from "node:fs/promises";
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/kinomex";
await mongoose.connect(uri);
const db = mongoose.connection.db;

const [catalogueTotal, sourceRows, missingGene, invalidQuantitation, perGene] = await Promise.all([
  db.collection("kinases").countDocuments({}),
  db.collection("bioactivities").aggregate([
    { $group: { _id: "$source", records: { $sum: 1 }, genes: { $addToSet: "$target_gene_symbol" }, compounds: { $addToSet: { $ifNull: ["$compound_id", "$pubchem_cid"] } } } },
    { $project: { _id: 0, source: "$_id", records: 1, genes: { $size: "$genes" }, compounds: { $size: "$compounds" } } },
  ]).toArray(),
  db.collection("bioactivities").countDocuments({ $or: [{ target_gene_symbol: { $exists: false } }, { target_gene_symbol: "" }, { target_gene_symbol: null }] }),
  db.collection("bioactivities").countDocuments({ source: "chembl", $or: [
    { activity_id: { $exists: false } }, { activity_id: null },
    { standard_units: { $ne: "nM" } }, { standard_value: { $exists: false } },
  ] }),
  db.collection("kinases").aggregate([
    { $lookup: { from: "bioactivities", localField: "gene_symbol", foreignField: "target_gene_symbol", as: "ligands" } },
    { $project: {
      _id: 0, gene_symbol: 1,
      records: { $size: "$ligands" },
      compounds: { $size: { $setUnion: [{ $map: { input: "$ligands", as: "l", in: { $ifNull: ["$$l.compound_id", { $toString: "$$l.pubchem_cid" }] } } }, []] } },
      sources: { $setUnion: [{ $map: { input: "$ligands", as: "l", in: "$$l.source" } }, []] },
    } },
    { $sort: { gene_symbol: 1 } },
  ]).toArray(),
]);

const report = {
  generated_at: new Date().toISOString(),
  database: uri.replace(/:\/\/[^@]+@/, "://***@"),
  catalogue_total: catalogueTotal,
  genes_with_any_ligand: perGene.filter((row) => row.records > 0).length,
  genes_without_ligands: perGene.filter((row) => row.records === 0).map((row) => row.gene_symbol),
  source_summary: sourceRows,
  integrity: { records_missing_gene_symbol: missingGene, invalid_chembl_records: invalidQuantitation },
  kinases: perGene,
};

await fs.mkdir("reports", { recursive: true });
await fs.writeFile("reports/ligand-coverage.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, kinases: `[${perGene.length} rows]` }, null, 2));
await mongoose.disconnect();
