// Reporting rules and plot encodings for the dossier ligand view; shared by the
// API and the client. The representative rows themselves are frozen; the
// dossier reads the in-range `display` measurement written by the ETL
// `display` step (etl/jmb_revision/ligands.py).

// A value of 0 nM is not a measurement, and a value above 10,000 nM, or a lower
// bound at 10,000 nM or above, reports no activity.
export const DISPLAY_MAX_NM = 10000;
const LOWER_BOUNDS = new Set([">", ">=", ">>"]);
// Only point values are plotted; upper bounds (<, <=) and lower bounds are not.
export const PLOTTED_RELATIONS = ["=", "~"];

export function inDisplayRange(relation: string | null | undefined, value: number | null | undefined): boolean {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > DISPLAY_MAX_NM) return false;
  return !(LOWER_BOUNDS.has(relation ?? "=") && value >= DISPLAY_MAX_NM);
}

// MongoDB form of inDisplayRange over `${prefix}relation` / `${prefix}value_nm`.
export function displayRangeFilter(prefix = "") {
  return {
    [`${prefix}value_nm`]: { $gt: 0, $lte: DISPLAY_MAX_NM },
    $nor: [{ [`${prefix}relation`]: { $in: Array.from(LOWER_BOUNDS) }, [`${prefix}value_nm`]: { $gte: DISPLAY_MAX_NM } }],
  };
}

/** -log10(molar) from nanomolar. */
export function pActivity(valueNm: number): number {
  return 9 - Math.log10(valueNm);
}

export const MEASURES = ["IC50", "Ki", "Kd", "EC50", "Other"] as const;
export type Measure = (typeof MEASURES)[number];
export type Shape = "circle" | "diamond" | "square" | "triangle" | "triangle-down";
export const MEASURE_SHAPES: Record<Measure, Shape> = {
  IC50: "circle", Ki: "diamond", Kd: "square", EC50: "triangle", Other: "triangle-down",
};

export function measureOf(activityType: string | null | undefined): Measure {
  return (MEASURES as readonly string[]).includes(activityType ?? "") && activityType !== "Other" ? (activityType as Measure) : "Other";
}

export const ACTIONS = ["inhibits", "binds", "activates", "unspecified"] as const;
export type Action = (typeof ACTIONS)[number];
// Validated as a set for colour-vision deficiency against the dark card surface
// (all pairs); gray is the neutral "unspecified" slot.
export const ACTION_STYLES: Record<Action, { label: string; color: string }> = {
  inhibits: { label: "inhibits", color: "#d95926" },
  binds: { label: "binds", color: "#3987e5" },
  activates: { label: "activates or modulates", color: "#199e70" },
  unspecified: { label: "effect unspecified", color: "#8a8f9c" },
};

/**
 * The ChEMBL mechanism record decides when one exists; otherwise the measure
 * does: IC50 and Ki report inhibition, Kd reports binding, and EC50, potency
 * and other measures leave the direction unspecified.
 */
export function actionOf(activityType: string | null | undefined, bindingMode: string | null | undefined): Action {
  const mode = (bindingMode ?? "").toUpperCase();
  if (/ACTIVATOR|AGONIST|MODULATOR|OPENER|STABILI[SZ]ER/.test(mode)) return "activates";
  if (/INHIBITOR|ANTAGONIST|BLOCKER|DEGRADER|DISRUPTING/.test(mode)) return "inhibits";
  if (mode === "BINDING AGENT") return "binds";
  const measure = measureOf(activityType);
  if (measure === "IC50" || measure === "Ki") return "inhibits";
  if (measure === "Kd") return "binds";
  return "unspecified";
}

export const ACTION_RULE =
  "Colour shows the action: the ChEMBL mechanism record decides when one exists; otherwise IC50 and Ki report inhibition, Kd reports binding, and EC50, potency and other measures leave the direction unspecified.";
export const RANGE_RULE =
  "Values of 0 nM (not a measurement) and values above 10,000 nM (no activity at 10 µM) are not reported; a compound is shown with its best measurement inside that range.";
