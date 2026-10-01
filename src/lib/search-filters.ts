import type { Db } from "mongodb";
import type { ParsedFilters } from "@/lib/query-parser";

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SOURCE_BINDING_MODES: Record<string, string> = {
  inhibitor: "inhibitor",
  allosteric: "allosteric",
  agonist: "agonist|activator",
  antagonist: "antagonist",
};

function intersect(sets: Set<string>[]): string[] {
  if (!sets.length) return [];
  return Array.from(sets[0]).filter((gene) => sets.every((set) => set.has(gene)));
}

export async function resolveStructuredGeneSet(
  db: Db,
  filters: ParsedFilters,
): Promise<string[] | null> {
  const lookups: Promise<Set<string>>[] = [];

  if (filters.tissues.length) {
    const pattern = filters.tissues.map(escaped).join("|");
    lookups.push(db.collection("expression").find({
      $or: [
        { tissue_site: { $regex: pattern, $options: "i" } },
        { organ_system: { $regex: pattern, $options: "i" } },
      ],
    }).project({ gene_symbol: 1 }).toArray()
      .then((docs) => new Set(docs.map((doc) => doc.gene_symbol as string).filter(Boolean))));
  }

  if (filters.diseases.length) {
    const pattern = filters.diseases.map(escaped).join("|");
    lookups.push(db.collection("diseases").find({
      "diseases.description": { $regex: pattern, $options: "i" },
    }).project({ gene_symbol: 1 }).toArray()
      .then((docs) => new Set(docs.map((doc) => doc.gene_symbol as string).filter(Boolean))));
  }

  if (filters.bindingTypes.length) {
    // Binding modes come only from source-supplied ChEMBL mechanism records; a
    // requested mode without such annotation (e.g. Type II) matches no gene.
    const patterns = filters.bindingTypes.map((type) => SOURCE_BINDING_MODES[type]).filter(Boolean);
    lookups.push(patterns.length
      ? db.collection("ligand_representatives").find({ binding_mode: { $regex: patterns.join("|"), $options: "i" } })
        .project({ gene_symbol: 1 }).toArray()
        .then((docs) => new Set(docs.map((doc) => doc.gene_symbol as string).filter(Boolean)))
      : Promise.resolve(new Set<string>()));
  }

  if (!lookups.length) return null;
  return intersect(await Promise.all(lookups));
}
