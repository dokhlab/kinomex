// PDIS formula 3.0: weighted mean of four evidence components on a 0-100 scale.
// The component order everywhere (labels, URL parameter, API) is
// citation, clinical trials, structure, compounds.

export const PDIS_FORMULA_VERSION = "3.0-weighted-mean";

export const COMPONENT_KEYS = ["citation", "clinical_trials", "structure", "compound_diversity"] as const;
export type ComponentKey = (typeof COMPONENT_KEYS)[number];
export type PdisComponents = Record<ComponentKey, number>;
export type PdisWeights = [number, number, number, number];

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  citation: "Citations",
  clinical_trials: "Clinical trials",
  structure: "Structures",
  compound_diversity: "Compounds",
};

export const DEFAULT_WEIGHTS: PdisWeights = [0.3, 0.3, 0.15, 0.15];

export const WEIGHT_PRESETS: { id: string; label: string; weights: PdisWeights }[] = [
  { id: "default", label: "Default (0.30/0.30/0.15/0.15)", weights: DEFAULT_WEIGHTS },
  { id: "equal", label: "Equal (0.25 each)", weights: [0.25, 0.25, 0.25, 0.25] },
  { id: "tractability-only", label: "Tractability only (0/0/0.5/0.5)", weights: [0, 0, 0.5, 0.5] },
  { id: "tractability", label: "Tractability-weighted (0.15/0.15/0.35/0.35)", weights: [0.15, 0.15, 0.35, 0.35] },
  { id: "clinical", label: "Clinical-weighted (0.20/0.50/0.15/0.15)", weights: [0.2, 0.5, 0.15, 0.15] },
];

export const PDIS_NOTE =
  "PDIS summarizes documented development evidence; it does not measure biological importance, efficacy, safety, or clinical priority.";
export const WEIGHTS_NOTE =
  "PDIS is the weighted mean of four evidence components. Weights set how much each component counts; they do not change the underlying records.";

// Rounding removes binary drift (0.3 + 0.3 + 0.15 + 0.15 = 0.8999999999999999),
// matching etl/jmb_revision/pdis_v3.py so default weights reproduce stored totals.
export function weightSum(weights: readonly number[]): number {
  return Math.round(weights.reduce((sum, w) => sum + w, 0) * 1e12) / 1e12;
}

export function isValidWeights(weights: readonly number[]): weights is PdisWeights {
  return weights.length === 4 && weights.every((w) => Number.isFinite(w) && w >= 0) && weightSum(weights) > 0;
}

export function normalizedWeights(weights: PdisWeights): PdisWeights {
  const total = weightSum(weights);
  return weights.map((w) => (total > 0 ? w / total : 0)) as PdisWeights;
}

export function weightedScore(components: PdisComponents, weights: PdisWeights): number {
  const total = weightSum(weights);
  let numerator = 0;
  COMPONENT_KEYS.forEach((key, i) => {
    numerator += weights[i] * components[key];
  });
  return numerator / total;
}

// Matches Python's round(x, 2) in the ETL: rounds the exact binary value
// (87.525 is stored as 87.52499..., giving 87.52 where Math.round gives 87.53),
// and resolves exact binary ties, which occur only at multiples of 1/8, to even.
export function round2(value: number): number {
  const scaled = value * 100;
  if (Number.isInteger(value * 8) && !Number.isInteger(scaled)) {
    const lower = Math.floor(scaled);
    return (lower % 2 === 0 ? lower : lower + 1) / 100;
  }
  return Number(value.toFixed(2));
}

export function sameWeights(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((w, i) => Math.abs(w - b[i]) < 1e-9);
}

export function isDefaultWeights(weights: readonly number[]): boolean {
  return sameWeights(weights, DEFAULT_WEIGHTS);
}

export function presetFor(weights: readonly number[]): string | null {
  return WEIGHT_PRESETS.find((p) => sameWeights(p.weights, weights))?.id ?? null;
}

// URL parameter `w=a,b,c,d`; null for a missing or invalid value.
export function parseWeightsParam(value: string | null | undefined): PdisWeights | null {
  if (!value) return null;
  const parts = value.split(",").map((part) => Number(part.trim()));
  return isValidWeights(parts) ? (parts as PdisWeights) : null;
}

export function formatWeightsParam(weights: PdisWeights): string | null {
  if (isDefaultWeights(weights)) return null;
  return weights.map((w) => String(Number(w.toFixed(4)))).join(",");
}

// Ranks by descending score; exact ties share the integer part of their average
// rank, as in the ETL and the manuscript analysis (scipy rankdata "average").
export function rankScores<T>(items: T[], score: (item: T) => number, tieBreak: (item: T) => string): Map<T, number> {
  const ordered = [...items].sort((a, b) => score(b) - score(a) || tieBreak(a).localeCompare(tieBreak(b)));
  const ranks = new Map<T, number>();
  let start = 0;
  while (start < ordered.length) {
    let end = start;
    while (end + 1 < ordered.length && Math.abs(score(ordered[end + 1]) - score(ordered[start])) <= 1e-9) end += 1;
    const rank = Math.floor((start + end + 2) / 2);
    for (let i = start; i <= end; i += 1) ranks.set(ordered[i], rank);
    start = end + 1;
  }
  return ranks;
}

export interface HistogramBin {
  min: number;
  max: number;
  count: number;
}

export function histogram(scores: number[], bins = 20): HistogramBin[] {
  const width = 100 / bins;
  const out = Array.from({ length: bins }, (_, i) => ({ min: i * width, max: (i + 1) * width, count: 0 }));
  for (const score of scores) {
    const index = Math.min(bins - 1, Math.max(0, Math.floor(score / width)));
    out[index].count += 1;
  }
  return out;
}
