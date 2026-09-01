import { ConceptGraphResponseSchema } from "@/lib/schemas";
import { buildGraph, listConcepts } from "@/lib/server/concepts";

/** The whole concept graph. Reads files only — never calls the model. */
export async function GET() {
  const graph = buildGraph(await listConcepts());
  return Response.json(ConceptGraphResponseSchema.parse(graph));
}
