"use client";

import { useMemo, useState } from "react";
import type { ClinvarVariant, CuratedMutation, KinaseDetail } from "./types";

const PAGE = 100;

function Stars({ n }: { n: number | null }) {
  if (n === null) return <span className="text-slate-600">unavailable</span>;
  return <span title={`${n} of 4 review stars`} className="tracking-tight text-amber-300">{"★".repeat(n)}<span className="text-slate-700">{"★".repeat(4 - n)}</span></span>;
}

function classColor(c: string | null): string {
  const t = (c ?? "").toLowerCase();
  if (t.startsWith("pathogenic") || t.startsWith("likely pathogenic")) return "text-rose-300";
  if (t.startsWith("benign") || t.startsWith("likely benign")) return "text-emerald-300";
  if (t.startsWith("conflicting")) return "text-orange-300";
  return "text-slate-300";
}

function ClinvarSection({ variants }: { variants: ClinvarVariant[] }) {
  const [classification, setClassification] = useState("");
  const [minStars, setMinStars] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const classes = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const v of variants) counts[v.classification ?? "unavailable"] = (counts[v.classification ?? "unavailable"] ?? 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [variants]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return variants
      .filter((v) => !classification || (v.classification ?? "unavailable") === classification)
      .filter((v) => (v.review_stars ?? 0) >= minStars)
      .filter((v) => !q || `${v.mutation_code} ${v.hgvs ?? ""} ${v.clinvar_accession ?? ""} ${v.conditions.join(" ")}`.toLowerCase().includes(q))
      .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.mutation_code.localeCompare(b.mutation_code));
  }, [variants, classification, minStars, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const visible = filtered.slice((page - 1) * PAGE, page * PAGE);
  const control = "rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-200";

  return (
    <section className="glass-card overflow-hidden" aria-labelledby="clinvar-heading">
      <div className="border-b border-white/5 p-4">
        <h3 id="clinvar-heading" className="text-sm font-semibold text-white">ClinVar missense records ({variants.length.toLocaleString("en-US")})</h3>
        <p className="mt-1 text-xs text-slate-500">Germline classification and review status come from ClinVar; each row links to its ClinVar variation record.</p>
      </div>
      {variants.length === 0 ? <p className="p-5 text-sm text-slate-500">KinomeX holds no ClinVar missense record for this entry.</p> : (
        <>
          <div className="grid gap-3 border-b border-white/5 bg-white/[0.015] p-4 sm:grid-cols-3">
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search variant, VCV, or condition…" className={control} aria-label="Search ClinVar records" />
            <select value={classification} onChange={(e) => { setClassification(e.target.value); setPage(1); }} className={control} aria-label="Classification">
              <option value="">All classifications</option>
              {classes.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}
            </select>
            <select value={minStars} onChange={(e) => { setMinStars(Number(e.target.value)); setPage(1); }} className={control} aria-label="Minimum review stars">
              {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n === 0 ? "Any review status" : `≥ ${n} star${n > 1 ? "s" : ""}`}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead><tr className="border-b border-white/5 text-left text-[11px] uppercase tracking-wider text-slate-400">
                <th className="px-4 py-2.5">Variant</th><th className="px-4 py-2.5">Classification</th><th className="px-4 py-2.5">Review status</th><th className="px-4 py-2.5">Conditions</th><th className="px-4 py-2.5">ClinVar</th>
              </tr></thead>
              <tbody className="divide-y divide-white/5">
                {visible.map((v, i) => (
                  <tr key={`${v.clinvar_uid}-${i}`}>
                    <td className="px-4 py-2"><div className="font-mono text-slate-200">{v.mutation_code}</div><div className="max-w-[16rem] truncate text-[11px] text-slate-500" title={v.hgvs ?? ""}>{v.hgvs}</div></td>
                    <td className={`px-4 py-2 text-xs ${classColor(v.classification)}`}>{v.classification ?? "unavailable"}</td>
                    <td className="px-4 py-2 text-xs"><Stars n={v.review_stars} /><div className="text-[11px] text-slate-500">{v.review_status ?? ""}</div></td>
                    <td className="max-w-[18rem] px-4 py-2 text-xs text-slate-400">{v.conditions.length ? v.conditions.slice(0, 3).join("; ") + (v.conditions.length > 3 ? ` (+${v.conditions.length - 3})` : "") : "unavailable"}</td>
                    <td className="px-4 py-2 text-xs">{v.url ? <a href={v.url} target="_blank" rel="noopener noreferrer" className="text-kinome-cyan hover:underline">{v.clinvar_accession ?? `Variation ${v.clinvar_uid}`} ↗</a> : "unavailable"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 px-4 py-3 text-xs text-slate-400">
            <span>{filtered.length.toLocaleString("en-US")} matching records</span>
            {pages > 1 && <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-md border border-white/10 px-3 py-1 disabled:opacity-30">Previous</button>
              <span className="self-center">Page {page} of {pages}</span>
              <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-white/10 px-3 py-1 disabled:opacity-30">Next</button>
            </div>}
          </div>
        </>
      )}
    </section>
  );
}

function CuratedSection({ mutations, gatekeeper }: { mutations: CuratedMutation[]; gatekeeper: KinaseDetail["gatekeeper"] }) {
  if (mutations.length === 0) return null;
  return (
    <section className="glass-card overflow-hidden" aria-labelledby="curated-heading">
      <div className="border-b border-white/5 p-4">
        <h3 id="curated-heading" className="text-sm font-semibold text-white">Literature-curated resistance and activating mutations ({mutations.length})</h3>
        <p className="mt-1 text-xs text-slate-500">
          {gatekeeper ? `Gatekeeper residue: ${gatekeeper.residue}${gatekeeper.position} (KLIFS pocket residue 45 mapped to the UniProt canonical sequence). ` : "Gatekeeper residue: unavailable (no KLIFS pocket mapping). "}
          The gatekeeper flag marks only mutations at that residue. A drug appears only when the cited publication names it.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead><tr className="border-b border-white/5 text-left text-[11px] uppercase tracking-wider text-slate-400">
            <th className="px-4 py-2.5">Mutation</th><th className="px-4 py-2.5">Effect</th><th className="px-4 py-2.5">Affected drugs</th><th className="px-4 py-2.5">Associated diseases</th><th className="px-4 py-2.5">Citation</th>
          </tr></thead>
          <tbody className="divide-y divide-white/5">
            {mutations.map((m) => (
              <tr key={m.mutation_code}>
                <td className="px-4 py-2">
                  <span className="font-mono text-slate-200">{m.mutation_code}</span>
                  {m.is_gatekeeper && <span className="ml-2 rounded-full border border-kinome-violet/30 bg-kinome-violet/10 px-2 py-0.5 text-[10px] text-kinome-violet">gatekeeper</span>}
                </td>
                <td className="px-4 py-2 text-xs text-slate-300">{m.effect_type ?? "unavailable"}{m.curation_note ? <div className="text-[11px] text-slate-500">Curation note: {m.curation_note}</div> : null}</td>
                <td className="px-4 py-2 text-xs text-slate-300">
                  {m.affected_drugs.length ? m.affected_drugs.join(", ") : <span className="text-slate-500">not named in the cited publication</span>}
                </td>
                <td className="px-4 py-2 text-xs text-slate-400">{m.associated_diseases.length ? m.associated_diseases.join(", ") : "–"}</td>
                <td className="px-4 py-2 text-xs">
                  {m.pubmed_url
                    ? <a href={m.pubmed_url} target="_blank" rel="noopener noreferrer" className="text-kinome-cyan hover:underline">PMID {m.pubmed_id} ↗</a>
                    : <span className="text-amber-300/90" title={m.citation_status}>{m.citation_status}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function VariantsTab({ kinase }: { kinase: KinaseDetail }) {
  return (
    <div className="space-y-5">
      <ClinvarSection variants={kinase.clinvar_variants} />
      <CuratedSection mutations={kinase.curated_mutations} gatekeeper={kinase.gatekeeper} />
      <p className="px-1 text-xs leading-relaxed text-slate-500">
        Source: <a href="https://www.ncbi.nlm.nih.gov/clinvar/" target="_blank" rel="noopener noreferrer" className="text-kinome-cyan hover:underline">NCBI ClinVar</a>.
        Submitted assertions are not independently verified and do not support direct diagnosis or medical decisions without review by a genetics professional.
      </p>
    </div>
  );
}
