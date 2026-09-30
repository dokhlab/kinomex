"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { PLDDT_BANDS } from "@/components/kinase/NGLViewer";
import type { KinaseDetail, StructureEntry, StructurePage } from "./types";

const NGLViewer = dynamic(() => import("@/components/kinase/NGLViewer"), { ssr: false });

function methodLabel(method: string | null): string {
  if (!method) return "Method unavailable";
  return method.charAt(0) + method.slice(1).toLowerCase();
}

function StructureRow({ s, selected, onSelect }: { s: StructureEntry; selected: boolean; onSelect: () => void }) {
  return (
    <tr className={selected ? "bg-kinome-cyan/10" : "hover:bg-white/[0.02]"}>
      <td className="px-3 py-2">
        <button type="button" onClick={onSelect} className="font-mono font-medium text-kinome-cyan hover:underline" aria-label={`Show ${s.pdb_id} in the viewer`}>
          {s.pdb_id}
        </button>
      </td>
      <td className="px-3 py-2 text-xs text-slate-300">{methodLabel(s.experimental_method)}</td>
      <td className="px-3 py-2 text-xs tabular-nums text-slate-300">{s.resolution === null ? "unavailable" : `${s.resolution.toFixed(2)} Å`}</td>
      <td className="px-3 py-2 text-xs">
        {s.emdb.length ? s.emdb.map((e) => (
          <a key={e.id} href={e.url} target="_blank" rel="noopener noreferrer" className="mr-2 text-kinome-violet hover:underline">{e.id} ↗</a>
        )) : <span className="text-slate-600">–</span>}
      </td>
      <td className="max-w-[18rem] px-3 py-2 text-xs text-slate-400">
        {s.bound_ligands.length
          ? s.bound_ligands.map((l) => <span key={l.comp_id} title={l.name} className="mr-1.5 inline-block rounded bg-white/5 px-1.5 py-0.5 font-mono">{l.comp_id}</span>)
          : <span className="text-slate-600">none</span>}
      </td>
      <td className="max-w-[20rem] truncate px-3 py-2 text-xs text-slate-500" title={s.title}>
        <a href={s.rcsb_url} target="_blank" rel="noopener noreferrer" className="hover:text-slate-300">{s.title || "RCSB PDB entry"} ↗</a>
      </td>
    </tr>
  );
}

function StructureTable({ entries, selected, onSelect }: { entries: StructureEntry[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-b border-white/5 text-left text-[11px] uppercase tracking-wider text-slate-400">
            <th className="px-3 py-2">PDB</th><th className="px-3 py-2">Method</th><th className="px-3 py-2">Resolution</th>
            <th className="px-3 py-2">EMDB</th><th className="px-3 py-2">Bound ligands</th><th className="px-3 py-2">Title</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {entries.map((s) => <StructureRow key={s.pdb_id} s={s} selected={selected === s.pdb_id} onSelect={() => onSelect(s.pdb_id)} />)}
        </tbody>
      </table>
    </div>
  );
}

function AlphaFoldPanel({ kinase }: { kinase: KinaseDetail }) {
  const af = kinase.alphafold;
  const [show, setShow] = useState(false);
  return (
    <section className="glass-card p-5" aria-labelledby="afdb-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="afdb-heading" className="text-base font-semibold text-white">AlphaFold DB model</h3>
        <a href={af.entry_url} target="_blank" rel="noopener noreferrer" className="text-xs text-kinome-violet hover:underline">View on AlphaFold DB ↗</a>
      </div>
      {!af.available ? (
        <p className="mt-3 text-sm text-slate-400">{af.message ?? "No AlphaFold DB model available."}</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-amber-300/90">{af.note}</p>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
            <span>Model <span className="font-mono text-slate-200">{af.entry_id}</span> (v{af.model_version ?? "?"})</span>
            <span>Global pLDDT <span className="font-semibold text-slate-200">{af.global_plddt?.toFixed(1) ?? "unavailable"}</span></span>
            <span>Residues {af.uniprot_start ?? "?"}–{af.uniprot_end ?? "?"}</span>
          </div>
          {show ? (
            <>
              <div className="mt-3 h-[320px] overflow-hidden rounded-xl border border-white/5">
                <NGLViewer modelUrl={af.cif_url} colorByPlddt />
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-400">
                {PLDDT_BANDS.map((b) => (
                  <span key={b.label} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} />{b.label}</span>
                ))}
              </div>
            </>
          ) : (
            <button type="button" onClick={() => setShow(true)} className="mt-3 rounded-lg border border-kinome-violet/30 px-3 py-1.5 text-xs text-kinome-violet hover:bg-kinome-violet/10">
              Load the model colored by pLDDT
            </button>
          )}
        </>
      )}
    </section>
  );
}

export default function StructureTab({ kinase }: { kinase: KinaseDetail }) {
  const [page, setPage] = useState<StructurePage>(kinase.structures);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(kinase.structures.entries[0]?.pdb_id ?? null);
  const [showOther, setShowOther] = useState(false);

  useEffect(() => {
    setPage(kinase.structures);
    setSelected(kinase.structures.entries[0]?.pdb_id ?? null);
  }, [kinase.structures]);

  const goTo = (n: number) => {
    setLoading(true);
    fetch(`/api/kinases/${encodeURIComponent(kinase.gene_symbol)}/structures?page=${n}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Structures unavailable"))))
      .then(setPage)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  const methods = Object.entries(page.by_method).map(([m, n]) => `${n} ${methodLabel(m).toLowerCase()}`).join(", ");
  const inputCount = kinase.pdis_structure_input_count;

  return (
    <div className="space-y-6">
      <section className="glass-card overflow-hidden" aria-labelledby="exp-structures-heading">
        <div className="border-b border-white/5 p-5">
          <h3 id="exp-structures-heading" className="text-base font-semibold text-white">
            {page.total} experimental structure{page.total === 1 ? "" : "s"}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            RCSB PDB entries mapped to UniProt {kinase.uniprot_id} at ≤3.5 Å{methods ? ` (${methods})` : ""}. These entries enter the PDIS structure component.
            {inputCount !== null && inputCount !== page.total && ` The PDIS structure input counts ${inputCount} entries because the August 12, 2026 import also matched entries by gene name.`}
          </p>
        </div>
        {page.total === 0 ? (
          <p className="p-5 text-sm text-slate-400">KinomeX holds no experimental structure at ≤3.5 Å for this entry.</p>
        ) : (
          <>
            {selected && (
              <div className="border-b border-white/5 p-4">
                <div className="h-[320px] overflow-hidden rounded-xl border border-white/5">
                  <NGLViewer key={selected} pdbId={selected} domains={kinase.domains ?? []} />
                </div>
                <p className="mt-2 text-xs text-slate-600">Viewer: RCSB PDB {selected}</p>
              </div>
            )}
            <div className={loading ? "opacity-50" : ""}>
              <StructureTable entries={page.entries} selected={selected} onSelect={setSelected} />
            </div>
            {page.total_pages > 1 && (
              <div className="flex items-center justify-between border-t border-white/5 px-4 py-3 text-xs text-slate-400">
                <span>Showing {(page.page - 1) * page.page_size + 1}–{Math.min(page.page * page.page_size, page.total)} of {page.total}</span>
                <div className="flex gap-2">
                  <button type="button" disabled={page.page <= 1 || loading} onClick={() => goTo(page.page - 1)} className="rounded-md border border-white/10 px-3 py-1 disabled:opacity-30">Previous</button>
                  <span className="self-center">Page {page.page} of {page.total_pages}</span>
                  <button type="button" disabled={page.page >= page.total_pages || loading} onClick={() => goTo(page.page + 1)} className="rounded-md border border-white/10 px-3 py-1 disabled:opacity-30">Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {kinase.other_structures.length > 0 && (
        <section className="glass-card overflow-hidden">
          <button type="button" onClick={() => setShowOther((v) => !v)} aria-expanded={showOther}
            className="flex w-full items-center justify-between p-5 text-left">
            <span>
              <span className="text-base font-semibold text-white">Other experimental entries (not scored)</span>
              <span className="mt-1 block text-xs text-slate-500">
                {kinase.other_structures.length} cryo-EM entries above 3.5 Å or NMR entries. They do not enter the PDIS structure component or the structure count.
              </span>
            </span>
            <span className="text-xs text-slate-400">{showOther ? "Hide ▲" : "Show ▼"}</span>
          </button>
          {showOther && <StructureTable entries={kinase.other_structures} selected={null} onSelect={() => undefined} />}
        </section>
      )}

      <AlphaFoldPanel kinase={kinase} />
    </div>
  );
}
