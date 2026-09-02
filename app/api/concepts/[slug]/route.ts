import { ConceptResponseSchema } from "@/lib/schemas";
import { readConcept } from "@/lib/server/concepts";
import { denyIfSignedOut } from "@/lib/server/session";
import { isValidId } from "@/lib/server/workspace";

export async function GET(_request: Request, ctx: RouteContext<"/api/concepts/[slug]">) {
  const denied = await denyIfSignedOut();
  if (denied) return denied;

  const { slug } = await ctx.params;
  if (!isValidId(slug)) return Response.json({ error: "invalid concept slug" }, { status: 400 });
  const concept = await readConcept(slug);
  if (!concept) return Response.json({ error: "concept not found" }, { status: 404 });
  return Response.json(ConceptResponseSchema.parse(concept));
}
