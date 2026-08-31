import { ConceptRefreshResponseSchema } from "@/lib/schemas";
import { refreshConcepts } from "@/lib/server/conceptRefresh";
import { LlmError } from "@/lib/server/llm";

// A refresh fans out across every changed PDF, so it needs far more than the
// default budget on platforms that enforce one.
export const maxDuration = 300;

/** Rebuild the concept graph. The only route that scans the whole workspace. */
export async function POST() {
  try {
    const result = await refreshConcepts();
    return Response.json(ConceptRefreshResponseSchema.parse(result));
  } catch (err) {
    if (err instanceof LlmError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("[concepts] refresh failed:", err);
    return Response.json({ error: "concept refresh failed" }, { status: 502 });
  }
}
