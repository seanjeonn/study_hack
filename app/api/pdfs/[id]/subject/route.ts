import { PdfSummarySchema, SubjectUpdateRequestSchema } from "@/lib/schemas";
import { getPdfSummary } from "@/lib/server/pdfStore";
import { writeSubject } from "@/lib/server/subjects";
import { isValidId } from "@/lib/server/workspace";

/**
 * Set (or clear) the subject a PDF is grouped under. Writes `subject.md` only —
 * it never touches the cache, the source PDF, or the model. An empty subject
 * ungroups the PDF while leaving the file (and any body the user wrote in it).
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/pdfs/[id]/subject">) {
  const { id } = await ctx.params;
  if (!isValidId(id)) return Response.json({ error: "invalid pdf id" }, { status: 400 });
  // Refuse to file a subject against a directory that holds no PDF.
  if (!(await getPdfSummary(id))) {
    return Response.json({ error: "pdf not found" }, { status: 404 });
  }
  const body = SubjectUpdateRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid request body" }, { status: 400 });

  await writeSubject(id, body.data.subject);
  const summary = await getPdfSummary(id);
  if (!summary) return Response.json({ error: "pdf not found" }, { status: 404 });
  return Response.json(PdfSummarySchema.parse(summary));
}
