"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import GroupBadge from "@/components/ui/GroupBadge";
import { EXTENSION_RING_LABEL, KINHUB_GROUPS, type CatalogRow } from "@/lib/catalog/types";

const KinomePhyloTree = dynamic(() => import("@/components/visualizations/KinomePhyloTree"), {
  ssr: false,
  loading: () => <div className="h-[600px] animate-shimmer rounded-2xl bg-white/5" />,
});

const EXTENSIONS = "Extensions";
const FILTERS = ["All", ...KINHUB_GROUPS, EXTENSIONS];

export default function TreePage() {
  const [rows, setRows] = useState<CatalogRow[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/catalog/table")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Catalog table unavailable"))))
      .then((body) => setRows(body.rows))
      .catch((e) => setError(e.message));
  }, []);

  const visible = useMemo(() => {
    if (!rows) return [];
    return rows.filter((r) => filter === "All"
      || (filter === EXTENSIONS ? r.partition === "uniprot_extended" : r.partition === "kinhub_core" && r.display_category === filter));
  }, [rows, filter]);
  const entry = rows?.find((r) => r.gene_symbol === selected) ?? null;
  const counts = useMemo(() => {
    const c: Record<string, number> = { All: rows?.length ?? 0, [EXTENSIONS]: 0 };
    for (const r of rows ?? []) {
      if (r.partition === "uniprot_extended") c[EXTENSIONS] += 1;
      else c[r.display_category] = (c[r.display_category] ?? 0) + 1;
    }
    return c;
  }, [rows]);

  return (
    <div className="min-h-screen pb-20 pt-4">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h1 className="mb-2 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">Kinome Tree</h1>
        <p className="mb-5 text-sm text-slate-400">
          The tree shows the {counts.All || "…"} catalog entries: KinHub core entries by group and family, and the {counts[EXTENSIONS] || "…"} {EXTENSION_RING_LABEL} by class.
          The layout groups entries by classification; branch lengths carry no evolutionary distance.
        </p>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Highlight a gene symbol…" aria-label="Highlight a gene symbol"
            className="w-full rounded-xl border border-white/10 bg-slate-800/50 px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-kinome-cyan/40 sm:w-72" />
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)}
                className={`rounded-full border px-3 py-1 text-xs ${filter === f ? "border-kinome-cyan bg-kinome-cyan/20 text-white" : "border-white/10 text-slate-400 hover:border-white/30"}`}>
                {f} <span className="text-slate-500">{counts[f] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="min-w-0 flex-1">
            {error ? <p className="rounded-2xl border border-white/10 p-10 text-center text-rose-400">{error}</p>
              : !rows ? <div className="h-[600px] animate-shimmer rounded-2xl bg-white/5" />
              : <KinomePhyloTree rows={visible} onSelectKinase={setSelected} searchQuery={search} />}
          </div>
          {entry && (
            <aside className="glass-card h-fit flex-shrink-0 space-y-2 p-5 lg:w-72">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">{entry.gene_symbol}</h2>
                <button type="button" onClick={() => setSelected(null)} className="text-xs text-slate-500 hover:text-white" aria-label="Close">✕</button>
              </div>
              <p className="text-sm text-slate-400">{entry.name}</p>
              <GroupBadge group={entry.display_category} />
              <dl className="grid grid-cols-2 gap-y-1 pt-2 text-xs">
                <dt className="text-slate-500">Partition</dt><dd className="text-slate-300">{entry.partition === "kinhub_core" ? "KinHub core" : "UniProt extension"}</dd>
                <dt className="text-slate-500">Family</dt><dd className="text-slate-300">{entry.family || "unavailable"}</dd>
                <dt className="text-slate-500">PDIS (default)</dt><dd className="text-slate-300">{entry.pdis_default?.toFixed(2) ?? "unavailable"}</dd>
                <dt className="text-slate-500">UniProt</dt><dd className="text-slate-300">{entry.uniprot_id}</dd>
              </dl>
              <Link href={`/kinases/${encodeURIComponent(entry.gene_symbol)}`} className="block pt-2 text-sm text-kinome-cyan hover:underline">Open the dossier →</Link>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
