"use client";

import type { CatalogFilters } from "@/lib/catalog/query";
import { TISSUE_ENRICHED_MIN_TPM, TISSUE_ENRICHED_TAU } from "@/lib/catalog/query";
import { EXTENSION_CLASSES, KINHUB_GROUPS, type Partition } from "@/lib/catalog/types";
import { EXTENSION_SHORT_LABELS } from "@/components/ui/GroupBadge";

interface FiltersPanelProps {
  filters: CatalogFilters;
  organs: string[];
  onChange: (filters: CatalogFilters) => void;
}

const input = "w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-kinome-cyan/60";
const label = "mb-1 block text-xs text-slate-500";

function intInput(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default function FiltersPanel({ filters, organs, onChange }: FiltersPanelProps) {
  const set = (patch: Partial<CatalogFilters>) => onChange({ ...filters, ...patch });
  const partition = filters.partition ?? "all";

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={filters.search ?? ""}
        onChange={(e) => set({ search: e.target.value })}
        placeholder="Search by gene symbol, protein name, or UniProt accession…"
        className={`${input} py-3`}
        aria-label="Search catalog entries"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={label}>Partition</span>
          <select
            value={partition}
            onChange={(e) => {
              const next = e.target.value as Partition | "all";
              const keepCategory = !filters.category || next === "all"
                || (next === "kinhub_core" ? (KINHUB_GROUPS as readonly string[]).includes(filters.category) : (EXTENSION_CLASSES as readonly string[]).includes(filters.category));
              set({ partition: next, category: keepCategory ? filters.category : undefined });
            }}
            className={input}
          >
            <option value="all">All entries</option>
            <option value="kinhub_core">KinHub core</option>
            <option value="uniprot_extended">UniProt extensions</option>
          </select>
        </label>
        <label>
          <span className={label}>Category</span>
          <select value={filters.category ?? ""} onChange={(e) => set({ category: e.target.value || undefined })} className={input}>
            <option value="">All categories</option>
            {partition !== "uniprot_extended" && (
              <optgroup label="KinHub groups (core)">
                {KINHUB_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
              </optgroup>
            )}
            {partition !== "kinhub_core" && (
              <optgroup label="Extension classes (UniProt KW-0418)">
                {EXTENSION_CLASSES.map((c) => <option key={c} value={c}>{EXTENSION_SHORT_LABELS[c] ?? c}</option>)}
              </optgroup>
            )}
          </select>
        </label>
      </div>

      <fieldset className="grid gap-4 rounded-xl border border-white/5 p-3 sm:grid-cols-3">
        <legend className="px-1 text-xs font-medium text-slate-400">Evidence filters</legend>
        <label>
          <span className={label}>Max citations</span>
          <input type="number" min={0} step={1} value={filters.maxCitations ?? ""} placeholder="any"
            onChange={(e) => set({ maxCitations: intInput(e.target.value) })} className={input} />
        </label>
        <label>
          <span className={label}>Min distinct compounds</span>
          <input type="number" min={0} step={1} value={filters.minCompounds ?? ""} placeholder="any"
            onChange={(e) => set({ minCompounds: intInput(e.target.value) })} className={input} />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-300">
          <input type="checkbox" checked={!!filters.hasStructure} onChange={(e) => set({ hasStructure: e.target.checked })} className="accent-cyan-400" />
          Has experimental structure
        </label>
      </fieldset>

      <fieldset className="grid gap-4 rounded-xl border border-white/5 p-3 sm:grid-cols-2">
        <legend className="px-1 text-xs font-medium text-slate-400">GTEx v10 expression</legend>
        <label>
          <span className={label}>Organ system of the top GTEx tissue</span>
          <select value={filters.organ ?? ""} onChange={(e) => set({ organ: e.target.value || undefined })} className={input}>
            <option value="">Any organ system</option>
            {organs.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label className="flex items-start gap-2 self-end pb-2 text-sm text-slate-300">
          <input type="checkbox" checked={!!filters.tissueEnriched} disabled={!filters.organ}
            onChange={(e) => set({ tissueEnriched: e.target.checked })} className="mt-1 accent-cyan-400" />
          <span>
            Tissue-enriched in selected organ
            <span className="block text-[11px] text-slate-500">τ ≥ {TISSUE_ENRICHED_TAU}, top GTEx tissue within the organ, top median ≥ {TISSUE_ENRICHED_MIN_TPM} TPM</span>
          </span>
        </label>
      </fieldset>
    </div>
  );
}
