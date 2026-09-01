import { AiNoteResponseSchema } from "@/lib/schemas";
import { LlmError } from "@/lib/server/llm";
import { generateAiNote, readAiNote } from "@/lib/server/pageNote";
import { resolvePage } from "@/lib/server/resolvePage";

/** The accumulated AI notes for a page. Never calls the model. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/pdfs/[id]/pages/[n]/ai-note">,
) {
  const { id, n } = await ctx.params;
  const resolved = await resolvePage(id, n);
  if ("error" in resolved) {
    return Response.json({ error: resolved.error }, { status: resolved.status });
  }
  const content = await readAiNote(id, resolved.pageNumber);
  return Response.json(AiNoteResponseSchema.parse({ pageNumber: resolved.pageNumber, content }));
}

/** Generate one more annotation for the page. The only AI call in the reader. */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/pdfs/[id]/pages/[n]/ai-note">,
) {
  const { id, n } = await ctx.params;
  const resolved = await resolvePage(id, n);
  if ("error" in resolved) {
    return Response.json({ error: resolved.error }, { status: resolved.status });
  }
  try {
    const content = await generateAiNote(id, resolved.pageNumber);
    return Response.json(AiNoteResponseSchema.parse({ pageNumber: resolved.pageNumber, content }));
  } catch (err) {
    // A missing API key surfaces as a clean 503, not a 500.
    if (err instanceof LlmError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(`[ai-note] pdf=${id} page=${resolved.pageNumber} failed:`, err);
    return Response.json({ error: "failed to generate an AI note" }, { status: 502 });
  }
}
