import { PageNoteResponseSchema, PageNoteUpdateRequestSchema } from "@/lib/schemas";
import { readPageNote, writePageNote } from "@/lib/server/notes";
import { resolvePage } from "@/lib/server/resolvePage";

/**
 * The user's note for a single page. Always read fresh from disk, so an edit
 * made outside the app (Obsidian, an editor, git) is what the reader sees.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/pdfs/[id]/pages/[n]/note">) {
  const { id, n } = await ctx.params;
  const resolved = await resolvePage(id, n);
  if ("error" in resolved) {
    return Response.json({ error: resolved.error }, { status: resolved.status });
  }
  const content = await readPageNote(id, resolved.pageNumber);
  return Response.json(PageNoteResponseSchema.parse({ pageNumber: resolved.pageNumber, content }));
}

export async function PUT(request: Request, ctx: RouteContext<"/api/pdfs/[id]/pages/[n]/note">) {
  const { id, n } = await ctx.params;
  const resolved = await resolvePage(id, n);
  if ("error" in resolved) {
    return Response.json({ error: resolved.error }, { status: resolved.status });
  }
  const body = PageNoteUpdateRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid request body" }, { status: 400 });
  await writePageNote(id, resolved.pageNumber, body.data.content);
  return Response.json(
    PageNoteResponseSchema.parse({ pageNumber: resolved.pageNumber, content: body.data.content }),
  );
}
