import { buildKinomeTree, countLeaves, CORE_BRANCH_LABEL } from "@/lib/catalog/tree";
import { EXTENSION_RING_LABEL } from "@/lib/catalog/types";
import { row } from "@/lib/catalog/__tests__/fixtures";

test("core entries group by KinHub group and family; extensions form their own labeled branch", () => {
  const tree = buildKinomeTree([
    row("EGFR", { family: "EGFR" }),
    row("ERBB2", { family: "EGFR" }),
    row("AKT1", { group: "AGC", display_category: "AGC", family: "AKT" }),
    row("PIK3CA", { partition: "uniprot_extended", group: null, extension_class: "Lipid kinase", display_category: "Lipid kinase" }),
  ]);
  const [core, ext] = tree.children!;
  expect(core.name).toBe(CORE_BRANCH_LABEL);
  expect(ext.name).toBe(EXTENSION_RING_LABEL);
  expect(core.children!.map((g) => g.name)).toEqual(["AGC", "TK"]);
  expect(core.children![1].children![0]).toMatchObject({ name: "EGFR", kind: "family" });
  expect(core.children![1].children![0].children!.map((l) => l.name)).toEqual(["EGFR", "ERBB2"]);
  expect(ext.children!.map((c) => c.name)).toEqual(["Lipid kinase"]);
  expect(countLeaves(core)).toBe(3);
  expect(countLeaves(ext)).toBe(1);
});
