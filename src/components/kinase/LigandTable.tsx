"use client";

import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";

interface LigandReference {
  pubmed_id: string;
  doi?: string;
  title?: string;
  year?: number;
}

interface LigandAssay {
  ligand_name: string;
  chembl_id?: string;
  binding_type: string;
  assay_type: string;
  value_nm: number;
  relation: string;
  target_conformation?: string;
  source?: string;
  source_url?: string;
  assay_count?: number;
  pubchem_cid?: string | number;
  reference: LigandReference;
}

interface LigandTableProps {
  ligands: LigandAssay[];
  candidates?: Array<{ name: string; mechanism: string; status: string; sourceLabel: string; sourceUrl: string }>;
}

type SortField = "ligand_name" | "value_nm";
type SortDir = "asc" | "desc";
const PAGE_SIZE = 100;
const DEFAULT_WIDTHS = [260, 150, 180, 130, 150, 150];

const bindingTypeColors: Record<string, string> = {
  IC50: "bg-kinome-cyan/15 text-kinome-cyan border border-kinome-cyan/20",
  Ki: "bg-kinome-violet/15 text-kinome-violet border border-kinome-violet/20",
  Kd: "bg-kinome-emerald/15 text-kinome-emerald border border-kinome-emerald/20",
  EC50: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
};

function formatValue(nm: number | undefined | null): string {
  if (nm == null || isNaN(nm)) return "—";
  if (nm >= 1_000_000) return `${(nm / 1_000_000).toFixed(1)}M`;
  if (nm >= 1_000) return `${(nm / 1_000).toFixed(1)}k`;
  if (nm >= 1) return nm.toFixed(1);
  if (nm >= 0.001) return `${(nm * 1000).toFixed(1)}pM`;
  return nm.toExponential(1);
}

function SortButton({
  field,
  currentField,
  currentDir,
  onSort,
}: {
  field: SortField;
  currentField: SortField;
  currentDir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const active = currentField === field;
  return (
    <button
      onClick={() => onSort(field)}
      className="inline-flex items-center gap-1 group"
    >
      <span className={active ? "text-white" : "text-slate-400 group-hover:text-slate-200"}>
        {field === "ligand_name" ? "Ligand Name" : "Value (nM)"}
      </span>
      <svg
        className={`w-3 h-3 transition-colors ${active ? "text-kinome-cyan" : "text-slate-600"}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d={active && currentDir === "desc" ? "M19 9l-7 7-7-7" : "M5 15l7-7 7 7"}
        />
      </svg>
    </button>
  );
}

export default function LigandTable({ ligands, candidates = [] }: LigandTableProps) {
  const [sortField, setSortField] = useState<SortField>("value_nm");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [query, setQuery] = useState("");
  const [minValue, setMinValue] = useState("");
  const [maxValue, setMaxValue] = useState("");
  const [bindingType, setBindingType] = useState("all");
  const [assayType, setAssayType] = useState("all");
  const [page, setPage] = useState(1);
  const [columnWidths, setColumnWidths] = useState(DEFAULT_WIDTHS);

  const bindingTypes = useMemo(() => Array.from(new Set(ligands.map((l) => l.binding_type).filter(Boolean))).sort(), [ligands]);
  const assayTypes = useMemo(() => Array.from(new Set(ligands.map((l) => l.assay_type).filter(Boolean))).sort(), [ligands]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const min = minValue === "" ? null : Number(minValue);
    const max = maxValue === "" ? null : Number(maxValue);
    return ligands.filter((ligand) => {
      const searchable = `${ligand.ligand_name} ${ligand.chembl_id ?? ""} ${ligand.pubchem_cid ?? ""}`.toLowerCase();
      if (needle && !searchable.includes(needle)) return false;
      if (bindingType !== "all" && ligand.binding_type !== bindingType) return false;
      if (assayType !== "all" && ligand.assay_type !== assayType) return false;
      if (min !== null && Number.isFinite(min) && (!Number.isFinite(ligand.value_nm) || ligand.value_nm < min)) return false;
      if (max !== null && Number.isFinite(max) && (!Number.isFinite(ligand.value_nm) || ligand.value_nm > max)) return false;
      return true;
    });
  }, [ligands, query, minValue, maxValue, bindingType, assayType]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === "ligand_name") {
        cmp = a.ligand_name.localeCompare(b.ligand_name);
      } else {
        cmp = a.value_nm - b.value_nm;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const visible = useMemo(() => sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [sorted, page]);
  useEffect(() => setPage(1), [query, minValue, maxValue, bindingType, assayType, ligands]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  const beginResize = (index: number, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = columnWidths[index];
    const move = (e: PointerEvent) => setColumnWidths((widths) => widths.map((width, i) => i === index ? Math.max(90, startWidth + e.clientX - startX) : width));
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const resetFilters = () => { setQuery(""); setMinValue(""); setMaxValue(""); setBindingType("all"); setAssayType("all"); };

  if (ligands.length === 0 && candidates.length === 0) {
    return (
      <div className="glass-card p-8 text-center text-slate-500 text-sm">
        No ligand/binding assay data available for this kinase.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {candidates.length > 0 && <div className="glass-card overflow-hidden">
        <div className="border-b border-white/5 p-4"><h3 className="text-sm font-semibold text-white">Development candidates <span className="ml-2 font-normal text-slate-500">({candidates.length})</span></h3><p className="mt-1 text-xs text-slate-500">Target and development evidence from trial registries or primary literature; these rows are not quantitative binding assays.</p></div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-white/5 text-left text-xs uppercase tracking-wider text-slate-400"><th className="px-4 py-3">Candidate</th><th className="px-4 py-3">Mechanism</th><th className="px-4 py-3">Current evidence</th><th className="px-4 py-3">Source</th></tr></thead><tbody className="divide-y divide-white/5">{candidates.map(candidate=><tr key={candidate.name}><td className="whitespace-nowrap px-4 py-3 font-medium text-slate-200">{candidate.name}</td><td className="px-4 py-3 text-slate-300">{candidate.mechanism}</td><td className="px-4 py-3 text-slate-400">{candidate.status}</td><td className="px-4 py-3"><a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap text-kinome-cyan hover:underline">{candidate.sourceLabel} ↗</a></td></tr>)}</tbody></table></div>
      </div>}
      {ligands.length > 0 && <div className="glass-card overflow-hidden">
      <div className="p-4 border-b border-white/5 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">
          Binding Assays
          <span className="ml-2 text-slate-500 font-normal">({filtered.length} of {ligands.length})</span>
        </h3>
        <button type="button" onClick={() => setColumnWidths(DEFAULT_WIDTHS)} className="text-xs text-slate-500 hover:text-kinome-cyan">Reset column widths</button>
      </div>
      <div className="grid gap-3 border-b border-white/5 bg-white/[0.015] p-4 sm:grid-cols-2 xl:grid-cols-6">
        <label className="xl:col-span-2"><span className="sr-only">Search ligands</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, ChEMBL ID, or PubChem CID…" className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-kinome-cyan/60" /></label>
        <label><span className="sr-only">Minimum binding value in nM</span><input type="number" min="0" value={minValue} onChange={(e) => setMinValue(e.target.value)} placeholder="Min value (nM)" className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-kinome-cyan/60" /></label>
        <label><span className="sr-only">Maximum binding value in nM</span><input type="number" min="0" value={maxValue} onChange={(e) => setMaxValue(e.target.value)} placeholder="Max value (nM)" className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-kinome-cyan/60" /></label>
        <label><span className="sr-only">Binding type</span><select value={bindingType} onChange={(e) => setBindingType(e.target.value)} className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-kinome-cyan/60"><option value="all">All binding types</option>{bindingTypes.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label><span className="sr-only">Assay</span><select value={assayType} onChange={(e) => setAssayType(e.target.value)} className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-kinome-cyan/60"><option value="all">All assays</option>{assayTypes.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        {(query || minValue || maxValue || bindingType !== "all" || assayType !== "all") && <button type="button" onClick={resetFilters} className="text-left text-xs text-kinome-cyan hover:underline">Clear filters</button>}
      </div>
      <div className="overflow-x-auto">
        <table className="table-fixed text-sm" style={{ width: columnWidths.reduce((sum, width) => sum + width, 0) }}>
          <colgroup>{columnWidths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
          <thead>
            <tr className="border-b border-white/5">
              {[
                <SortButton key="ligand" field="ligand_name" currentField={sortField} currentDir={sortDir} onSort={handleSort} />,
                "Binding Type", "Assay",
                <SortButton key="value" field="value_nm" currentField={sortField} currentDir={sortDir} onSort={handleSort} />,
                "Conformation", "Reference",
              ].map((label, index) => <th key={index} className="relative px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                {label}<button type="button" aria-label={`Resize column ${index + 1}`} onPointerDown={(event) => beginResize(index, event)} className="absolute right-0 top-1/4 h-1/2 w-2 cursor-col-resize border-r border-white/15 hover:border-kinome-cyan" />
              </th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {visible.map((ligand, idx) => (
              <motion.tr
                key={`${ligand.ligand_name}-${ligand.binding_type}-${idx}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15, delay: Math.min(idx * 0.02, 0.4) }}
                className={idx % 2 === 0 ? "bg-white/[0.02]" : ""}
              >
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                    <span className="text-slate-200 font-medium">{ligand.ligand_name}</span>
                    {ligand.source_url ? <a href={ligand.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-kinome-cyan hover:underline">{ligand.chembl_id || `PubChem CID ${ligand.pubchem_cid}`} ↗</a> : ligand.chembl_id ? <span className="text-xs text-slate-500">{ligand.chembl_id}</span> : null}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      bindingTypeColors[ligand.binding_type] ?? "bg-slate-500/15 text-slate-400 border border-slate-500/20"
                    }`}
                  >
                    {ligand.binding_type}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">
                  {ligand.assay_type}{(ligand.assay_count ?? 1) > 1 ? ` · ${ligand.assay_count} records` : ""}
                </td>
                <td className="px-4 py-3">
                  <span className="text-slate-200 font-mono tabular-nums text-xs">
                    {ligand.relation !== "=" ? ligand.relation : ""}
                    {formatValue(ligand.value_nm)}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">
                  {ligand.target_conformation ?? "—"}
                </td>
                <td className="px-4 py-3">
                  {ligand.reference?.pubmed_id ? (
                    <a
                      href={`https://pubmed.ncbi.nlm.nih.gov/${ligand.reference.pubmed_id}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-kinome-cyan hover:text-kinome-cyan/80 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      {ligand.reference.year ?? "PubMed"}
                    </a>
                  ) : ligand.source_url ? (
                    <a href={ligand.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-kinome-cyan hover:underline">Source record ↗</a>
                  ) : <span className="text-slate-600 text-xs">—</span>}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && <div className="border-t border-white/5 px-4 py-10 text-center text-sm text-slate-500">No binding assays match the selected filters.</div>}
      {pageCount > 1 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 px-4 py-3 text-xs text-slate-400"><span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} of {sorted.length}</span><div className="flex items-center gap-2"><button type="button" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-md border border-white/10 px-3 py-1.5 disabled:opacity-30 hover:border-kinome-cyan/50">Previous</button><span>Page {page} of {pageCount}</span><button type="button" disabled={page === pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} className="rounded-md border border-white/10 px-3 py-1.5 disabled:opacity-30 hover:border-kinome-cyan/50">Next</button></div></div>}
      <div className="border-t border-white/5 px-4 py-3 text-xs leading-relaxed text-slate-500">
        Sources: <a href="https://www.ebi.ac.uk/chembl/" target="_blank" rel="noopener noreferrer" className="text-kinome-cyan hover:underline">ChEMBL</a> (CC BY-SA 3.0) and <a href="https://pubchem.ncbi.nlm.nih.gov/" target="_blank" rel="noopener noreferrer" className="text-kinome-cyan hover:underline">PubChem</a> (record-specific contributor terms). Preserve source identifiers and attribution when reusing records.
      </div>
      </div>}
    </div>
  );
}
