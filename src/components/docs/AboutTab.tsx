"use client";

import Link from "next/link";
import packageJson from "../../../package.json";
import { ASSISTANT_CITATION_NOTE } from "@/lib/assistant-wording";
import { EXTENSION_SHORT_LABELS } from "@/components/ui/GroupBadge";
import { Card, Section } from "./ui";
import { fmt, useAccounting } from "./useAccounting";

const NEXT_VERSION = packageJson.dependencies.next;
const REACT_VERSION = packageJson.dependencies.react.replace(/^\^/, "");

const icon = (d: string) => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} /></svg>
);

const PAGES = [
  { name: "Dashboard", path: "/", desc: "Catalog counts, top entries by default-weight PDIS, and entry search." },
  { name: "Kinome Tree", path: "/tree", desc: "Radial layout of KinHub core entries by group and family, with the UniProt KW-0418 extensions on a separate labeled branch by class." },
  { name: "Explorer", path: "/explorer", desc: "The full catalog with partition, category, evidence, and GTEx filters; adjustable PDIS weights with presets; a 20-bin histogram; shareable addresses; and CSV export." },
  { name: "Kinase dossier", path: "/kinases/[gene]", desc: "PDIS components and raw inputs, experimental structures with EMDB links and bound ligands, the AlphaFold DB model, GTEx v10 expression, representative ligand rows with every underlying record, ClinVar and literature-curated variants, STRING network, and UniProt diseases." },
  { name: "Tutorial", path: "/tutorial", desc: "Step-by-step protocols (Supplementary Protocols S1–S3) with a “Try it” link that opens the Explorer with the protocol settings." },
  { name: "Research assistant", path: "/search", desc: "An optional, source-linked conversation. Kinase tables link KinomeX dossiers and literature statements carry a PubMed ID and DOI." },
];

export default function AboutTab() {
  const acc = useAccounting();
  const a = acc.status === "ready" ? acc.data : null;

  return (
    <div className="space-y-12">
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="mb-4 text-4xl font-bold text-gradient-cyan-violet">KinomeX documentation</h1>
        <p className="text-lg leading-relaxed text-slate-400">
          KinomeX is a source-linked atlas of human kinase entries. It reconciles the KinHub/Manning roster with reviewed UniProt records and links
          each entry to its structures, ligands, expression, variants, diseases, and interaction network. Every record links to its source.
        </p>
      </div>

      <Section title="Catalog accounting" icon={icon("M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z")}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            { n: a?.total_entries, label: "Catalog entries", color: "text-kinome-cyan" },
            { n: a?.core_entries, label: "KinHub core entries", color: "text-kinome-violet" },
            { n: a?.extension_entries, label: "Reviewed UniProt extensions (KW-0418)", color: "text-kinome-emerald" },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center">
              <div className={`text-3xl font-bold ${s.color}`}>{acc.status === "loading" ? "…" : fmt(s.n)}</div>
              <div className="mt-1 text-sm text-slate-400">{s.label}</div>
            </div>
          ))}
        </div>
        {acc.status === "unavailable" && (
          <p className="text-center text-sm text-amber-300">The catalog accounting endpoint does not respond at the moment; the page shows no estimated values.</p>
        )}
        {a && (
          <Card>
            <p className="text-sm leading-relaxed text-slate-300">
              The {fmt(a.core_entries)} core entries carry {fmt(a.kinhub_domain_rows)} KinHub kinase-domain rows. {fmt(a.inactive_historical_entries)} core entry
              ({a.inactive_entries.map((e) => `${e.gene_symbol}, ${e.uniprot_id}`).join("; ")}) has an inactive UniProt record and keeps its label.
              The {fmt(a.extension_entries)} extensions carry the UniProt Kinase keyword (KW-0418) but have no KinHub row. Snapshot: {a.snapshot_date ?? "unavailable"}.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-kinome-violet">KinHub groups (core)</h4>
                <ul className="grid grid-cols-2 gap-1 text-sm text-slate-300">
                  {Object.entries(a.core_group_counts).map(([g, n]) => <li key={g} className="flex justify-between pr-4"><span>{g}</span><span className="tabular-nums text-slate-400">{n}</span></li>)}
                </ul>
              </div>
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-kinome-emerald">Extension classes</h4>
                <ul className="space-y-1 text-sm text-slate-300">
                  {Object.entries(a.extension_class_counts).map(([c, n]) => <li key={c} className="flex justify-between"><span title={c}>{EXTENSION_SHORT_LABELS[c] ?? c}</span><span className="tabular-nums text-slate-400">{n}</span></li>)}
                </ul>
              </div>
            </div>
          </Card>
        )}
      </Section>

      <Section title="Platform architecture" icon={icon("M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10")}>
        <Card>
          <dl className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
            <div><dt className="font-semibold uppercase tracking-wide text-kinome-cyan">Frontend</dt><dd className="mt-1 text-slate-400">Next.js {NEXT_VERSION} (App Router), React {REACT_VERSION}, TypeScript, Tailwind CSS, D3, NGL Viewer</dd></div>
            <div><dt className="font-semibold uppercase tracking-wide text-kinome-violet">API</dt><dd className="mt-1 text-slate-400">Next.js route handlers over MongoDB; one catalog-accounting module supplies every displayed count (<code>/api/catalog/accounting</code>)</dd></div>
            <div><dt className="font-semibold uppercase tracking-wide text-kinome-emerald">Database</dt><dd className="mt-1 text-slate-400">MongoDB 7 with source-scoped evidence collections, catalog metadata, and quarantine collections for records without provenance</dd></div>
            <div><dt className="font-semibold uppercase tracking-wide text-amber-400">ETL</dt><dd className="mt-1 text-slate-400">Python pipeline (pymongo, aiohttp) that caches every upstream response before it writes to the database</dd></div>
            <div className="md:col-span-2"><dt className="font-semibold uppercase tracking-wide text-slate-300">Deployment</dt><dd className="mt-1 text-slate-400">A Docker Compose service runs the Next.js production build behind nginx at <a className="text-kinome-cyan hover:underline" href="https://kinomex.dokhlab.org">https://kinomex.dokhlab.org</a> over HTTPS; the resource requires no login, and the research assistant is optional.</dd></div>
          </dl>
        </Card>
      </Section>

      <Section title="Pages" icon={icon("M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z")}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {PAGES.map((p) => (
            <Card key={p.name}>
              <div className="flex items-start gap-3">
                <code className="whitespace-nowrap rounded-lg bg-slate-800 px-2 py-1 text-xs text-kinome-cyan">{p.path}</code>
                <div><h4 className="text-sm font-semibold text-white">{p.name}</h4><p className="mt-1 text-sm text-slate-400">{p.desc}</p></div>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Research assistant" icon={icon("M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z")}>
        <Card>
          <p className="text-sm leading-relaxed text-slate-300">
            The research assistant is optional and source-linked; every other feature works without it. It answers from KinomeX records and links each kinase to its dossier.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-amber-200/90">{ASSISTANT_CITATION_NOTE}</p>
        </Card>
      </Section>

      <p className="text-center text-sm text-slate-500">
        The <Link href="/docs?tab=Technical" className="text-kinome-cyan hover:underline">Technical</Link> tab defines the catalog, PDIS, ligand handling, and the coverage of each source.
      </p>
    </div>
  );
}
