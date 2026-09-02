import { AiNoteResponseSchema } from "@/lib/schemas";
import { asLlmError } from "@/lib/server/llm";
import { generateAiNote, readAiNote } from "@/lib/server/pageNote";
import { resolvePage } from "@/lib/server/resolvePage";
import { denyIfSignedOut } from "@/lib/server/session";
import { sendEvent } from "@/lib/server/telemetry";

/** The accumulated AI notes for a page. Never calls the model. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/pdfs/[id]/pages/[n]/ai-note">,
) {
  const denied = await denyIfSignedOut();
  if (denied) return denied;

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
  const denied = await denyIfSignedOut();
  if (denied) return denied;

  const { id, n } = await ctx.params;
  const resolved = await resolvePage(id, n);
  if ("error" in resolved) {
    return Response.json({ error: resolved.error }, { status: resolved.status });
  }
  try {
    const content = await generateAiNote(id, resolved.pageNumber);
    // Opt-in and fire-and-forget: never awaited, so it cannot delay the note.
    sendEvent("aiUse");
    return Response.json(AiNoteResponseSchema.parse({ pageNumber: resolved.pageNumber, content }));
  } catch (err) {
    // A missing API key surfaces as a clean 503, an exhausted beta quota as a
    // 429 — neither is a 500, and neither writes anything.
    const llmError = asLlmError(err);
    if (llmError) {
      return Response.json(
        { error: llmError.message, code: llmError.code },
        { status: llmError.status },
      );
    }
    console.error(`[ai-note] pdf=${id} page=${resolved.pageNumber} failed:`, err);
    return Response.json({ error: "failed to generate an AI note" }, { status: 502 });
  }
}
