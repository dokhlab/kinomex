import { EXTENSION_CLASSES, EXTENSION_RING_LABEL, KINHUB_GROUPS, type CatalogRow } from "@/lib/catalog/types";

export const CORE_BRANCH_LABEL = "KinHub core";

export interface KinomeTreeNode {
  name: string;
  kind: "root" | "partition" | "category" | "family" | "entry";
  category?: string;
  partition?: CatalogRow["partition"];
  pdis_score?: number | null;
  full_name?: string;
  children?: KinomeTreeNode[];
}

function byName(a: KinomeTreeNode, b: KinomeTreeNode) {
  return a.name.localeCompare(b.name);
}

function leaf(row: CatalogRow): KinomeTreeNode {
  return {
    name: row.gene_symbol,
    kind: "entry",
    category: row.display_category,
    partition: row.partition,
    pdis_score: row.pdis_default,
    full_name: row.name,
  };
}

// Core entries sit under their KinHub group and family; the 156 extensions form
// a separate branch, "UniProt KW-0418 extensions", subdivided by extension class.
export function buildKinomeTree(rows: CatalogRow[]): KinomeTreeNode {
  const core = rows.filter((r) => r.partition === "kinhub_core");
  const ext = rows.filter((r) => r.partition === "uniprot_extended");

  const groups = KINHUB_GROUPS.map((group): KinomeTreeNode => {
    const members = core.filter((r) => r.display_category === group);
    const families = new Map<string, CatalogRow[]>();
    for (const r of members) {
      const fam = r.family || group;
      families.set(fam, [...(families.get(fam) ?? []), r]);
    }
    return {
      name: group,
      kind: "category",
      category: group,
      partition: "kinhub_core",
      children: Array.from(families.entries())
        .map(([fam, list]): KinomeTreeNode => ({
          name: fam,
          kind: "family",
          category: group,
          partition: "kinhub_core",
          children: list.map(leaf).sort(byName),
        }))
        .sort(byName),
    };
  }).filter((g) => g.children!.length > 0);

  const classes = EXTENSION_CLASSES.map((cls): KinomeTreeNode => ({
    name: cls,
    kind: "category",
    category: cls,
    partition: "uniprot_extended",
    children: ext.filter((r) => r.display_category === cls).map(leaf).sort(byName),
  })).filter((c) => c.children!.length > 0);

  return {
    name: "Catalog",
    kind: "root",
    children: [
      { name: CORE_BRANCH_LABEL, kind: "partition", partition: "kinhub_core", children: groups },
      { name: EXTENSION_RING_LABEL, kind: "partition", partition: "uniprot_extended", children: classes },
    ],
  };
}

export function countLeaves(node: KinomeTreeNode): number {
  return node.children ? node.children.reduce((s, c) => s + countLeaves(c), 0) : node.kind === "entry" ? 1 : 0;
}
