"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACTION_RULE, ACTION_STYLES, ACTIONS, MEASURE_SHAPES, MEASURES, pActivity,
  type Action, type Measure, type Shape,
} from "@/lib/dossier/ligand-display";

export interface LigandPlotData {
  total: number;
  plotted: number;
  bounds: number;
  key: string[];
  name: string[];
  measure: number[];
  action: number[];
  value_nm: number[];
  activity_type: string[];
}

interface Mark { i: number; x: number; y: number }

const SURFACE = "#0d1324";
const PAD = { left: 64, right: 20, top: 8, bottom: 44 };
const nf = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 });

function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, x: number, y: number, r: number) {
  ctx.beginPath();
  if (shape === "circle") ctx.arc(x, y, r, 0, Math.PI * 2);
  else if (shape === "square") ctx.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
  else if (shape === "diamond") { ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r * 1.25, y); ctx.lineTo(x, y + r * 1.25); ctx.lineTo(x - r * 1.25, y); ctx.closePath(); }
  else if (shape === "triangle") { ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r * 1.15, y + r * 0.85); ctx.lineTo(x - r * 1.15, y + r * 0.85); ctx.closePath(); }
  else { ctx.moveTo(x, y + r * 1.2); ctx.lineTo(x + r * 1.15, y - r * 0.85); ctx.lineTo(x - r * 1.15, y - r * 0.85); ctx.closePath(); }
}

function Glyph({ shape, color = "#cbd5e1" }: { shape: Shape; color?: string }) {
  const p: Record<Shape, string> = {
    circle: "M6 2a4 4 0 1 0 0.001 0Z",
    square: "M2.4 2.4h7.2v7.2H2.4Z",
    diamond: "M6 1 11 6 6 11 1 6Z",
    triangle: "M6 1.2 10.8 9.8H1.2Z",
    "triangle-down": "M6 10.8 10.8 2.2H1.2Z",
  };
  return <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="inline-block"><path d={p[shape]} fill={color} /></svg>;
}

function nmLabel(p: number) {
  const nm = 10 ** (9 - p);
  if (nm >= 1000) return `${nf.format(nm / 1000)} µM`;
  if (nm >= 1) return `${nf.format(nm)} nM`;
  return `${nf.format(nm * 1000)} pM`;
}

export default function LigandPotencyPlot({ data, onSelect }: { data: LigandPlotData; onSelect: (i: number) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<Mark | null>(null);
  const [hidden, setHidden] = useState<Set<Action>>(new Set());

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, Math.floor(e.contentRect.width) - 16)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = data.plotted;
  const r = n > 4000 ? 2.5 : n > 800 ? 3 : 4;
  const lanes = useMemo(() => MEASURES.filter((_, m) => data.measure.includes(m)), [data.measure]);
  // The axis stops at 0.1 pM (p 13); the few values beyond it sit at the edge.
  const P_CAP = 13;
  const pMax = useMemo(() => Math.min(P_CAP, Math.max(10, Math.ceil(Math.max(5, ...data.value_nm.map(pActivity))))), [data.value_nm]);
  const beyond = useMemo(() => data.value_nm.filter((v) => pActivity(v) > P_CAP).length, [data.value_nm]);
  const pMin = 5;
  const plotW = width - PAD.left - PAD.right;
  const xOf = (p: number) => PAD.left + ((p - pMin) / (pMax - pMin)) * plotW;

  // Dot stacks per lane: marks in one pixel column stack outward from the lane
  // centre, compressed when a column holds more marks than the lane fits.
  const { marks, laneTop, laneH } = useMemo(() => {
    const d = r * 2 + 1;
    const columns = new Map<string, number[]>();
    data.value_nm.forEach((v, i) => {
      if (hidden.has(ACTIONS[data.action[i]])) return;
      const col = Math.round((xOf(Math.min(pMax, pActivity(v))) - PAD.left) / d);
      const k = `${data.measure[i]}:${col}`;
      if (!columns.has(k)) columns.set(k, []);
      columns.get(k)!.push(i);
    });
    // Each lane is as tall as its tallest column needs, within limits.
    const tallest = lanes.map(() => 1);
    columns.forEach((idx, k) => {
      const lane = lanes.indexOf(MEASURES[Number(k.split(":")[0])]);
      tallest[lane] = Math.max(tallest[lane], idx.length);
    });
    const hs = tallest.map((t) => Math.min(170, Math.max(34, t * d + 10)));
    const tops = hs.map((_, li) => PAD.top + hs.slice(0, li).reduce((a, b) => a + b, 0));
    const out: Mark[] = [];
    columns.forEach((idx, k) => {
      const [m, col] = k.split(":").map(Number);
      const lane = lanes.indexOf(MEASURES[m]);
      const h = hs[lane];
      const centre = tops[lane] + h / 2;
      const step = Math.min(d, (h - d - 4) / Math.max(1, idx.length - 1));
      idx.sort((a, b) => data.value_nm[a] - data.value_nm[b]).forEach((i, j) => {
        const off = j === 0 ? 0 : (j % 2 ? 1 : -1) * Math.ceil(j / 2);
        out.push({ i, x: PAD.left + col * d, y: centre + off * step });
      });
    });
    return { marks: out, laneTop: tops, laneH: hs };
  }, [data, hidden, lanes, r, width, pMax]); // eslint-disable-line react-hooks/exhaustive-deps

  const plotBottom = PAD.top + laneH.reduce((a, b) => a + b, 0);
  const height = plotBottom + PAD.bottom;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    // Lanes and grid
    lanes.forEach((m, li) => {
      const y0 = laneTop[li];
      if (li > 0) { ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.beginPath(); ctx.moveTo(PAD.left, y0); ctx.lineTo(width - PAD.right, y0); ctx.stroke(); }
      ctx.fillStyle = "#94a3b8"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText(m, PAD.left - 22, y0 + laneH[li] / 2);
      ctx.fillStyle = "#cbd5e1"; drawShape(ctx, MEASURE_SHAPES[m], PAD.left - 12, y0 + laneH[li] / 2, 3.5); ctx.fill();
    });
    const bottom = plotBottom;
    for (let p = pMin; p <= pMax; p++) {
      const x = xOf(p);
      ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.fillStyle = "#94a3b8"; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(String(p), x, bottom + 6);
      if (plotW / (pMax - pMin) >= 48 || p % 2 === 1) { ctx.fillStyle = "#64748b"; ctx.fillText(nmLabel(p), x, bottom + 21); }
    }
    // Marks, each with a thin surface ring so overlapping marks stay separable
    ctx.lineWidth = 1;
    ctx.strokeStyle = SURFACE;
    for (const mk of marks) {
      ctx.fillStyle = ACTION_STYLES[ACTIONS[data.action[mk.i]]].color;
      drawShape(ctx, MEASURE_SHAPES[MEASURES[data.measure[mk.i]]], mk.x, mk.y, r);
      ctx.fill(); ctx.stroke();
    }
    if (hover) {
      ctx.lineWidth = 2; ctx.strokeStyle = "#f8fafc";
      drawShape(ctx, MEASURE_SHAPES[MEASURES[data.measure[hover.i]]], hover.x, hover.y, r + 2.5); ctx.stroke();
    }
  }, [marks, hover, width, height, laneH, laneTop, lanes, data, r, pMax]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let best: Mark | null = null, bestD = 64;
    for (const mk of marks) {
      const dd = (mk.x - x) ** 2 + (mk.y - y) ** 2;
      if (dd < bestD) { bestD = dd; best = mk; }
    }
    return best;
  };

  const counts = useMemo(() => {
    const c = new Map<Action, number>();
    data.action.forEach((a) => c.set(ACTIONS[a], (c.get(ACTIONS[a]) ?? 0) + 1));
    return c;
  }, [data.action]);
  const measuresPresent = lanes as Measure[];

  return (
    <div ref={wrapRef} className="glass-card overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/5 px-4 pt-4 pb-3">
        <h3 className="text-sm font-semibold text-white">Potency <span className="font-normal text-slate-400">· higher is more potent (−log₁₀ M)</span></h3>
        <p className="text-xs text-slate-400">
          {n.toLocaleString("en-US")} plotted{data.bounds ? ` · ${data.bounds.toLocaleString("en-US")} bounds not plotted` : ""}
          {beyond ? ` · ${beyond} below 0.1 pM drawn at the right edge` : ""}
        </p>
      </div>
      {n === 0 ? (
        <p className="p-6 text-sm text-slate-500">No point value in the reporting range matches the selected filters.</p>
      ) : (
        <div className="relative px-2 pt-3">
          <canvas
            ref={canvasRef}
            style={{ width, height, cursor: hover ? "pointer" : "default" }}
            role="img"
            aria-label={`Potency of ${n} compounds, from ${pMin} to ${pMax} on the −log10 molar scale; the table below lists every value.`}
            onMouseMove={(e) => setHover(pick(e))}
            onMouseLeave={() => setHover(null)}
            onClick={(e) => { const mk = pick(e); if (mk) onSelect(mk.i); }}
          />
          {hover && (
            <div
              className="pointer-events-none absolute z-10 w-max max-w-[18rem] rounded-lg border border-white/10 bg-slate-900/95 px-3 py-2 text-xs shadow-xl"
              style={{ left: Math.min(hover.x + 14, width - 200), top: Math.max(0, hover.y - 10) }}
            >
              <div className="font-medium text-slate-100">{data.name[hover.i]}</div>
              <div className="mt-0.5 font-mono text-slate-300">
                {data.activity_type[hover.i] || "Activity"} {nf.format(data.value_nm[hover.i])} nM · p{pActivity(data.value_nm[hover.i]).toFixed(2)}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-slate-400">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: ACTION_STYLES[ACTIONS[data.action[hover.i]]].color }} />
                {ACTION_STYLES[ACTIONS[data.action[hover.i]]].label} · {data.key[hover.i].replace(/^chembl:/, "").replace(/^pubchem:/, "CID ")}
              </div>
              <div className="mt-1 text-[10px] text-slate-500">Click to show it in the table</div>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/5 px-4 py-3 text-xs text-slate-300">
        {ACTIONS.filter((a) => counts.has(a)).map((a) => (
          <button
            key={a}
            type="button"
            aria-pressed={!hidden.has(a)}
            onClick={() => setHidden((h) => { const s = new Set(h); if (s.has(a)) s.delete(a); else s.add(a); return s; })}
            className={`inline-flex items-center gap-1.5 hover:text-white ${hidden.has(a) ? "opacity-40 line-through" : ""}`}
            title="Show or hide this action"
          >
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: ACTION_STYLES[a].color }} />
            {ACTION_STYLES[a].label} <span className="text-slate-500">{counts.get(a)!.toLocaleString("en-US")}</span>
          </button>
        ))}
        <span className="hidden h-3 w-px bg-white/10 sm:inline-block" />
        {measuresPresent.map((m) => (
          <span key={m} className="inline-flex items-center gap-1.5"><Glyph shape={MEASURE_SHAPES[m]} /> {m === "Other" ? "other measures" : m}</span>
        ))}
      </div>
      <p className="border-t border-white/5 px-4 py-2.5 text-[11px] leading-relaxed text-slate-500">
        One mark per compound: its reported measurement in the table below. Hover a mark for the compound and its value; click it to find it in the table. {ACTION_RULE}
      </p>
    </div>
  );
}
