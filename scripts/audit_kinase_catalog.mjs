import fs from "node:fs/promises";
import { MongoClient } from "mongodb";

const outputArg = process.argv.find((arg) => arg.startsWith("--output="));
const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/kinomex";
const client = new MongoClient(uri);
await client.connect();
try {
  const db = client.db();
  const kinases = db.collection("kinases");
  const metadata = await db.collection("catalog_metadata").findOne({ _id: "human-kinase-catalog" });
  const docs = await kinases.find({}, {
    projection: { _id: 0, uniprot_id: 1, gene_symbol: 1, catalog_membership: 1, kinhub_domains: 1 },
  }).toArray();
  const genes = new Set(docs.map((doc) => doc.gene_symbol).filter(Boolean));
  const accessions = new Set(docs.map((doc) => doc.uniprot_id).filter(Boolean));
  const membership = Object.fromEntries((await kinases.aggregate([
    { $group: { _id: "$catalog_membership", count: { $sum: 1 } } },
  ]).toArray()).map((row) => [row._id || "<missing>", row.count]));
  const groupCounts = Object.fromEntries((await kinases.aggregate([
    { $group: { _id: "$group", count: { $sum: 1 } } }, { $sort: { _id: 1 } },
  ]).toArray()).map((row) => [row._id || "<missing>", row.count]));
  const duplicateGenes = await kinases.aggregate([
    { $group: { _id: "$gene_symbol", accessions: { $addToSet: "$uniprot_id" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }, { $sort: { _id: 1 } },
  ]).toArray();
  const coreDomainRows = docs.reduce((sum, doc) => sum + (doc.kinhub_domains?.length || 0), 0);
  const coverageDocuments = await db.collection("source_coverage").find({}, { projection: { _id: 0 } }).toArray();
  const sourceCoverage = Object.fromEntries(coverageDocuments.map((doc) => [doc.source === "uniprot" ? "uniprot_diseases" : doc.source, doc]));

  const related = {};
  for (const [collection, genePath] of [
    ["expression", "gene_symbol"], ["variants", "gene_symbol"], ["diseases", "gene_symbol"],
    ["pdis", "gene_symbol"], ["bioactivities", "target_gene_symbol"],
  ]) {
    const coll = db.collection(collection);
    const values = await coll.distinct(genePath);
    const linked = values.filter((value) => value && genes.has(value));
    const orphan = values.filter((value) => value && !genes.has(value));
    related[collection] = {
      documents: await coll.countDocuments(),
      distinctGeneSymbols: values.filter(Boolean).length,
      linkedGeneSymbols: linked.length,
      orphanGeneSymbols: orphan,
    };
  }
  const structureGenes = (await db.collection("structures").distinct("gene_symbols")).filter(Boolean);
  related.structures = {
    documents: await db.collection("structures").countDocuments(),
    distinctGeneSymbols: structureGenes.length,
    linkedGeneSymbols: structureGenes.filter((gene) => genes.has(gene)).length,
    orphanGeneSymbols: structureGenes.filter((gene) => !genes.has(gene)),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    definitions: {
      totalEntries: "Union of KinHub roster accessions resolvable in UniProt and reviewed human UniProt entries carrying keyword KW-0418.",
      coreEntries: "UniProt entries represented by at least one row in the current KinHub table.",
      extendedEntries: "Reviewed human UniProt Protein kinase keyword entries not represented in KinHub.",
      domainRows: "KinHub table rows; multi-domain proteins contribute more than one row.",
    },
    totals: {
      entries: docs.length,
      distinctAccessions: accessions.size,
      distinctGeneSymbols: genes.size,
      coreDomainRows,
      membership,
      groupCounts,
    },
    metadata,
    duplicateGeneSymbols: duplicateGenes,
    requiredFieldGaps: {
      missingUniProtId: await kinases.countDocuments({ $or: [{ uniprot_id: "" }, { uniprot_id: null }, { uniprot_id: { $exists: false } }] }),
      missingGeneSymbol: await kinases.countDocuments({ $or: [{ gene_symbol: "" }, { gene_symbol: null }, { gene_symbol: { $exists: false } }] }),
      missingMembership: await kinases.countDocuments({ catalog_membership: { $nin: ["kinhub_core", "uniprot_extended"] } }),
    },
    relatedCollections: related,
    sourceCoverage,
    reconciled:
      docs.length === (membership.kinhub_core || 0) + (membership.uniprot_extended || 0) &&
      coreDomainRows === metadata?.kinhub_domain_rows &&
      (metadata?.unresolved_kinhub_accessions?.length || 0) === 0 &&
      sourceCoverage.gtex?.complete === true && sourceCoverage.gtex?.catalog_entries_queried === docs.length &&
      sourceCoverage.clinvar?.complete === true && sourceCoverage.clinvar?.catalog_genes_queried === genes.size &&
      sourceCoverage.uniprot_diseases?.complete === true && sourceCoverage.uniprot_diseases?.catalog_entries_queried === docs.length,
  };
  const json = JSON.stringify(report, null, 2) + "\n";
  if (outputArg) await fs.writeFile(outputArg.slice("--output=".length), json);
  process.stdout.write(json);
  if (!report.reconciled) process.exitCode = 1;
} finally {
  await client.close();
}
