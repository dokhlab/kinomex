"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import WeightsPanel from "@/components/explorer/WeightsPanel";
import FiltersPanel from "@/components/explorer/FiltersPanel";
import ResultsTable from "@/components/explorer/ResultsTable";
import PDISHistogram from "@/components/visualizations/PDISHistogram";
import { queryCatalog, type CatalogFilters, type CatalogSort } from "@/lib/catalog/query";
import { paramsFromState, stateFromParams, type ExplorerState } from "@/lib/catalog/url";
import { catalogCsv } from "@/lib/catalog/csv";
import { EXTENSION_CLASSES, KINHUB_GROUPS, PARTITION_LABELS, type CatalogRow } from "@/lib/catalog/types";
import { EXTENSION_SHORT_LABELS } from "@/components/ui/GroupBadge";
import { PDIS_NOTE, type PdisWeights } from "@/lib/pdis";

const PAGE_SIZE = 50;

export default function ExplorerClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<CatalogRow[] | null>(null);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [state, setState] = useState<ExplorerState>(() => stateFromParams(new URLSearchParams(searchParams.toString())));
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetch("/api/catalog/table")
      .then(async (res) => {
        if (!res.ok) throw new Error("Catalog table unavailable");
        const body = await res.json();
        setRows(body.rows);
        setSnapshot(body.snapshot_date ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Catalog table unavailable"));
  }, []);

  // Browser navigation (back/forward, "Try it" links) restores the state.
  useEffect(() => {
    const next = stateFromParams(new URLSearchParams(searchParams.toString()));
    if (paramsFromState(next).toString() !== paramsFromState(state).toString()) setState(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const commit = useCallback((next: ExplorerState) => {
    setState(next);
    setPage(1);
    const query = paramsFromState(next).toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router]);

  const setFilters = (filters: CatalogFilters) => commit({ ...state, filters });
  const setWeights = (weights: PdisWeights) => commit({ ...state, weights });
  const setSort = (sort: CatalogSort) => commit({ ...state, sort });

  const result = useMemo(
    () => (rows ? queryCatalog(rows, state.filters, state.weights, state.sort) : null),
    [rows, state],
  );
  const organs = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => r.expression?.top_organ).filter(Boolean) as string[])).sort(),
    [rows],
  );

  const exportCsv = () => {
    if (!result) return;
    const blob = new Blob([catalogCsv(result.rows, state.weights)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kinomex-explorer-${snapshot ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pageCount = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  const visible = result ? result.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : [];
  const categoryOrder = [...KINHUB_GROUPS, ...EXTENSION_CLASSES] as readonly string[];

  return (
    <div className="min-h-screen pb-20 pt-4">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="mb-6">
          <h1 className="mb-2 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">Kinase Explorer</h1>
          <p className="text-sm text-slate-400">
            The Explorer lists the reconciled catalog: KinHub core entries plus reviewed UniProt extensions.
            Scores, ranks, the histogram, and the PDIS interval follow the weights below.
          </p>
        </header>

        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="min-w-0 flex-1 space-y-5">
            <FiltersPanel filters={state.filters} organs={organs} onChange={setFilters} />
            <WeightsPanel weights={state.weights} onChange={setWeights} />
            <PDISHistogram
              title="Weighted PDIS distribution (evidence-filtered entries)"
              buckets={result?.histogram ?? []}
              minPDIS={state.filters.pdisMin ?? 0}
              maxPDIS={state.filters.pdisMax ?? 100}
              onChange={(min, max) => setFilters({ ...state.filters, pdisMin: min, pdisMax: max })}
              loading={!rows && !error}
            />
            <p className="text-xs text-slate-500">{PDIS_NOTE}</p>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-slate-400">
                {error ? error : !result ? "Loading catalog…" : `${result.total} catalog entr${result.total === 1 ? "y" : "ies"} match`}
              </span>
              <button type="button" onClick={exportCsv} disabled={!result || result.total === 0}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200 hover:border-kinome-cyan/50 disabled:opacity-40">
                Export CSV
              </button>
            </div>

            {result && result.total > 0 && <ResultsTable rows={visible} weights={state.weights} sort={state.sort} onSort={setSort} />}
            {result && result.total === 0 && (
              <div className="rounded-2xl border border-white/10 py-16 text-center text-sm text-slate-500">No catalog entries match the current filters.</div>
            )}

            {result && pageCount > 1 && (
              <div className="flex items-center justify-center gap-3 text-sm text-slate-400">
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-white/10 px-3 py-1.5 disabled:opacity-30">Previous</button>
                <span className="tabular-nums">Page {page} of {pageCount}</span>
                <button type="button" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-white/10 px-3 py-1.5 disabled:opacity-30">Next</button>
              </div>
            )}
          </div>

          <aside className="flex-shrink-0 lg:w-56">
            <div className="sticky top-24 rounded-2xl border border-white/10 bg-slate-900/40 p-5 backdrop-blur-sm">
              <h2 className="mb-4 text-sm font-semibold text-white">Filtered result</h2>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Catalog entries</span>
                <span className="text-sm font-bold tabular-nums text-kinome-cyan">{result?.total ?? "–"}</span>
              </div>
              {result && (
                <>
                  <div className="mt-3 space-y-1 border-t border-white/5 pt-3">
                    {(["kinhub_core", "uniprot_extended"] as const).map((p) => (
                      <div key={p} className="flex justify-between text-xs">
                        <span className="text-slate-400">{PARTITION_LABELS[p]}</span>
                        <span className="tabular-nums text-slate-300">{result.partitionBreakdown[p] ?? 0}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 space-y-1.5 border-t border-white/5 pt-3">
                    <span className="mb-1 block text-xs text-slate-500">By category</span>
                    {categoryOrder.filter((c) => result.categoryBreakdown[c]).map((c) => (
                      <div key={c} className="flex justify-between gap-2 text-xs">
                        <span className="truncate text-slate-400" title={c}>{EXTENSION_SHORT_LABELS[c] ?? c}</span>
                        <span className="tabular-nums text-slate-300">{result.categoryBreakdown[c]}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[10px] leading-relaxed text-slate-600">Counts cover the complete filtered result, not only this page.</p>
                </>
              )}
              {snapshot && <p className="mt-3 border-t border-white/5 pt-3 text-[10px] text-slate-600">Snapshot {snapshot}</p>}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
