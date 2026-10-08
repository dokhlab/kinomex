import { actionOf, displayRangeFilter, inDisplayRange, measureOf, pActivity } from "../dossier/ligand-display";

describe("ligand reporting range", () => {
  it.each([
    ["=", 0, false], ["=", -1, false], ["=", null, false], ["=", 0.5, true], ["=", 10000, true],
    ["=", 10000.1, false], ["<", 20000, false], [">", 1000, true], [">", 10000, false], [">=", 10000, false], [null, 5, true],
  ])("%s %s nM -> %s", (relation, value, expected) => {
    expect(inDisplayRange(relation as string | null, value as number | null)).toBe(expected);
  });

  it("builds the matching MongoDB filter", () => {
    expect(displayRangeFilter("display.")).toEqual({
      "display.value_nm": { $gt: 0, $lte: 10000 },
      $nor: [{ "display.relation": { $in: [">", ">=", ">>"] }, "display.value_nm": { $gte: 10000 } }],
    });
  });

  it("converts nanomolar to -log10 molar", () => {
    expect(pActivity(10000)).toBe(5);
    expect(pActivity(1)).toBe(9);
  });
});

describe("plot encodings", () => {
  it("maps measures to shapes groups", () => {
    expect(["Kd", "Ki", "IC50", "EC50", "POTENCY", null].map(measureOf)).toEqual(["Kd", "Ki", "IC50", "EC50", "Other", "Other"]);
  });

  it("lets the ChEMBL mechanism decide the action", () => {
    expect(actionOf("Kd", "INHIBITOR")).toBe("inhibits");
    expect(actionOf("IC50", "POSITIVE ALLOSTERIC MODULATOR")).toBe("activates");
    expect(actionOf("EC50", "ACTIVATOR")).toBe("activates");
  });

  it("falls back to what the measure reports", () => {
    expect(actionOf("IC50", null)).toBe("inhibits");
    expect(actionOf("Ki", null)).toBe("inhibits");
    expect(actionOf("Kd", null)).toBe("binds");
    expect(actionOf("EC50", null)).toBe("unspecified");
    expect(actionOf("POTENCY", null)).toBe("unspecified");
  });
});
