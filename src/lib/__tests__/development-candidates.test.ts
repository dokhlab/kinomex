import { developmentCandidatesForGene } from "@/lib/development-candidates";

describe("development candidate attribution", () => {
  it("associates DGKA candidates without misassigning ASP1570", () => {
    expect(developmentCandidatesForGene("DGKA").map(candidate => candidate.name)).toEqual([
      "BAY 2862789",
      "GS-9911",
      "INCB165451",
    ]);
  });

  it("assigns ASP1570 to DGKZ and records the current trial status", () => {
    const candidates = developmentCandidatesForGene("DGKZ");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].name).toBe("ASP1570");
    expect(candidates[0].mechanism).toContain("DGKζ");
    expect(candidates[0].status).toContain("terminated");
  });
});
