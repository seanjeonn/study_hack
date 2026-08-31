import { PdfDetailResponseSchema } from "@/lib/schemas";
import { getPdfDetail } from "@/lib/server/pdfStore";
import { isValidId } from "@/lib/server/workspace";

/** A PDF's summary plus its extraction-quality report. */
export async function GET(_request: Request, ctx: RouteContext<"/api/pdfs/[id]">) {
  const { id } = await ctx.params;
  if (!isValidId(id)) return Response.json({ error: "invalid pdf id" }, { status: 400 });
  const detail = await getPdfDetail(id);
  if (!detail) return Response.json({ error: "pdf not found" }, { status: 404 });
  return Response.json(PdfDetailResponseSchema.parse(detail));
}
