import type { Db } from "mongodb";
import type { ParsedFilters } from "@/lib/query-parser";

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
    const specific = filters.bindingTypes.filter((type) => type !== "inhibitor");
    const patterns = specific.map((type) => {
      if (type === "type_ii") return "type\\s*-?\\s*ii|dfg[- ]out|inactive conformation";
      if (type === "allosteric") return "allosteric|type\\s*-?\\s*iii";
      if (type === "atp_competitive") return "atp[- ]competitive|orthosteric|type\\s*-?\\s*i";
      return escaped(type.replaceAll("_", " "));
    });
    const match = patterns.length ? {
      target_gene_symbol: { $nin: [null, ""] },
      $or: [
        { binding_type: { $regex: patterns.join("|"), $options: "i" } },
        { assay_type: { $regex: patterns.join("|"), $options: "i" } },
      ],
    } : { target_gene_symbol: { $nin: [null, ""] } };
    lookups.push(db.collection("bioactivities").find(match)
      .project({ target_gene_symbol: 1 }).toArray()
      .then((docs) => new Set(docs.map((doc) => doc.target_gene_symbol as string).filter(Boolean))));
  }

  if (!lookups.length) return null;
  return intersect(await Promise.all(lookups));
}
