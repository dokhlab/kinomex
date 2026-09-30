"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { StringInteraction } from "@/lib/string-network";
import { PDIS_NOTE } from "@/lib/pdis";
import type { KinaseDetail } from "@/components/kinase/dossier/types";

function Para({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-slate-300">{children}</p>;
}

const n = (value: number) => value.toLocaleString("en-US");

// A factual summary assembled from the imported records; every sentence maps to
// a tab that shows the underlying source records.
export default function AiSummary({ data }: { data: KinaseDetail }) {
  const [expanded, setExpanded] = useState(false);
  const [interactions, setInteractions] = useState<StringInteraction[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const g = data.gene_symbol;

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ genes: g, score: "700", network_type: "functional", add_nodes: "10" });
    setStatus("loading");
    fetch(`/api/interactions?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "STRING unavailable");
        setInteractions(body.interactions ?? []);
        setStatus("ready");
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setStatus("unavailable");
      });
    return () => controller.abort();
  }, [expanded, g]);

  const partners = interactions
    .filter((e) => e.source.toUpperCase() === g.toUpperCase() || e.target.toUpperCase() === g.toUpperCase())
    .sort((a, b) => b.score - a.score)
    .map((e) => (e.source.toUpperCase() === g.toUpperCase() ? e.target : e.source));

  const functions = data.swiss_prot_annotation?.functions ?? [];
  const pdis = data.pdis_score;
  const top = data.tissue_expressions[0];
  const tau = data.expression.tau_specificity;
  const ligands = data.ligand_summary;
  const clinvar = data.clinvar_variants.length;
  const curated = data.curated_mutations.length;
  const category = data.partition === "kinhub_core" ? `the KinHub ${data.group} group` : `the UniProt extension class "${data.extension_class}"`;

  return (
    <div className="glass-card overflow-hidden">
      <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="group flex w-full items-center justify-between px-5 py-4">
        <div className="text-left">
          <h2 className="text-sm font-semibold text-white transition-colors group-hover:text-kinome-cyan">Summary</h2>
          <p className="text-[11px] text-slate-500">{expanded ? "Hide" : "Show"} a summary of the {g} records</p>
        </div>
        <motion.svg animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }} className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </motion.svg>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
            <div className="space-y-3 border-t border-white/5 px-5 pb-6 pt-4">
              <Para>
                {g} ({data.name}) belongs to {category}.
                {pdis && <> Its default-weight PDIS is {pdis.overall_score.toFixed(2)} of 100 (rank {pdis.rank_default ?? "unavailable"} of 678). {PDIS_NOTE}</>}
              </Para>
              <Para>
                {functions.length > 0
                  ? <>The reviewed UniProtKB/{data.swiss_prot_annotation?.section || "Swiss-Prot"} record states: {functions[0]}</>
                  : `The current import holds no reviewed Swiss-Prot functional description for ${g}.`}
              </Para>
              <Para>
                {status === "loading" ? `KinomeX loads the STRING interactome for ${g}…`
                  : status === "unavailable" ? "STRING is unavailable at the moment; the summary infers no interactions."
                  : status === "ready" && partners.length > 0
                    ? <>At a STRING combined confidence of 0.70, {g} connects directly to {partners.length} protein{partners.length === 1 ? "" : "s"}; the strongest neighbors are {partners.slice(0, 5).join(", ")}. STRING associations combine functional evidence and do not necessarily indicate direct binding.</>
                    : `STRING returns no direct association for ${g} at a combined confidence of 0.70.`}
              </Para>
              <Para>
                {top
                  ? <>In GTEx v10, the highest median expression is {top.tpm_value.toFixed(1)} TPM in {top.tissue_name}; tissue specificity τ is {tau === null ? "unavailable" : tau.toFixed(2)} across {data.tissue_expressions.length} tissues.</>
                  : "GTEx v10 expression is unavailable for this entry."}
              </Para>
              <Para>
                KinomeX holds {data.structures.total} experimental structure{data.structures.total === 1 ? "" : "s"} at ≤3.5 Å,{" "}
                {data.alphafold.available ? `an AlphaFold DB model (global pLDDT ${data.alphafold.global_plddt?.toFixed(1) ?? "unavailable"})` : "no AlphaFold DB model"},{" "}
                {ligands ? `${n(ligands.representative_rows)} source compounds with ${n(ligands.records)} ligand records` : "ligand records that are unavailable"},{" "}
                {n(clinvar)} ClinVar missense record{clinvar === 1 ? "" : "s"}, {curated} literature-curated mutation{curated === 1 ? "" : "s"}, and{" "}
                {data.diseases_associated.length} UniProt disease annotation{data.diseases_associated.length === 1 ? "" : "s"}.
              </Para>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
