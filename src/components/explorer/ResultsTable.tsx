"use client";

import Link from "next/link";
import GroupBadge from "@/components/ui/GroupBadge";
import { getScoreColor } from "@/lib/kinase-utils";
import { COMPONENT_KEYS, COMPONENT_LABELS, formatWeightsParam, type PdisWeights } from "@/lib/pdis";
import type { CatalogSort, ScoredRow } from "@/lib/catalog/query";

interface ResultsTableProps {
  rows: ScoredRow[];
  weights: PdisWeights;
  sort: CatalogSort;
  onSort: (sort: CatalogSort) => void;
}

function num(value: number | null | undefined, digits = 0): string {
  return value === null || value === undefined ? "unavailable" : value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function Bar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[11px] text-slate-600">unavailable</span>;
  return (
    <div className="flex items-center gap-1.5" title={value.toFixed(2)}>
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full bg-kinome-cyan/70" style={{ width: `${value}%` }} />
      </div>
      <span className="w-9 text-right text-[11px] tabular-nums text-slate-400">{value.toFixed(1)}</span>
    </div>
  );
}

function SortHeader({ label, value, sort, onSort }: { label: string; value: CatalogSort; sort: CatalogSort; onSort: (s: CatalogSort) => void }) {
  const active = sort === value || sort === `-${value}`;
  return (
    <button type="button" onClick={() => onSort(sort === value && (value === "pdis" || value === "gene_symbol") ? (`-${value}` as CatalogSort) : value)}
      className={`uppercase tracking-wider ${active ? "text-white" : "text-slate-400 hover:text-slate-200"}`}>
      {label}{active ? (sort.startsWith("-") ? " ▲" : " ▼") : ""}
    </button>
  );
}

export default function ResultsTable({ rows, weights, sort, onSort }: ResultsTableProps) {
  const w = formatWeightsParam(weights);
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/40">
      <table className="w-full min-w-[980px] text-sm">
        <thead>
          <tr className="border-b border-white/5 text-left text-[11px] font-medium">
            <th className="px-3 py-3"><SortHeader label="Rank" value="pdis" sort={sort} onSort={onSort} /></th>
            <th className="px-3 py-3"><SortHeader label="Entry" value="gene_symbol" sort={sort} onSort={onSort} /></th>
            <th className="px-3 py-3"><SortHeader label="Category" value="category" sort={sort} onSort={onSort} /></th>
            {COMPONENT_KEYS.map((key) => <th key={key} className="px-3 py-3 uppercase tracking-wider text-slate-400">{COMPONENT_LABELS[key]}</th>)}
            <th className="px-3 py-3 text-right uppercase tracking-wider text-slate-400">PDIS</th>
            <th className="px-3 py-3 text-right uppercase tracking-wider text-slate-500" title="Default-weight PDIS">Default</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((row) => (
            <tr key={row.gene_symbol} className="hover:bg-white/[0.02]">
              <td className="px-3 py-2.5 tabular-nums text-slate-400">{row.rank_weighted ?? "–"}</td>
              <td className="px-3 py-2.5">
                <Link href={`/kinases/${encodeURIComponent(row.gene_symbol)}${w ? `?w=${w}` : ""}`} className="font-semibold text-white hover:text-kinome-cyan">
                  {row.gene_symbol}
                </Link>
                <div className="max-w-[16rem] truncate text-xs text-slate-500" title={row.name}>{row.name}</div>
              </td>
              <td className="px-3 py-2.5"><GroupBadge group={row.display_category} /></td>
              {COMPONENT_KEYS.map((key) => (
                <td key={key} className="px-3 py-2.5"><Bar value={row.components?.[key] ?? null} /></td>
              ))}
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums" style={{ color: row.pdis_weighted === null ? undefined : getScoreColor(row.pdis_weighted) }}>
                {num(row.pdis_weighted, 2)}
              </td>
              <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-500">{num(row.pdis_default, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
