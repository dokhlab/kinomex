"use client";

import Link from "next/link";
import {
  COMPONENT_KEYS,
  COMPONENT_LABELS,
  PDIS_NOTE,
  formatWeightsParam,
  isDefaultWeights,
  normalizedWeights,
  round2,
  weightedScore,
  type ComponentKey,
  type PdisComponents,
  type PdisWeights,
} from "@/lib/pdis";
import { getScoreColor } from "@/lib/kinase-utils";
import type { PdisScore } from "./types";

function rawInput(key: ComponentKey, raw: PdisScore["raw_values"]): string {
  if (!raw) return "raw input unavailable";
  const n = (v: number | null) => (v === null ? "unavailable" : v.toLocaleString("en-US"));
  switch (key) {
    case "citation":
      return `${n(raw.pubmed_publication_count)} PubMed records`;
    case "clinical_trials":
      return `${n(raw.clinical_trial_count)} counted trials`;
    case "structure":
      return raw.pdb_count
        ? `${n(raw.pdb_count)} PDB entries; best ${raw.best_resolution_angstrom?.toFixed(2) ?? "unavailable"} Å, mean ${raw.average_resolution_angstrom?.toFixed(2) ?? "unavailable"} Å`
        : "no experimental structure";
    case "compound_diversity":
      return `${n(raw.distinct_compound_count)} distinct compounds`;
  }
}

export default function PDISCard({ pdis, weights }: { pdis: PdisScore | null; weights: PdisWeights }) {
  if (!pdis) {
    return <div className="glass-card p-5 text-sm text-slate-500">PDIS is unavailable for this entry.</div>;
  }
  const complete = COMPONENT_KEYS.every((k) => pdis.components[k] !== null);
  const custom = !isDefaultWeights(weights);
  const total = complete ? round2(weightedScore(pdis.components as PdisComponents, weights)) : null;
  const normalized = normalizedWeights(weights);
  const w = formatWeightsParam(weights);

  return (
    <section className="glass-card p-5" aria-labelledby="pdis-card-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="pdis-card-heading" className="text-base font-semibold text-white">PDIS evidence components</h2>
          <p className="mt-1 text-xs text-slate-500">
            {custom ? "Weights from the Explorer" : "Default weights"}: {weights.map((x) => x.toFixed(2)).join(" / ")} (citation, trials, structure, compounds)
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-extrabold tabular-nums" style={{ color: total === null ? undefined : getScoreColor(total) }}>
            {total === null ? "unavailable" : total.toFixed(2)}
          </div>
          <div className="text-xs text-slate-500">
            {custom
              ? `Default-weight PDIS ${pdis.overall_score.toFixed(2)}`
              : `Rank ${pdis.rank_default ?? "unavailable"} of 678`}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {COMPONENT_KEYS.map((key, i) => {
          const value = pdis.components[key];
          return (
            <div key={key} className="grid grid-cols-[8rem_1fr_3.5rem] items-center gap-3 sm:grid-cols-[8rem_1fr_3.5rem_3rem]">
              <div>
                <div className="text-sm text-slate-200">{COMPONENT_LABELS[key]}</div>
                <div className="text-[11px] text-slate-500">{rawInput(key, pdis.raw_values)}</div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/5" role="img" aria-label={`${COMPONENT_LABELS[key]} component ${value ?? "unavailable"}`}>
                {value !== null && <div className="h-full rounded-full bg-gradient-to-r from-kinome-cyan to-kinome-violet" style={{ width: `${value}%` }} />}
              </div>
              <span className="text-right text-sm tabular-nums text-slate-300">{value === null ? "unavailable" : value.toFixed(2)}</span>
              <span className="hidden text-right text-[11px] tabular-nums text-slate-500 sm:block" title="Normalized weight">
                {(normalized[i] * 100).toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-slate-400">{PDIS_NOTE}</p>
      <div className="mt-2 flex flex-wrap gap-4 text-xs">
        <Link href={w ? `/explorer?w=${w}` : "/explorer"} className="text-kinome-cyan hover:underline">Adjust weights in the Explorer</Link>
        {custom && <Link href="?" className="text-slate-400 hover:underline">Show default weights</Link>}
        <span className="text-slate-600">Formula {pdis.formula_version ?? "unavailable"}{pdis.normalisation ? ` · n_max ${pdis.normalisation.n_max.toLocaleString("en-US")}, c_max ${pdis.normalisation.c_max.toLocaleString("en-US")}` : ""}</span>
      </div>
    </section>
  );
}

