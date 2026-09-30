import {
  DEFAULT_WEIGHTS,
  formatWeightsParam,
  histogram,
  isValidWeights,
  normalizedWeights,
  parseWeightsParam,
  presetFor,
  rankScores,
  round2,
  weightSum,
  weightedScore,
} from "@/lib/pdis";

const egfr = { citation: 100, clinical_trials: 100, structure: 83.52, compound_diversity: 94.62 };

describe("PDIS weights", () => {
  test("weight sum removes binary drift", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(weightSum([0.1, 0.2, 0, 0])).toBe(0.3);
    expect(weightSum(DEFAULT_WEIGHTS)).toBe(0.9);
  });

  test("default weights reproduce the stored EGFR total", () => {
    expect(round2(weightedScore(egfr, DEFAULT_WEIGHTS))).toBe(96.36);
  });

  test("weights are scale-free", () => {
    expect(weightedScore(egfr, [0.25, 0.25, 0.25, 0.25])).toBeCloseTo(weightedScore(egfr, [1, 1, 1, 1]), 10);
    expect(normalizedWeights([1, 1, 2, 0])).toEqual([0.25, 0.25, 0.5, 0]);
  });

  test("validation rejects negative and all-zero weights", () => {
    expect(isValidWeights([0, 0, 0, 0])).toBe(false);
    expect(isValidWeights([-0.1, 0.5, 0.3, 0.3])).toBe(false);
    expect(isValidWeights([0, 0, 0.5, 0.5])).toBe(true);
    expect(isValidWeights([0.3, 0.3, 0.15])).toBe(false);
  });

  test("URL parameter round trip", () => {
    expect(parseWeightsParam("0.25,0.25,0.25,0.25")).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(parseWeightsParam("0,0,0,0")).toBeNull();
    expect(parseWeightsParam("a,b,c,d")).toBeNull();
    expect(parseWeightsParam(null)).toBeNull();
    expect(formatWeightsParam(DEFAULT_WEIGHTS)).toBeNull();
    expect(formatWeightsParam([0.25, 0.25, 0.25, 0.25])).toBe("0.25,0.25,0.25,0.25");
    expect(presetFor([0.25, 0.25, 0.25, 0.25])).toBe("equal");
    expect(presetFor([0.1, 0.2, 0.3, 0.4])).toBeNull();
  });
});

describe("round2", () => {
  test("rounds the exact binary value like Python", () => {
    const kdr = { citation: 71.47, clinical_trials: 100, structure: 87.99, compound_diversity: 94.22 };
    expect(round2(weightedScore(kdr, DEFAULT_WEIGHTS))).toBe(87.52);
    expect(Math.round(weightedScore(kdr, DEFAULT_WEIGHTS) * 100) / 100).toBe(87.53);
    expect(round2(52.105000000000004)).toBe(52.11);
  });

  test("resolves exact binary ties to even", () => {
    expect(round2(23.125)).toBe(23.12);
    expect(round2(23.375)).toBe(23.38);
    expect(round2(0.625)).toBe(0.62);
  });
});

describe("ranking and histogram", () => {
  test("exact ties share the integer part of their average rank", () => {
    const items = [{ g: "A", s: 10 }, { g: "B", s: 9 }, { g: "C", s: 9 }, { g: "D", s: 1 }];
    const ranks = rankScores(items, (i) => i.s, (i) => i.g);
    expect(items.map((i) => ranks.get(i))).toEqual([1, 2, 2, 4]);
  });

  test("20 bins over 0-100 with 100 in the last bin", () => {
    const bins = histogram([0, 4.99, 5, 50, 100]);
    expect(bins).toHaveLength(20);
    expect(bins[0].count).toBe(2);
    expect(bins[1].count).toBe(1);
    expect(bins[10].count).toBe(1);
    expect(bins[19].count).toBe(1);
  });
});
