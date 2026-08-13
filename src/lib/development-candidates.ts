export interface DevelopmentCandidate {
  name: string;
  mechanism: string;
  status: string;
  sourceLabel: string;
  sourceUrl: string;
}

const CANDIDATES: Record<string, DevelopmentCandidate[]> = {
  DGKA: [
    {
      name: "BAY 2862789",
      mechanism: "Selective DGKα inhibitor",
      status: "Investigational; Phase 1 first-in-human study in advanced solid tumors (NCT05858164).",
      sourceLabel: "ClinicalTrials.gov",
      sourceUrl: "https://clinicaltrials.gov/study/NCT05858164",
    },
    {
      name: "GS-9911",
      mechanism: "Selective DGKα inhibitor",
      status: "Investigational; Phase 1 study as monotherapy and with zimberelimab in advanced solid tumors (NCT06082960).",
      sourceLabel: "ClinicalTrials.gov",
      sourceUrl: "https://clinicaltrials.gov/study/NCT06082960",
    },
    {
      name: "INCB165451",
      mechanism: "Dual DGKα/DGKζ inhibitor (~2 nM enzymatic IC₅₀ for each isoform)",
      status: "Preclinical compound evaluated in human T-cell and tumor-infiltrating lymphocyte models.",
      sourceLabel: "PMCID: PMC12758329",
      sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12758329/",
    },
  ],
  DGKZ: [
    {
      name: "ASP1570",
      mechanism: "Selective DGKζ inhibitor",
      status: "Investigational; Phase 1/2 study NCT05083481 was terminated for lack of clinical benefit.",
      sourceLabel: "ClinicalTrials.gov",
      sourceUrl: "https://clinicaltrials.gov/study/NCT05083481",
    },
  ],
};

export function developmentCandidatesForGene(gene: string): DevelopmentCandidate[] {
  return CANDIDATES[gene.toUpperCase()] ?? [];
}
