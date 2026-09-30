"use client";

import { Fragment, useEffect, useState } from "react";
import type { KinaseDetail } from "./types";

interface Reference {
  document_chembl_id: string | null;
  pubmed_id: string | null;
  doi: string | null;
  journal: string | null;
  year: number | null;
  source_url: string | null;
}

interface LigandRow {
  compound_key: string;
  source: "chembl" | "pubchem";
  compound_id: string | null;
  pubchem_cid: number | null;
  ligand_name: string;
  compound_url: string | null;
  inchikey: string | null;
  other_source_label: string | null;
  activity_type: string | null;
  relation: string;
  value_nm: number | null;
  censored: boolean;
  tier: number | null;
  assay_count: number;
  binding_mode: string;
  binding_mode_source: { label: string; url?: string } | null;
  reference: Reference;
}

interface LigandRecord {
  activity_id: number | null;
  activity_type: string | null;
  relation: string;
  relation_original: string | null;
  value_nm: number | null;
  assay_chembl_id: string | null;
  assay_aid: number | null;
  document_chembl_id: string | null;
  pubmed_id: string | null;
  doi: string | null;
  year: number | null;
  source_url: string | null;
}

interface LigandPage {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  activity_types: string[];
  rows: LigandRow[];
}

const nf = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 });

// Censored rows read as bounds ("> 10,000 nM") and never as point values.
export function formatMeasurement(relation: string, value: number | null): string {
  if (value === null) return "unavailable";
  const rel = relation === "=" ? "" : `${relation} `;
  return `${rel}${nf.format(value)} nM`;
}

function RefLinks({ r }: { r: Reference | LigandRecord }) {
  const links = [];
  if (r.pubmed_id) links.push(<a key="pm" href={`https://pubmed.ncbi.nlm.nih.gov/${r.pubmed_id}/`} target="_blank" rel="noopener noreferrer" className="text-kinome-cyan hover:underline">PMID {r.pubmed_id}</a>);
  if (r.doi) links.push(<a key="doi" href={`https://doi.org/${r.doi}`} target="_blank" rel="noopener noreferrer" className="text-kinome-violet hover:underline">DOI</a>);
  if (r.document_chembl_id) links.push(<a key="doc" href={`https://www.ebi.ac.uk/chembl/explore/document/${r.document_chembl_id}`} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:underline">{r.document_chembl_id}</a>);
  if (!links.length && r.source_url) links.push(<a key="src" href={r.source_url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:underline">Source record</a>);
  return links.length ? <span className="inline-flex flex-wrap gap-2">{links}</span> : <span className="text-slate-600">unavailable</span>;
}

function Records({ gene, row }: { gene: string; row: LigandRow }) {
  const [records, setRecords] = useState<LigandRecord[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`/api/kinases/${encodeURIComponent(gene)}/ligands/records?compound_key=${encodeURIComponent(row.compound_key)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Records unavailable"))))
      .then((body) => setRecords(body.records))
      .catch((e) => setError(e.message));
  }, [gene, row.compound_key]);
  if (error) return <p className="px-4 py-3 text-xs text-rose-400">{error}</p>;
  if (!records) return <p className="px-4 py-3 text-xs text-slate-500">Loading records…</p>;
  return (
    <table className="w-full text-xs">
      <thead><tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
        <th className="px-4 py-1.5">Activity</th><th className="px-4 py-1.5">Measurement</th><th className="px-4 py-1.5">Assay</th><th className="px-4 py-1.5">Reference</th>
      </tr></thead>
      <tbody className="divide-y divide-white/5">
        {records.map((r, i) => (
          <tr key={`${r.activity_id ?? i}`}>
            <td className="px-4 py-1.5 text-slate-300">{r.activity_type ?? "unavailable"}</td>
            <td className="px-4 py-1.5 font-mono text-slate-200">{formatMeasurement(r.relation, r.value_nm)}{r.relation_original === null ? <span className="ml-1 text-slate-500" title="The source record carries no relation qualifier">(unqualified)</span> : null}</td>
            <td className="px-4 py-1.5">{r.source_url ? <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="text-kinome-cyan hover:underline">{r.assay_chembl_id ?? `PubChem AID ${r.assay_aid}`} ↗</a> : "unavailable"}</td>
            <td className="px-4 py-1.5"><RefLinks r={r} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function LigandsTab({ kinase }: { kinase: KinaseDetail }) {
  const gene = kinase.gene_symbol;
  const [data, setData] = useState<LigandPage | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [activityType, setActivityType] = useState("");
  const [source, setSource] = useState("");
  const [uncensored, setUncensored] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => setPage(1), [search, activityType, source, uncensored]);
  useEffect(() => {
    const p = new URLSearchParams({ page: String(page) });
    if (search) p.set("search", search);
    if (activityType) p.set("activity_type", activityType);
    if (source) p.set("source", source);
    if (uncensored) p.set("uncensored", "1");
    const controller = new AbortController();
    fetch(`/api/kinases/${encodeURIComponent(gene)}/ligands?${p}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Ligand rows unavailable"))))
      .then((body) => { setData(body); setError(""); })
      .catch((e) => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [gene, page, search, activityType, source, uncensored]);

  const summary = kinase.ligand_summary;
  const candidates = kinase.development_candidates ?? [];
  const control = "rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-kinome-cyan/60";

  return (
    <div className="space-y-5">
      {candidates.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="border-b border-white/5 p-4">
            <h3 className="text-sm font-semibold text-white">Development candidates ({candidates.length})</h3>
            <p className="mt-1 text-xs text-slate-500">Trial-registry or primary-literature evidence; these rows are not quantitative binding measurements.</p>
          </div>
          <table className="w-full text-sm"><tbody className="divide-y divide-white/5">
            {candidates.map((c) => <tr key={c.name}><td className="px-4 py-2 font-medium text-slate-200">{c.name}</td><td className="px-4 py-2 text-slate-300">{c.mechanism}</td><td className="px-4 py-2 text-slate-400">{c.status}</td><td className="px-4 py-2"><a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-kinome-cyan hover:underline">{c.sourceLabel} ↗</a></td></tr>)}
          </tbody></table>
        </div>
      )}

      <div className="glass-card overflow-hidden">
        <div className="border-b border-white/5 p-4">
          <h3 className="text-sm font-semibold text-white">
            Compound–kinase pairs {summary ? `(${summary.representative_rows.toLocaleString("en-US")} compounds, ${summary.records.toLocaleString("en-US")} records)` : ""}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Each row shows one representative measurement per source compound: an uncensored Kd or Ki first, then an uncensored IC50 or EC50,
            then any other uncensored activity type, and a censored bound only when nothing else exists. Within a tier the lowest value wins.
            Expand a row to see every underlying record with its source link.
          </p>
        </div>
        <div className="grid gap-3 border-b border-white/5 bg-white/[0.015] p-4 sm:grid-cols-2 lg:grid-cols-5">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, ChEMBL ID, CID, InChIKey…" className={`${control} lg:col-span-2`} aria-label="Search compounds" />
          <select value={activityType} onChange={(e) => setActivityType(e.target.value)} className={control} aria-label="Activity type">
            <option value="">All activity types</option>
            {(data?.activity_types ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)} className={control} aria-label="Source">
            <option value="">ChEMBL and PubChem</option><option value="chembl">ChEMBL</option><option value="pubchem">PubChem</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={uncensored} onChange={(e) => setUncensored(e.target.checked)} className="accent-cyan-400" /> Uncensored only
          </label>
        </div>

        {error ? <p className="p-6 text-sm text-rose-400">{error}</p> : !data ? <p className="p-6 text-sm text-slate-500">Loading compounds…</p> : data.total === 0 ? (
          <p className="p-6 text-sm text-slate-500">{summary && summary.representative_rows === 0 ? "KinomeX holds no ChEMBL or PubChem record for this entry." : "No compounds match the selected filters."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead><tr className="border-b border-white/5 text-left text-[11px] uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Compound</th><th className="px-4 py-3">Activity</th><th className="px-4 py-3">Measurement</th>
                <th className="px-4 py-3">Records</th><th className="px-4 py-3">Binding mode</th><th className="px-4 py-3">Reference</th>
              </tr></thead>
              <tbody className="divide-y divide-white/5">
                {data.rows.map((row) => (
                  <Fragment key={row.compound_key}>
                    <tr className="hover:bg-white/[0.02]">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-200">{row.ligand_name}</div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {row.compound_url ? <a href={row.compound_url} target="_blank" rel="noopener noreferrer" className="text-kinome-cyan hover:underline">{row.compound_id ?? `PubChem CID ${row.pubchem_cid}`} ↗</a> : <span className="text-slate-500">{row.compound_key}</span>}
                          {row.other_source_label && <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300" title={`InChIKey ${row.inchikey}`}>{row.other_source_label}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-300">{row.activity_type ?? "unavailable"}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-200">
                        {formatMeasurement(row.relation, row.value_nm)}
                        {row.censored && <span className="ml-1.5 rounded bg-slate-500/20 px-1.5 py-0.5 font-sans text-[10px] text-slate-400">bound</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        <button type="button" onClick={() => setOpen(open === row.compound_key ? null : row.compound_key)} aria-expanded={open === row.compound_key} className="text-kinome-cyan hover:underline">
                          {row.assay_count} {open === row.compound_key ? "▲" : "▼"}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {row.binding_mode_source?.url
                          ? <a href={row.binding_mode_source.url} target="_blank" rel="noopener noreferrer" className="text-slate-200 hover:underline" title={row.binding_mode_source.label}>{row.binding_mode} ↗</a>
                          : <span className={row.binding_mode === "Not annotated" ? "text-slate-500" : "text-slate-200"}>{row.binding_mode}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs"><RefLinks r={row.reference} /></td>
                    </tr>
                    {open === row.compound_key && <tr><td colSpan={6} className="bg-slate-950/40"><Records gene={gene} row={row} /></td></tr>}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.total_pages > 1 && (
          <div className="flex items-center justify-between border-t border-white/5 px-4 py-3 text-xs text-slate-400">
            <span>Showing {(data.page - 1) * data.page_size + 1}–{Math.min(data.page * data.page_size, data.total)} of {data.total.toLocaleString("en-US")}</span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-md border border-white/10 px-3 py-1 disabled:opacity-30">Previous</button>
              <span className="self-center">Page {data.page} of {data.total_pages}</span>
              <button type="button" disabled={page >= data.total_pages} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-white/10 px-3 py-1 disabled:opacity-30">Next</button>
            </div>
          </div>
        )}
        <div className="border-t border-white/5 px-4 py-3 text-xs leading-relaxed text-slate-500">
          Sources: <a href="https://www.ebi.ac.uk/chembl/" target="_blank" rel="noopener noreferrer" className="text-kinome-cyan hover:underline">ChEMBL</a> (CC BY-SA 3.0) and{" "}
          <a href="https://pubchem.ncbi.nlm.nih.gov/bioassay/1433" target="_blank" rel="noopener noreferrer" className="text-kinome-cyan hover:underline">PubChem AID 1433</a>.
          A binding mode appears only when a ChEMBL mechanism record supplies it; other rows read &quot;Not annotated.&quot;
          The badge marks a compound whose standard InChIKey occurs in both sources for this kinase.
        </div>
      </div>
    </div>
  );
}
