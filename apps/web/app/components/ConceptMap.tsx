"use client";

import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ConceptGraphResponseSchema,
  ConceptRefreshResponseSchema,
  ConceptResponseSchema,
  type ConceptGraphResponse,
  type ConceptResponse,
} from "@/lib/schemas";

export default function ConceptMap() {
  const [graph, setGraph] = useState<ConceptGraphResponse>({ nodes: [], edges: [] });
  const [selected, setSelected] = useState<ConceptResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadGraph = useCallback(async () => {
    try {
      const res = await fetch("/api/concepts/graph");
      if (!res.ok) throw new Error(`failed to load the graph (${res.status})`);
      // Validate the inbound payload at the boundary before trusting it.
      setGraph(ConceptGraphResponseSchema.parse(await res.json()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load the graph");
    }
  }, []);

  useEffect(() => {
    (async () => {
      await loadGraph();
    })();
  }, [loadGraph]);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/concepts/refresh", { method: "POST" });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `refresh failed (${res.status})`);
      }
      const result = ConceptRefreshResponseSchema.parse(await res.json());
      setStatus(
        `${result.scannedPdfs} scanned, ${result.skippedPdfs} skipped, ${result.llmCalls} LLM calls · ` +
          `${result.conceptsCreated} new, ${result.conceptsUpdated} updated`,
      );
      await loadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : "refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  const onNodeClick: NodeMouseHandler = useCallback(async (_event, node) => {
    try {
      const res = await fetch(`/api/concepts/${node.id}`);
      if (!res.ok) throw new Error(`failed to load the concept (${res.status})`);
      setSelected(ConceptResponseSchema.parse(await res.json()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load the concept");
    }
  }, []);

  const { nodes, edges } = useMemo(() => toFlow(graph), [graph]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="rounded-md bg-[#f54e00] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#d04200] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {refreshing ? "Reading your PDFs…" : "Refresh mindmap"}
        </button>
        {status ? <p className="font-mono text-xs text-[#5a5852]">{status}</p> : null}
        {error ? <p className="text-sm text-[#cf2d56]">{error}</p> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="h-[70vh] overflow-hidden rounded-xl border border-[#e6e5e0] bg-white">
          {graph.nodes.length === 0 ? (
            <p className="flex h-full items-center justify-center px-8 text-center text-sm text-[#807d72]">
              No concepts yet. Refresh the mindmap to read your PDFs.
            </p>
          ) : (
            <ReactFlow nodes={nodes} edges={edges} onNodeClick={onNodeClick} fitView>
              <Background color="#e6e5e0" />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </div>

        <ConceptRail concept={selected} />
      </div>
    </div>
  );
}

function ConceptRail({ concept }: { concept: ConceptResponse | null }) {
  if (!concept) {
    return (
      <div className="flex h-[70vh] items-center justify-center rounded-xl border border-[#e6e5e0] bg-white px-6 text-center text-sm text-[#807d72]">
        Pick a concept to see what it means and where it appears.
      </div>
    );
  }
  return (
    <div className="flex h-[70vh] flex-col gap-4 overflow-auto rounded-xl border border-[#e6e5e0] bg-white p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-normal tracking-tight text-[#26251e]">{concept.name}</h2>
        {concept.aliases.length > 0 ? (
          <p className="text-xs text-[#807d72]">also: {concept.aliases.join(", ")}</p>
        ) : null}
        <p className="font-mono text-[11px] text-[#a09c92]">concepts/{concept.slug}.md</p>
      </div>

      {concept.body.trim() ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#26251e]">
          {concept.body.trim()}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.88px] text-[#807d72]">
          Appears in
        </span>
        <div className="flex flex-wrap gap-1.5">
          {concept.sources.flatMap((source) =>
            source.pages.map((page) => (
              <Link
                key={`${source.pdf}-${page}`}
                href={`/pdfs/${source.pdf}?page=${page}`}
                className="rounded-full border border-[#cfcdc4] px-2.5 py-0.5 font-mono text-xs text-[#26251e] transition-colors hover:bg-[#efeee8]"
              >
                {source.pdf} · p.{page}
              </Link>
            )),
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Lay the graph out as a simple ring. v1 deliberately skips force simulation —
 * a stable, readable circle beats a jittering physics layout at this size.
 */
function toFlow(graph: ConceptGraphResponse): { nodes: Node[]; edges: Edge[] } {
  const count = graph.nodes.length;
  const radius = 140 + count * 26;
  const nodes: Node[] = graph.nodes.map((node, index) => {
    const angle = (index / Math.max(count, 1)) * 2 * Math.PI;
    return {
      id: node.slug,
      position: { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius },
      data: { label: node.pdfCount > 1 ? `${node.name} · ${node.pdfCount} PDFs` : node.name },
      style: {
        // A concept shared by several PDFs is the interesting one, so it is
        // the one the map highlights.
        border: `1px solid ${node.pdfCount > 1 ? "#f54e00" : "#cfcdc4"}`,
        borderRadius: 8,
        background: "#ffffff",
        color: "#26251e",
        fontSize: 12,
        padding: "6px 10px",
      },
    };
  });
  const edges: Edge[] = graph.edges.map((edge) => ({
    id: `${edge.source}--${edge.target}`,
    source: edge.source,
    target: edge.target,
    style: { stroke: "#cfcdc4" },
  }));
  return { nodes, edges };
}
