"use client";

import { useEffect, useState } from "react";
import {
  COMPONENT_KEYS,
  COMPONENT_LABELS,
  WEIGHT_PRESETS,
  WEIGHTS_NOTE,
  isValidWeights,
  normalizedWeights,
  presetFor,
  type PdisWeights,
} from "@/lib/pdis";

interface WeightsPanelProps {
  weights: PdisWeights;
  onChange: (weights: PdisWeights) => void;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

// The draft keeps the user's inputs, including an all-zero vector; the applied
// weights change only when the draft is valid, so the scores never break.
export default function WeightsPanel({ weights, onChange }: WeightsPanelProps) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState<number[]>(weights);
  useEffect(() => setDraft(weights), [weights]);

  const valid = isValidWeights(draft);
  const shown = valid ? normalizedWeights(draft as PdisWeights) : null;
  const preset = presetFor(draft);

  const update = (index: number, value: number) => {
    const next = draft.map((w, i) => (i === index ? clamp(value) : w));
    setDraft(next);
    if (isValidWeights(next)) onChange(next as PdisWeights);
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-slate-900/40 backdrop-blur-sm" aria-labelledby="pdis-weights-heading">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span id="pdis-weights-heading" className="text-sm font-semibold text-white">PDIS weights</span>
        <span className="text-xs text-slate-400">
          {preset ? WEIGHT_PRESETS.find((p) => p.id === preset)!.label.split(" (")[0] : "Custom"} {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-white/5 px-4 pb-4 pt-3">
          <p className="text-xs leading-relaxed text-slate-400">{WEIGHTS_NOTE}</p>
          <div className="flex flex-wrap gap-2">
            {WEIGHT_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { setDraft(p.weights); onChange(p.weights); }}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  preset === p.id ? "border-kinome-cyan bg-kinome-cyan/20 text-white" : "border-white/10 text-slate-300 hover:border-kinome-cyan/50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="space-y-3">
            {COMPONENT_KEYS.map((key, i) => (
              <div key={key} className="grid grid-cols-[7.5rem_1fr_4.5rem_3.5rem] items-center gap-3">
                <label htmlFor={`w-${key}`} className="text-xs text-slate-300">{COMPONENT_LABELS[key]}</label>
                <input
                  id={`w-${key}`}
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={draft[i]}
                  onChange={(e) => update(i, Number(e.target.value))}
                  className="w-full accent-cyan-400"
                  aria-label={`${COMPONENT_LABELS[key]} weight`}
                />
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={draft[i]}
                  onChange={(e) => update(i, e.target.value === "" ? 0 : Number(e.target.value))}
                  className="w-full rounded-md border border-white/10 bg-slate-950/60 px-2 py-1 text-right text-xs tabular-nums text-slate-200"
                  aria-label={`${COMPONENT_LABELS[key]} weight value`}
                />
                <span className="text-right text-[11px] tabular-nums text-slate-500" title="Normalized weight (weight divided by the sum)">
                  {shown ? `${(shown[i] * 100).toFixed(0)}%` : "–"}
                </span>
              </div>
            ))}
          </div>
          {!valid && (
            <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              Set at least one weight above zero
            </p>
          )}
          <p className="text-[11px] text-slate-500">
            Order: citation, trials, structure, compounds. The right column shows each weight divided by the sum.
          </p>
        </div>
      )}
    </section>
  );
}
