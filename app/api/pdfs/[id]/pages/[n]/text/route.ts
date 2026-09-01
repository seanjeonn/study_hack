import { PageTextResponseSchema } from "@/lib/schemas";
import { getPageText } from "@/lib/server/pdfStore";
import { resolvePage } from "@/lib/server/resolvePage";

/** A single page's extracted text (n is 1-indexed). */
export async function GET(_request: Request, ctx: RouteContext<"/api/pdfs/[id]/pages/[n]/text">) {
  const { id, n } = await ctx.params;
  const resolved = await resolvePage(id, n);
  if ("error" in resolved) {
    return Response.json({ error: resolved.error }, { status: resolved.status });
  }
  const pageText = await getPageText(id, resolved.pageNumber);
  if (!pageText) return Response.json({ error: "page text not found" }, { status: 404 });
  return Response.json(PageTextResponseSchema.parse(pageText));
}
