import { renderPage } from "@/lib/server/pdfStore";
import { resolvePage } from "@/lib/server/resolvePage";

/** A single page rendered as a PNG (n is 1-indexed). */
export async function GET(_request: Request, ctx: RouteContext<"/api/pdfs/[id]/pages/[n]">) {
  const { id, n } = await ctx.params;
  const resolved = await resolvePage(id, n);
  if ("error" in resolved) {
    return Response.json({ error: resolved.error }, { status: resolved.status });
  }
  const image = await renderPage(id, resolved.pageNumber);
  return new Response(new Uint8Array(image), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
