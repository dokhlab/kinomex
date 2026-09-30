"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import GroupBadge from "@/components/ui/GroupBadge";
import { DEFAULT_WEIGHTS, parseWeightsParam } from "@/lib/pdis";
import type { KinaseDetail } from "@/components/kinase/dossier/types";

const TabPanel = dynamic(() => import("@/components/ui/TabPanel"));
const PDISBadge = dynamic(() => import("@/components/ui/PDISBadge"));
const PDISCard = dynamic(() => import("@/components/kinase/dossier/PDISCard"));
const StructureTab = dynamic(() => import("@/components/kinase/dossier/StructureTab"));
const ExpressionTab = dynamic(() => import("@/components/kinase/dossier/ExpressionTab"));
const LigandsTab = dynamic(() => import("@/components/kinase/dossier/LigandsTab"));
const VariantsTab = dynamic(() => import("@/components/kinase/dossier/VariantsTab"));
const NetworkTab = dynamic(() => import("@/components/kinase/dossier/NetworkTab"));
const DiseasesTab = dynamic(() => import("@/components/kinase/dossier/DiseasesTab"));
const ReferencesTab = dynamic(() => import("@/components/kinase/dossier/ReferencesTab"));
const AiSummary = dynamic(() => import("@/components/kinase/AiSummary"), {
  loading: () => <div className="h-24 animate-shimmer rounded-2xl bg-white/5" />,
});

function TabIcon({ d }: { d: string }) {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={d} />
    </svg>
  );
}

const TABS = [
  { id: "structure", label: "Structure", color: "kinome-cyan", icon: <TabIcon d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /> },
  { id: "expression", label: "Distribution", color: "amber", icon: <TabIcon d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /> },
  { id: "chemical", label: "Ligands", color: "kinome-cyan", icon: <TabIcon d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /> },
  { id: "mutations", label: "Variants", color: "kinome-violet", icon: <TabIcon d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /> },
  { id: "network", label: "Network", color: "kinome-violet", icon: <TabIcon d="M12 5a2 2 0 100-4 2 2 0 000 4zM5 14a2 2 0 100-4 2 2 0 000 4zm14 0a2 2 0 100-4 2 2 0 000 4zm-7 9a2 2 0 100-4 2 2 0 000 4zM10.7 4.5L6.3 10.5m7-6l4.4 6M6.7 13.5l4.1 6m6.5-6l-4.1 6" /> },
  { id: "diseases", label: "Diseases", color: "rose", icon: <TabIcon d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342" /> },
  { id: "references", label: "References", color: "kinome-emerald", icon: <TabIcon d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /> },
];

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-8 sm:px-6 lg:px-8">
      <div className="h-10 w-40 animate-shimmer rounded bg-white/5" />
      <div className="h-5 w-96 animate-shimmer rounded bg-white/5" />
      <div className="h-40 animate-shimmer rounded-2xl bg-white/5" />
      <div className="h-12 animate-shimmer rounded-xl bg-white/5" />
    </div>
  );
}

function NotFound({ gene }: { gene: string }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-20 text-center sm:px-6 lg:px-8">
      <h2 className="mb-2 text-2xl font-bold text-slate-300">Kinase &quot;{gene}&quot; not found</h2>
      <p className="mb-6 text-slate-500">The KinomeX catalog holds no entry with this gene symbol.</p>
      <Link href="/explorer" className="rounded-xl border border-kinome-cyan/30 bg-kinome-cyan/20 px-5 py-2.5 text-sm font-medium text-white hover:bg-kinome-cyan/30">Open the Explorer</Link>
    </div>
  );
}

function KinaseDetailPage() {
  const params = useParams();
  const search = useSearchParams();
  const gene = params.gene as string;
  const weights = parseWeightsParam(search.get("w")) ?? DEFAULT_WEIGHTS;

  const [kinase, setKinase] = useState<KinaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeTab, setActiveTab] = useState("structure");

  useEffect(() => {
    if (!gene) return;
    setLoading(true);
    setNotFound(false);
    fetch(`/api/kinases/${encodeURIComponent(gene)}`)
      .then((res) => {
        if (res.status === 404) {
          setNotFound(true);
          return null;
        }
        return res.json();
      })
      .then((data) => data && setKinase(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [gene]);

  if (loading) return <DetailSkeleton />;
  if (notFound) return <NotFound gene={gene} />;
  if (!kinase) return null;

  const tabCounts: Record<string, number> = {
    structure: kinase.structures.total,
    expression: kinase.tissue_expressions.length,
    chemical: kinase.ligand_summary?.representative_rows ?? 0,
    mutations: kinase.clinvar_variants.length + kinase.curated_mutations.length,
    diseases: kinase.diseases_associated.length,
    references: kinase.key_references.length,
  };
  const isExtension = kinase.partition === "uniprot_extended";

  return (
    <div className="min-h-screen pb-20">
      <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
        <nav className="flex items-center gap-1.5 text-sm text-slate-500" aria-label="Breadcrumb">
          <Link href="/explorer" className="hover:text-slate-300">Explorer</Link>
          <span aria-hidden>›</span>
          <Link href={`/explorer?${new URLSearchParams(isExtension ? { partition: "uniprot_extended", category: kinase.display_category } : { partition: "kinhub_core", category: kinase.display_category })}`} className="hover:text-slate-300">
            {kinase.display_category}
          </Link>
          <span aria-hidden>›</span>
          <span className="font-medium text-slate-300">{kinase.gene_symbol}</span>
        </nav>
      </div>

      <section className="mx-auto max-w-7xl px-4 pb-6 pt-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">{kinase.gene_symbol}</h1>
              <GroupBadge group={kinase.display_category} />
              <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-slate-400">{isExtension ? "UniProt extension" : "KinHub core"}</span>
              {kinase.uniprot_record_status === "inactive" && <span className="rounded-full border border-amber-500/30 px-2.5 py-0.5 text-xs text-amber-300">Inactive UniProt record</span>}
            </div>
            <p className="mb-3 max-w-2xl text-base leading-relaxed text-slate-400">{kinase.name}</p>
            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500">
              <span>UniProt: <a href={`https://www.uniprot.org/uniprotkb/${kinase.uniprot_id}/entry`} target="_blank" rel="noopener noreferrer" className="text-kinome-cyan hover:underline">{kinase.uniprot_id}</a></span>
              {kinase.ec_number && <span>EC: {kinase.ec_number}</span>}
              {kinase.classification.family && <span>Family: {kinase.classification.family}</span>}
              {kinase.classification.subfamily && <span>Subfamily: {kinase.classification.subfamily}</span>}
              <span>Pharos TDL: {kinase.pharos?.tdl ? <a href={kinase.pharos.url} target="_blank" rel="noopener noreferrer" className="text-kinome-cyan hover:underline">{kinase.pharos.tdl}</a> : "unavailable"}</span>
            </div>
          </div>
          <div className="glass-card flex flex-shrink-0 flex-col items-center gap-2 p-4">
            <PDISBadge score={kinase.pdis_score?.overall_score ?? null} size="lg" />
            <span className="text-xs font-medium text-slate-500">Default-weight PDIS</span>
          </div>
        </div>

        {kinase.extension_banner && (
          <div role="note" className="mt-5 rounded-xl border border-dashed border-orange-300/40 bg-orange-400/5 px-4 py-3 text-sm text-orange-200">
            {kinase.extension_banner}
          </div>
        )}
      </section>

      <section className="mx-auto max-w-7xl space-y-6 px-4 pb-6 sm:px-6 lg:px-8">
        <PDISCard pdis={kinase.pdis_score} weights={weights} />
        <AiSummary data={kinase} />
        <div className="glass-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-white">Curated function</h2>
            {kinase.swiss_prot_annotation?.source_url && (
              <a href={kinase.swiss_prot_annotation.source_url} target="_blank" rel="noreferrer" className="text-xs text-kinome-cyan hover:underline">UniProtKB/{kinase.swiss_prot_annotation.section}</a>
            )}
          </div>
          {kinase.swiss_prot_annotation?.functions.length ? (
            <div className="mt-3 space-y-2">
              {kinase.swiss_prot_annotation.functions.map((annotation, i) => <p key={i} className="text-sm leading-relaxed text-slate-300">{annotation}</p>)}
              {kinase.swiss_prot_annotation.catalytic_activities.length > 0 && (
                <div className="mt-3 border-t border-white/5 pt-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Catalytic activity</span>
                  {kinase.swiss_prot_annotation.catalytic_activities.map((a, i) => <p key={i} className="mt-1 text-xs text-slate-400">{a}</p>)}
                </div>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">The current import holds no Swiss-Prot functional annotation for this entry.</p>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <TabPanel tabs={TABS.map((t) => ({ ...t, count: t.id === "network" ? undefined : tabCounts[t.id] ?? 0 }))} activeTab={activeTab} onTabChange={setActiveTab}>
          {activeTab === "structure" && <StructureTab kinase={kinase} />}
          {activeTab === "expression" && <ExpressionTab kinase={kinase} />}
          {activeTab === "chemical" && <LigandsTab kinase={kinase} />}
          {activeTab === "mutations" && <VariantsTab kinase={kinase} />}
          {activeTab === "network" && <NetworkTab gene={kinase.gene_symbol} />}
          {activeTab === "diseases" && <DiseasesTab diseases={kinase.diseases_associated} />}
          {activeTab === "references" && <ReferencesTab references={kinase.key_references} />}
        </TabPanel>
      </section>
    </div>
  );
}

export default function KinaseDetailRoute() {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <KinaseDetailPage />
    </Suspense>
  );
}
