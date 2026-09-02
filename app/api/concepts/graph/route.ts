import { ConceptGraphResponseSchema, SubjectSchema } from "@/lib/schemas";
import { buildGraph, filterConceptsByPdfs, listConcepts } from "@/lib/server/concepts";
import { denyIfSignedOut } from "@/lib/server/session";
import { listPdfIdsWithSubject } from "@/lib/server/subjects";

/**
 * The whole concept graph, or the subgraph for one subject. Reads files only —
 * never calls the model. `?subject=` is a view filter: no subject (or an empty
 * one) means every concept.
 */
export async function GET(request: Request) {
  const denied = await denyIfSignedOut();
  if (denied) return denied;

  const raw = new URL(request.url).searchParams.get("subject") ?? "";
  const subject = SubjectSchema.safeParse(raw);
  if (!subject.success) return Response.json({ error: "invalid subject" }, { status: 400 });

  let concepts = await listConcepts();
  if (subject.data) {
    const pdfIds = new Set(await listPdfIdsWithSubject(subject.data));
    concepts = filterConceptsByPdfs(concepts, pdfIds);
  }
  return Response.json(ConceptGraphResponseSchema.parse(buildGraph(concepts)));
}
