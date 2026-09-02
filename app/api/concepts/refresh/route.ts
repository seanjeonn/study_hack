import { ConceptRefreshResponseSchema } from "@/lib/schemas";
import { refreshConcepts } from "@/lib/server/conceptRefresh";
import { asLlmError } from "@/lib/server/llm";
import { denyIfSignedOut } from "@/lib/server/session";
import { sendEvent } from "@/lib/server/telemetry";

// A refresh fans out across every changed PDF, so it needs far more than the
// default budget on platforms that enforce one.
export const maxDuration = 300;

/** Rebuild the concept graph. The only route that scans the whole workspace. */
export async function POST() {
  const denied = await denyIfSignedOut();
  if (denied) return denied;

  try {
    const result = await refreshConcepts();
    // Opt-in and fire-and-forget: never awaited.
    if (result.llmCalls > 0) sendEvent("aiUse");
    return Response.json(ConceptRefreshResponseSchema.parse(result));
  } catch (err) {
    const llmError = asLlmError(err);
    if (llmError) {
      return Response.json(
        { error: llmError.message, code: llmError.code },
        { status: llmError.status },
      );
    }
    console.error("[concepts] refresh failed:", err);
    return Response.json({ error: "concept refresh failed" }, { status: 502 });
  }
}
