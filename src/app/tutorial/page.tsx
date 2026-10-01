"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { PROTOCOLS, type Protocol } from "@/lib/tutorial";
import { queryCatalog } from "@/lib/catalog/query";
import { explorerHref } from "@/lib/catalog/url";
import type { CatalogRow } from "@/lib/catalog/types";

function ExpectedOutput({ protocol, rows }: { protocol: Protocol; rows: CatalogRow[] | null }) {
  const result = useMemo(() => (rows ? queryCatalog(rows, protocol.filters, protocol.weights) : null), [rows, protocol]);
  const baseline = useMemo(
    () => (rows && protocol.compareWith ? queryCatalog(rows, protocol.filters, protocol.compareWith.weights) : null),
    [rows, protocol],
  );
  if (!result) return <p className="text-sm text-slate-500">The expected output loads from the catalog…</p>;
  const top = result.rows.slice(0, 5);
  const core = result.partitionBreakdown.kinhub_core ?? 0;
  return (
    <div className="space-y-2 text-sm text-slate-300">
      <p>
        The Explorer returns <strong className="text-white">{result.total}</strong> entr{result.total === 1 ? "y" : "ies"}
        {protocol.filters.partition !== "kinhub_core" && ` (${core} KinHub core)`}, led by{" "}
        {top.map((r, i) => (
          <span key={r.gene_symbol}>
            <Link href={`/kinases/${r.gene_symbol}`} className="text-kinome-cyan hover:underline">{r.gene_symbol}</Link>
            {` (${r.pdis_weighted?.toFixed(1) ?? "unavailable"})`}{i < top.length - 1 ? ", " : "."}
          </span>
        ))}
      </p>
      {baseline && (
        <p className="text-slate-400">
          With {protocol.compareWith!.label.toLowerCase()}, the top five read {baseline.rows.slice(0, 5).map((r) => r.gene_symbol).join(", ")};{" "}
          {result.rows.slice(0, 50).filter((r) => new Set(baseline.rows.slice(0, 50).map((b) => b.gene_symbol)).has(r.gene_symbol)).length} of the top 50 entries appear in both rankings.
        </p>
      )}
    </div>
  );
}

export default function TutorialPage() {
  const [rows, setRows] = useState<CatalogRow[] | null>(null);
  useEffect(() => {
    fetch("/api/catalog/table").then((r) => (r.ok ? r.json() : null)).then((b) => b && setRows(b.rows)).catch(() => undefined);
  }, []);

  return (
    <div className="min-h-screen pb-20 pt-4">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <h1 className="mb-2 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">Tutorial</h1>
        <p className="mb-10 text-sm leading-relaxed text-slate-400">
          Each protocol lists numbered steps, the expected output, and an annotated screenshot. “Try it” opens the Explorer with the protocol’s filters and weights already applied through the page address.
          The expected outputs come from the live catalog.
        </p>
        <div className="space-y-12">
          {PROTOCOLS.map((p) => (
            <section key={p.id} id={p.id} className="glass-card space-y-5 p-6" aria-labelledby={`${p.id}-title`}>
              <div>
                <h2 id={`${p.id}-title`} className="text-xl font-bold text-white">{p.title}</h2>
                <p className="mt-1 text-sm text-slate-400">{p.question}</p>
              </div>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-300">
                {p.steps.map((s) => <li key={s}>{s}</li>)}
              </ol>
              <div className="rounded-xl border border-kinome-cyan/20 bg-kinome-cyan/[0.04] p-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-kinome-cyan">Expected output</h3>
                <ExpectedOutput protocol={p} rows={rows} />
                {p.followUp && (
                  <p className="mt-2 text-sm text-slate-400">
                    {p.followUp.text} <Link href={`/kinases/${p.followUp.gene}`} className="text-kinome-cyan hover:underline">Open {p.followUp.gene}</Link>.
                  </p>
                )}
              </div>
              <figure>
                <Image src={`/tutorial/${p.screenshot}`} alt={`Annotated Explorer screenshot for ${p.title}`} width={1600} height={1000} className="h-auto w-full rounded-xl border border-white/10" unoptimized />
                <figcaption className="mt-2 text-xs text-slate-500">Highlighted controls show the settings of each step.</figcaption>
              </figure>
              <Link href={explorerHref({ filters: p.filters, weights: p.weights })}
                className="inline-flex items-center gap-2 rounded-xl border border-kinome-cyan/40 bg-kinome-cyan/15 px-5 py-2.5 text-sm font-semibold text-white hover:bg-kinome-cyan/25">
                Try it →
              </Link>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
