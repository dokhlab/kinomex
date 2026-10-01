"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import * as d3 from "d3";

import type { CatalogRow } from "@/lib/catalog/types";
import { EXTENSION_CLASSES, EXTENSION_RING_LABEL } from "@/lib/catalog/types";
import { buildKinomeTree, type KinomeTreeNode } from "@/lib/catalog/tree";
import { EXTENSION_SHORT_LABELS } from "@/components/ui/GroupBadge";

interface KinomePhyloTreeProps {
  rows: CatalogRow[];
  onSelectKinase: (gene: string) => void;
  selectedGroup?: string;
  searchQuery?: string;
}

export const GROUP_COLORS: Record<string, string> = {
  AGC: "#38bdf8",
  CAMK: "#a855f7",
  CK1: "#f59e0b",
  CMGC: "#34d399",
  STE: "#f43f5e",
  TK: "#3b82f6",
  TKL: "#f97316",
  Atypical: "#94a3b8",
  RGC: "#14b8a6",
  Other: "#a1a1aa",
};

// Extension classes share a warm palette so the extension branch reads as one unit.
const EXTENSION_COLORS = ["#fdba74", "#fb923c", "#fcd34d", "#f59e0b", "#fca5a5", "#e879f9", "#d6d3d1"];
EXTENSION_CLASSES.forEach((cls, i) => { GROUP_COLORS[cls] = EXTENSION_COLORS[i]; });

type TreeNode = KinomeTreeNode & { group?: string };

function withGroup(node: KinomeTreeNode): TreeNode {
  return { ...node, group: node.category, children: node.children?.map(withGroup) };
}

export default function KinomePhyloTree({
  rows,
  onSelectKinase,
  selectedGroup,
  searchQuery,
}: KinomePhyloTreeProps) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    data: CatalogRow;
  } | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 800 });

  const kinaseMap = useMemo(() => new Map(rows.map((k) => [k.gene_symbol, k])), [rows]);
  const completeTree = useMemo(() => withGroup(buildKinomeTree(rows)), [rows]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        setDimensions({ width: Math.max(width, 400), height: Math.max(width, 400) });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const { width, height } = dimensions;
    const radius = Math.min(width, height) / 2 - 80;

    const viewport = svg.append("g").attr("class", "zoom-viewport");
    const g = viewport
      .append("g")
      .attr("transform", `translate(${width / 2},${height / 2})`);

    let nodeLabels: d3.Selection<SVGTextElement, d3.HierarchyNode<TreeNode>, SVGGElement, unknown> | null = null;
    let nodeCircles: d3.Selection<SVGCircleElement, d3.HierarchyNode<TreeNode>, SVGGElement, unknown> | null = null;
    let treeLinks: d3.Selection<SVGLineElement, d3.HierarchyLink<TreeNode>, SVGGElement, unknown> | null = null;
    let currentZoomScale = 1;

    const updateZoomStyles = (scale: number) => {
      const safeScale = Math.max(scale, 0.3);
      nodeLabels
        ?.attr("font-size", `${10 / safeScale}px`)
        .attr("x", (d) => ((d.x ?? 0) < Math.PI ? 10 / safeScale : -10 / safeScale))
        .attr("dy", "0.31em")
        .attr("stroke-width", 2.5 / safeScale);
      nodeCircles
        ?.attr("r", function () {
          const baseRadius = Number(this.dataset.baseRadius || 3);
          return baseRadius / safeScale;
        })
        .attr("stroke-width", 1.5 / safeScale);
      treeLinks?.attr("stroke-width", 1 / safeScale);
    };

    const hideOverlappingLabels = () => {
      if (!nodeLabels) return;
      const labels = nodeLabels.nodes();
      if (currentZoomScale >= 8) {
        // At detail zoom every label is shown. Place nearby labels in radial
        // lanes so dense kinase families remain readable instead of forming a
        // single overlapping ring.
        const accepted: DOMRect[] = [];
        const safeScale = Math.max(currentZoomScale, 0.3);
        const svgRect = svgRef.current?.getBoundingClientRect();
        for (const label of labels) {
          label.style.visibility = "visible";
          const datum = d3.select(label).datum() as d3.HierarchyNode<TreeNode>;
          const direction = (datum.x ?? 0) < Math.PI ? 1 : -1;
          let placed = false;
          const maxLabelLanes = 20;
          const tangentOffsets = [0, -12, 12, -24, 24, -36, 36];
          for (let lane = 0; lane < maxLabelLanes && !placed; lane += 1) {
            for (const tangentOffset of tangentOffsets) {
              label.setAttribute("x", String(direction * (10 + lane * 14) / safeScale));
              label.setAttribute("dy", `${tangentOffset / safeScale}px`);
              const rect = label.getBoundingClientRect();
              const onScreen = !svgRect || !(
                rect.right < svgRect.left || rect.left > svgRect.right ||
                rect.bottom < svgRect.top || rect.top > svgRect.bottom
              );
              const overlaps = onScreen && accepted.some((other) => !(
                rect.right + 2 < other.left || rect.left - 2 > other.right ||
                rect.bottom + 2 < other.top || rect.top - 2 > other.bottom
              ));
              if (!overlaps) {
                if (onScreen) accepted.push(rect);
                placed = true;
                break;
              }
            }
          }
          // The final lane is still preferable to hiding a kinase name. This
          // fallback is only reachable in an exceptionally dense viewport.
          if (!placed) {
            label.setAttribute("x", String(direction * (10 + (maxLabelLanes - 1) * 14) / safeScale));
            label.setAttribute("dy", `${tangentOffsets[tangentOffsets.length - 1] / safeScale}px`);
          }
        }
        return;
      }
      const labelData = nodeLabels.data();
      const dataByLabel = new Map(labels.map((label, index) => [label, labelData[index]]));
      const query = (searchQuery ?? "").trim().toLowerCase();
      const prioritized = [...labels].sort((a, b) => {
        const aData = dataByLabel.get(a)!;
        const bData = dataByLabel.get(b)!;
        const priority = (data: d3.HierarchyNode<TreeNode>) => {
          const name = data.data.name.toLowerCase();
          if (query && name === query) return 0;
          if (query && name.includes(query)) return 1;
          if (selectedGroup && data.data.group === selectedGroup) return 2;
          return 3;
        };
        return priority(aData) - priority(bData);
      });
      const accepted: DOMRect[] = [];
      for (const label of prioritized) {
        label.style.visibility = "visible";
        const rect = label.getBoundingClientRect();
        const overlaps = accepted.some((placed) => !(
          rect.right + 2 < placed.left ||
          rect.left - 2 > placed.right ||
          rect.bottom + 2 < placed.top ||
          rect.top - 2 > placed.bottom
        ));
        if (overlaps) {
          label.style.visibility = "hidden";
        } else {
          accepted.push(rect);
        }
      }
    };

    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 12])
      .on("zoom", (event) => {
        currentZoomScale = event.transform.k;
        viewport.attr("transform", event.transform.toString());
        updateZoomStyles(event.transform.k);
      })
      .on("end", () => requestAnimationFrame(hideOverlappingLabels));

    svg.call(zoomBehavior);

    const enrichedTree = completeTree;
    const root = d3.hierarchy(enrichedTree);
    const treeLayout = d3.tree<TreeNode>().size([2 * Math.PI, radius]);
    treeLayout(root);

    const getColor = (node: { data: TreeNode; parent?: { data: TreeNode } | null }): string => {
      const group = node.data.group || node.parent?.data.group;
      return (group && GROUP_COLORS[group]) || "#94a3b8";
    };

    treeLinks = g.selectAll<SVGLineElement, d3.HierarchyLink<TreeNode>>(".link")
      .data(root.links())
      .enter()
      .append("line")
      .attr("class", "link")
      .attr("x1", (d) => (d.source.y ?? 0) * Math.cos((d.source.x ?? 0) - Math.PI / 2))
      .attr("y1", (d) => (d.source.y ?? 0) * Math.sin((d.source.x ?? 0) - Math.PI / 2))
      .attr("x2", (d) => (d.target.y ?? 0) * Math.cos((d.target.x ?? 0) - Math.PI / 2))
      .attr("y2", (d) => (d.target.y ?? 0) * Math.sin((d.target.x ?? 0) - Math.PI / 2))
      .attr("stroke", (d) => {
        const group = d.target.data.group || d.target.parent?.data.group;
        return (group && GROUP_COLORS[group]) || "#334155";
      })
      .attr("stroke-opacity", 0.35)
      .attr("stroke-width", 1);

    const leaves = root.leaves();

    // Label each KinHub group and extension class at its branch point, and mark
    // the extension branch with an outer arc named "UniProt KW-0418 extensions".
    const categories = root.descendants().filter((d) => d.data.kind === "category");
    g.selectAll(".category-label")
      .data(categories)
      .enter()
      .append("text")
      .attr("class", "category-label")
      .attr("transform", (d) => `rotate(${((d.x ?? 0) * 180) / Math.PI - 90}) translate(${(d.y ?? 0) - 4},0)${(d.x ?? 0) >= Math.PI ? " rotate(180)" : ""}`)
      .attr("text-anchor", (d) => ((d.x ?? 0) >= Math.PI ? "start" : "end"))
      .attr("dy", "0.31em")
      .attr("font-size", "9px")
      .attr("font-weight", 600)
      .attr("fill", (d) => GROUP_COLORS[d.data.name] || "#cbd5e1")
      .attr("stroke", "#0b0f19")
      .attr("stroke-width", 3)
      .attr("paint-order", "stroke")
      .text((d) => EXTENSION_SHORT_LABELS[d.data.name] ?? d.data.name);

    const extBranch = root.children?.find((c) => c.data.partition === "uniprot_extended");
    if (extBranch) {
      const extLeaves = extBranch.leaves();
      const start = Math.min(...extLeaves.map((l) => l.x ?? 0)) - 0.01;
      const end = Math.max(...extLeaves.map((l) => l.x ?? 0)) + 0.01;
      const arc = d3.arc<unknown>()({ innerRadius: radius + 42, outerRadius: radius + 46, startAngle: start, endAngle: end, padAngle: 0 } as never);
      g.append("path").attr("d", arc).attr("fill", "#fb923c").attr("fill-opacity", 0.6);
      const mid = (start + end) / 2;
      g.append("text")
        .attr("transform", `rotate(${(mid * 180) / Math.PI}) translate(0,${-(radius + 54)})`)
        .attr("text-anchor", "middle")
        .attr("font-size", "11px")
        .attr("font-weight", 600)
        .attr("fill", "#fdba74")
        .text(`${EXTENSION_RING_LABEL} (${extLeaves.length})`);
    }

    const nodeGroup = g
      .selectAll<SVGGElement, d3.HierarchyPointNode<TreeNode>>(".node")
      .data(leaves)
      .enter()
      .append("g")
      .attr("class", "node")
      .attr("transform", (d) => {
        return `rotate(${((d.x ?? 0) * 180) / Math.PI - 90}) translate(${d.y ?? 0},0)`;
      });

    const scoredLeaves = leaves.filter((d) => d.data.pdis_score !== null && d.data.pdis_score !== undefined);
    const maxPdis = d3.max(scoredLeaves, (d) => d.data.pdis_score as number) || 1;

    nodeGroup
      .append("a")
      .attr("href", (d) => `/kinases/${d.data.name}`)
      .attr("target", "_self")
      .attr("cursor", "pointer")
      .on("mouseenter", (event, d) => {
        const path = `/kinases/${encodeURIComponent(d.data.name)}`;
        router.prefetch(path);
        void fetch(`/api/kinases/${encodeURIComponent(d.data.name)}`, {
          cache: "force-cache",
        }).catch(() => undefined);
        const kinase = kinaseMap.get(d.data.name);
        if (kinase) {
          const rect = svgRef.current!.getBoundingClientRect();
          setTooltip({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            data: kinase,
          });
        }
      })
      .on("click", (event, d) => {
        event.preventDefault();
        router.push(`/kinases/${encodeURIComponent(d.data.name)}`);
      })
      .on("mouseleave", () => setTooltip(null))
      .each(function (d) {
        const link = d3.select(this);
        const radius = d.data.pdis_score === null || d.data.pdis_score === undefined
          ? 3
          : 2 + (d.data.pdis_score / maxPdis) * 6;
        link
          .append("circle")
          .attr("r", radius)
          .attr("data-base-radius", radius)
          .attr("fill", () => getColor(d))
          .attr("stroke", () => getColor(d))
          .attr("stroke-width", 1.5)
          .attr("fill-opacity", 0.85);
        link
          .append("text")
          .attr("dy", "0.31em")
          .attr("x", () => ((d.x ?? 0) < Math.PI === true ? 8 : -8))
          .attr("text-anchor", () => ((d.x ?? 0) < Math.PI === true ? "start" : "end"))
          .attr("transform", () => ((d.x ?? 0) >= Math.PI ? "rotate(180)" : null))
          .text(d.data.name)
          .attr("font-size", "7px")
          .attr("fill", "#cbd5e1")
          .attr("stroke", "#0b0f19")
          .attr("stroke-width", 2.5)
          .attr("paint-order", "stroke")
          .attr("stroke-linejoin", "round");
      });

    nodeCircles = nodeGroup.select("a").select("circle");
    nodeLabels = nodeGroup.select("a").select("text");
    updateZoomStyles(1);
    requestAnimationFrame(hideOverlappingLabels);

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      nodeGroup
        .select("a")
        .select("circle")
        .attr("stroke", (d) => {
          if (d.data.name.toLowerCase().includes(q)) return "#ffffff";
          return "#334155";
        })
        .attr("stroke-width", (d) => (d.data.name.toLowerCase().includes(q) ? 3 : 1));

      const match = leaves.find((d) => d.data.name.toLowerCase() === q);
      if (match) {
        const angle = (match.x ?? 0) - Math.PI / 2;
        const px = (match.y ?? 0) * Math.cos(angle);
        const py = (match.y ?? 0) * Math.sin(angle);
        const scale = 3;
        svg.transition().duration(750).call(
          zoomBehavior.transform as never,
          d3.zoomIdentity
            .translate(width / 2, height / 2)
            .scale(scale)
            .translate(-(width / 2 + px), -(height / 2 + py))
        );
      }
    }

    if (selectedGroup) {
      nodeGroup
        .select("a")
        .select("circle")
        .attr("fill-opacity", (d) => {
          const g = d.data.group || d.parent?.data.group;
          return g === selectedGroup ? 1 : 0.15;
        });
      g.selectAll<SVGLineElement, d3.HierarchyPointLink<TreeNode>>(".link")
        .attr("stroke-opacity", (d) => {
          const target = d.target;
          const g = target.data.group || target.parent?.data.group;
          return g === selectedGroup ? 0.7 : 0.08;
        });
    }
  }, [dimensions, rows, selectedGroup, searchQuery, completeTree, kinaseMap, onSelectKinase, router]);

  return (
    <div
      ref={containerRef}
      className="relative rounded-2xl border border-white/10 bg-[#0b0f19]/80 backdrop-blur-xl shadow-2xl overflow-hidden"
      style={{ minHeight: 500 }}
    >
      <div className="px-6 py-4 border-b border-white/10">
        <h2 className="text-lg font-semibold text-white tracking-wide">
          Catalog tree: KinHub groups and UniProt extension classes
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Core entries sit under their KinHub group and family; the outer orange arc marks the {EXTENSION_RING_LABEL} branch, subdivided by class. Node size follows the default-weight PDIS.
        </p>
        <div className="flex flex-wrap gap-3 mt-2">
          {Object.entries(GROUP_COLORS).map(([group, color]) => (
            <span key={group} className="flex items-center gap-1.5 text-xs text-slate-400">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: color }}
              />
              {EXTENSION_SHORT_LABELS[group] ?? group}
            </span>
          ))}
        </div>
      </div>

      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        className="w-full"
        style={{ maxHeight: 700 }}
      />

      {tooltip && (
        <div
          className="pointer-events-none absolute z-50 rounded-xl border border-white/15 bg-[#0b0f19]/90 backdrop-blur-md px-4 py-3 shadow-xl"
          style={{
            left: Math.max(8, Math.min(tooltip.x + 16, dimensions.width - 240)),
            top: Math.max(8, Math.min(tooltip.y - 10, dimensions.height - 130)),
            width: 224,
          }}
        >
          <p className="text-sm font-bold text-white">{tooltip.data.gene_symbol}</p>
          <p className="text-xs text-slate-300 mt-0.5">{tooltip.data.name}</p>
          <p className="text-xs mt-1">
            <span className="text-slate-400">{tooltip.data.partition === "kinhub_core" ? "KinHub group: " : "Extension class: "}</span>
            <span style={{ color: GROUP_COLORS[tooltip.data.display_category] }}>
              {tooltip.data.display_category}
            </span>
          </p>
          <p className="text-xs">
            <span className="text-slate-400">Family: </span>
            <span className="text-slate-200">{tooltip.data.family || "unavailable"}</span>
          </p>
          <p className="text-xs">
            <span className="text-slate-400">PDIS Score: </span>
            <span className="text-emerald-400 font-mono">
              {tooltip.data.pdis_default === null ? "unavailable" : tooltip.data.pdis_default.toFixed(2)}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
