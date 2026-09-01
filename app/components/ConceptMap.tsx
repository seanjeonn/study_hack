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
import AiErrorNotice, { readAiError, type AiError } from "@/app/components/AiErrorNotice";
import FakeDoorDialog from "@/app/components/FakeDoorDialog";
import {
  fakeDoorShown,
  markFakeDoorShown,
  recordAttempt,
  shouldShowFakeDoor,
} from "@/lib/aiAttempts";
import { subjectsOf } from "@/lib/grouping";
import {
  ConceptGraphResponseSchema,
  ConceptRefreshResponseSchema,
  ConceptResponseSchema,
  PdfListResponseSchema,
  type ConceptGraphResponse,
  type ConceptResponse,
} from "@/lib/schemas";

export default function ConceptMap() {
  const [graph, setGraph] = useState<ConceptGraphResponse>({ nodes: [], edges: [] });
  const [selected, setSelected] = useState<ConceptResponse | null>(null);
  // "" is All — the whole graph, exactly as before subjects existed.
  const [subject, setSubject] = useState("");
  const [subjects, setSubjects] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // Status 0 marks a failure that never reached a route (a network drop, a
  // malformed payload); AiErrorNotice falls through to the plain message.
  const [error, setError] = useState<AiError | null>(null);
  const [askPrice, setAskPrice] = useState(false);

  const loadGraph = useCallback(async () => {
    try {
      const url = subject
        ? `/api/concepts/graph?subject=${encodeURIComponent(subject)}`
        : "/api/concepts/graph";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`failed to load the graph (${res.status})`);
      // Validate the inbound payload at the boundary before trusting it.
      setGraph(ConceptGraphResponseSchema.parse(await res.json()));
    } catch (err) {
      setError({
        status: 0,
        message: err instanceof Error ? err.message : "failed to load the graph",
      });
    }
  }, [subject]);

  useEffect(() => {
    (async () => {
      await loadGraph();
    })();
  }, [loadGraph]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/pdfs");
        if (!res.ok) return;
        // Validate the inbound payload at the boundary before trusting it.
        const parsed = PdfListResponseSchema.parse(await res.json());
        if (active) setSubjects(subjectsOf(parsed.pdfs));
      } catch {
        // The picker is an extra: without it the map still works, unfiltered.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function refresh() {
    // Counted before the request goes out — see AiNotePanel.
    if (shouldShowFakeDoor(recordAttempt(), fakeDoorShown())) {
      markFakeDoorShown();
      setAskPrice(true);
    }
    setRefreshing(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/concepts/refresh", { method: "POST" });
      if (!res.ok) {
        setError(await readAiError(res, `refresh failed (${res.status})`));
        return;
      }
      const result = ConceptRefreshResponseSchema.parse(await res.json());
      setStatus(
        `${result.scannedPdfs} scanned, ${result.skippedPdfs} skipped, ${result.llmCalls} LLM calls · ` +
          `${result.conceptsCreated} new, ${result.conceptsUpdated} updated`,
      );
      await loadGraph();
    } catch (err) {
      setError({ status: 0, message: err instanceof Error ? err.message : "refresh failed" });
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
      setError({
        status: 0,
        message: err instanceof Error ? err.message : "failed to load the concept",
      });
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
        {subjects.length > 0 ? (
          <select
            value={subject}
            onChange={(event) => {
              setSubject(event.target.value);
              // The rail could otherwise keep showing a concept outside the filter.
              setSelected(null);
            }}
            className="h-10 rounded-md border border-[#cfcdc4] bg-white px-3 text-sm font-medium text-[#26251e]"
          >
            <option value="">All</option>
            {subjects.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : null}
        {status ? <p className="font-mono text-xs text-[#5a5852]">{status}</p> : null}
        <AiErrorNotice error={error} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="h-[70vh] overflow-hidden rounded-xl border border-[#e6e5e0] bg-white">
          {graph.nodes.length === 0 ? (
            <p className="flex h-full items-center justify-center px-8 text-center text-sm text-[#807d72]">
              {subject
                ? "No concepts in this subject yet."
                : "No concepts yet. Refresh the mindmap to read your PDFs."}
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

      {askPrice ? <FakeDoorDialog onClose={() => setAskPrice(false)} /> : null}
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
