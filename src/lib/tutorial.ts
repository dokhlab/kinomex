import { WEIGHT_PRESETS, type PdisWeights } from "@/lib/pdis";
import type { CatalogFilters } from "@/lib/catalog/query";

const preset = (id: string) => WEIGHT_PRESETS.find((p) => p.id === id)!.weights as PdisWeights;

export interface Protocol {
  id: string;
  title: string;
  question: string;
  steps: string[];
  filters: CatalogFilters;
  weights: PdisWeights;
  screenshot: string;
  followUp?: { gene: string; tab: string; text: string };
  compareWith?: { label: string; weights: PdisWeights };
}

// Supplementary Protocols S1–S3. Expected outputs on the tutorial page come from
// the live catalog with the same query code the Explorer uses.
export const PROTOCOLS: Protocol[] = [
  {
    id: "S1",
    title: "Protocol S1. Under-cited, tractable KinHub core kinases",
    question: "Which KinHub core kinases have few citations but an experimental structure and many measured compounds?",
    steps: [
      "Open the Explorer.",
      "Set Partition to “KinHub core”.",
      "Enter 100 in “Max citations”.",
      "Check “Has experimental structure”.",
      "Enter 100 in “Min distinct compounds”.",
      "In the PDIS weights panel, choose the preset “Tractability only (0/0/0.5/0.5)”.",
      "Read the ranked table; the sidebar reports the size of the filtered result.",
      "Open the first entry and review its Structure and Ligands tabs.",
    ],
    filters: { partition: "kinhub_core", maxCitations: 100, hasStructure: true, minCompounds: 100 },
    weights: preset("tractability-only"),
    screenshot: "protocol-s1.png",
    followUp: { gene: "CSNK1D", tab: "Ligands", text: "In the CSNK1D dossier, check “Uncensored only” in the Ligands tab to keep only point measurements." },
  },
  {
    id: "S2",
    title: "Protocol S2. Kinases enriched in the central nervous system",
    question: "Which catalog entries show tissue-enriched expression in the CNS in GTEx v10?",
    steps: [
      "Open the Explorer and keep the default weights.",
      "Under GTEx v10 expression, set the organ system to “CNS”.",
      "Check “Tissue-enriched in selected organ” (τ ≥ 0.8, top GTEx tissue within the organ, top median ≥ 1 TPM).",
      "Read the ranked table and the partition counts in the sidebar.",
      "Open an entry and review its Distribution tab, which lists the GTEx v10 median TPM per tissue with links to GTEx.",
    ],
    filters: { organ: "CNS", tissueEnriched: true },
    weights: preset("default"),
    screenshot: "protocol-s2.png",
    followUp: { gene: "CAMKK2", tab: "Distribution", text: "The CAMKK2 Distribution tab shows its top GTEx tissue, median TPM, and τ." },
  },
  {
    id: "S3",
    title: "Protocol S3. Test how the ranking depends on the PDIS weights",
    question: "Which entries stay near the top when the component weights change?",
    steps: [
      "Open the Explorer with the default weights and note the top entries.",
      "In the PDIS weights panel, choose “Equal (0.25 each)”; the ranks, histogram, and PDIS interval update at once.",
      "Move any slider or type a weight; the right column shows each weight divided by the sum.",
      "Copy the page address to share the weights (for example ?w=0.25,0.25,0.25,0.25).",
      "Choose “Export CSV” to save the filtered table with raw inputs, components, weights, and the weighted score.",
    ],
    filters: {},
    weights: preset("equal"),
    screenshot: "protocol-s3.png",
    compareWith: { label: "Default weights", weights: preset("default") },
  },
];
