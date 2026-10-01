"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { stringProteinUrl, type StringInteraction } from "@/lib/string-network";

const StringNetworkGraph = dynamic(() => import("@/components/visualizations/StringNetworkGraph"), { ssr: false });

interface NetworkResponse {
  nodes: { id: string }[];
  interactions: StringInteraction[];
}

export default function NetworkTab({ gene }: { gene: string }) {
  const [score, setScore] = useState(700);
  const [networkType, setNetworkType] = useState("functional");
  const [data, setData] = useState<NetworkResponse>({ nodes: [], interactions: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      genes: gene,
      score: String(score),
      network_type: networkType,
      add_nodes: "20",
    });
    fetch(`/api/interactions?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Interaction network unavailable");
        return body as NetworkResponse;
      })
      .then(setData)
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setData({ nodes: [], interactions: [] });
        setError(reason instanceof Error ? reason.message : "Interaction network unavailable");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [gene, score, networkType]);

  const interactions = [...data.interactions]
    .filter((edge) => edge.source.toUpperCase() === gene.toUpperCase() || edge.target.toUpperCase() === gene.toUpperCase())
    .sort((a, b) => b.score - a.score);

  return (
    <div className="space-y-5">
      <div className="glass-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Protein Interaction Network</h3>
            <p className="mt-1 text-sm text-slate-400">Proteins associated with {gene} in STRING. Associations may be functional or physical and do not necessarily imply direct binding.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-slate-400">Network type
              <select value={networkType} onChange={(event) => setNetworkType(event.target.value)} className="mt-1 block rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white">
                <option value="functional">Functional</option><option value="physical">Physical</option>
              </select>
            </label>
            <label className="w-40 text-xs text-slate-400">Confidence ≥ {(score / 1000).toFixed(2)}
              <input className="mt-2 w-full" type="range" min="150" max="900" step="50" value={score} onChange={(event) => setScore(Number(event.target.value))} />
            </label>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60 p-3">
        {loading ? <div className="flex h-[500px] items-center justify-center text-sm text-slate-500">Loading STRING interactions…</div>
          : error ? <p className="p-10 text-center text-rose-400">{error}</p>
          : data.nodes.length ? <StringNetworkGraph {...data} focalNode={gene} />
          : <p className="p-10 text-center text-slate-500">No interactions meet the selected threshold.</p>}
      </div>

      {!loading && !error && interactions.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="border-b border-white/5 px-5 py-4"><h3 className="text-sm font-semibold text-white">Directly connected proteins ({interactions.length})</h3></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-5 py-3">Protein</th><th className="px-5 py-3">Combined confidence</th><th className="px-5 py-3">Experimental</th><th className="px-5 py-3">Database</th><th className="px-5 py-3">Text mining</th></tr></thead>
              <tbody className="divide-y divide-white/5">{interactions.map((edge) => {
                const partner = edge.source.toUpperCase() === gene.toUpperCase() ? edge.target : edge.source;
                return <tr key={`${edge.source}-${edge.target}`}><td className="px-5 py-3 font-semibold text-kinome-cyan"><a href={stringProteinUrl(partner)} target="_blank" rel="noreferrer" className="hover:underline">{partner} ↗</a></td><td className="px-5 py-3 text-slate-200">{edge.score.toFixed(3)}</td><td className="px-5 py-3 text-slate-400">{edge.experimentalScore.toFixed(3)}</td><td className="px-5 py-3 text-slate-400">{edge.databaseScore.toFixed(3)}</td><td className="px-5 py-3 text-slate-400">{edge.textMiningScore.toFixed(3)}</td></tr>;
              })}</tbody>
            </table>
          </div>
        </div>
      )}
      <p className="text-xs text-slate-500">Source: <a href="https://string-db.org/" target="_blank" rel="noreferrer" className="text-kinome-cyan hover:underline">STRING</a>. The graph shows up to 20 neighboring proteins.</p>
    </div>
  );
}
