"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import * as d3 from "d3";
import { stringProteinUrl, type StringInteraction } from "@/lib/string-network";

interface GraphNode extends d3.SimulationNodeDatum { id: string }
type GraphLink = Omit<StringInteraction, "source" | "target"> & d3.SimulationLinkDatum<GraphNode>;

export default function StringNetworkGraph({ nodes, interactions, focalNode }: {
  nodes: { id: string }[];
  interactions: StringInteraction[];
  focalNode?: string;
}) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const width = 1000;
    const height = 650;
    const graphNodes: GraphNode[] = nodes.map((node) => ({ ...node }));
    const links: GraphLink[] = interactions.map((edge) => ({ ...edge, source: edge.source, target: edge.target }));
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    const viewport = svg.append("g");
    svg.call(d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.4, 5]).on("zoom", (event) => {
      viewport.attr("transform", event.transform.toString());
    }));

    const link = viewport.selectAll("line").data(links).enter().append("line")
      .attr("stroke", "#38bdf8").attr("stroke-opacity", 0.18)
      .attr("stroke-width", (edge) => 1 + edge.score * 4);
    const node = viewport.selectAll<SVGGElement, GraphNode>("g.node").data(graphNodes).enter()
      .append("g").attr("class", "node").attr("tabindex", 0).attr("role", "link")
      .attr("aria-label", (item) => item.id.toUpperCase() === focalNode?.toUpperCase()
        ? `Open ${item.id} KinomeX profile`
        : focalNode ? `Open ${item.id} in STRING` : `Open ${item.id} kinase profile`)
      .style("cursor", "pointer")
      .on("click", (_event, item) => {
        if (!focalNode || item.id.toUpperCase() === focalNode.toUpperCase()) {
          router.push(`/kinases/${encodeURIComponent(item.id)}`);
        } else {
          window.open(stringProteinUrl(item.id), "_blank", "noopener,noreferrer");
        }
      });
    node.append("circle").attr("r", (item) => item.id.toUpperCase() === focalNode?.toUpperCase() ? 17 : 12)
      .attr("fill", (item) => item.id.toUpperCase() === focalNode?.toUpperCase() ? "#164e63" : "#0f2741")
      .attr("stroke", (item) => item.id.toUpperCase() === focalNode?.toUpperCase() ? "#a855f7" : "#38bdf8")
      .attr("stroke-width", (item) => item.id.toUpperCase() === focalNode?.toUpperCase() ? 3 : 2);
    node.append("text").text((item) => item.id).attr("x", 16).attr("dy", "0.35em")
      .attr("fill", "#e2e8f0").attr("font-size", 12).attr("paint-order", "stroke")
      .attr("stroke", "#070b15").attr("stroke-width", 3);
    node.append("title").text((item) => item.id.toUpperCase() === focalNode?.toUpperCase()
      ? `${item.id} — current KinomeX profile`
      : focalNode ? `${item.id} — open in STRING` : `${item.id} — open KinomeX profile`);

    const simulation = d3.forceSimulation(graphNodes)
      .force("link", d3.forceLink<GraphNode, GraphLink>(links).id((item) => item.id).distance(110).strength((edge) => Math.max(0.15, edge.score)))
      .force("charge", d3.forceManyBody().strength(-320))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide(38))
      .on("tick", () => {
        link.attr("x1", (edge) => typeof edge.source === "object" ? edge.source.x ?? 0 : 0).attr("y1", (edge) => typeof edge.source === "object" ? edge.source.y ?? 0 : 0)
          .attr("x2", (edge) => typeof edge.target === "object" ? edge.target.x ?? 0 : 0).attr("y2", (edge) => typeof edge.target === "object" ? edge.target.y ?? 0 : 0);
        node.attr("transform", (item) => `translate(${item.x ?? 0},${item.y ?? 0})`);
      });
    return () => { simulation.stop(); };
  }, [nodes, interactions, focalNode, router]);

  return <svg ref={svgRef} viewBox="0 0 1000 650" className="h-[650px] w-full rounded-xl bg-[#070b15]" aria-label="STRING kinase interaction network" />;
}
