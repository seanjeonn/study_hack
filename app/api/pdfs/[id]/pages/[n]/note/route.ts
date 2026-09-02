import {
  NoteEntryCreateRequestSchema,
  NoteEntryUpdateRequestSchema,
  PageNoteResponseSchema,
} from "@/lib/schemas";
import { appendNoteEntry, readNoteEntries, updateNoteEntry } from "@/lib/server/notes";
import { resolvePage } from "@/lib/server/resolvePage";
import { denyIfSignedOut } from "@/lib/server/session";

/**
 * The user's note for a single page, as its accumulated entries. Always read
 * fresh from disk, so an edit made outside the app (Obsidian, an editor, git)
 * is what the reader sees.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/pdfs/[id]/pages/[n]/note">) {
  const denied = await denyIfSignedOut();
  if (denied) return denied;

  const { id, n } = await ctx.params;
  const resolved = await resolvePage(id, n);
  if ("error" in resolved) {
    return Response.json({ error: resolved.error }, { status: resolved.status });
  }
  const entries = await readNoteEntries(id, resolved.pageNumber);
  return Response.json(PageNoteResponseSchema.parse({ pageNumber: resolved.pageNumber, entries }));
}

/** Append one entry to the page's note. */
export async function POST(request: Request, ctx: RouteContext<"/api/pdfs/[id]/pages/[n]/note">) {
  const denied = await denyIfSignedOut();
  if (denied) return denied;

  const { id, n } = await ctx.params;
  const resolved = await resolvePage(id, n);
  if ("error" in resolved) {
    return Response.json({ error: resolved.error }, { status: resolved.status });
  }
  const body = NoteEntryCreateRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid request body" }, { status: 400 });
  const entries = await appendNoteEntry(id, resolved.pageNumber, body.data.content);
  return Response.json(PageNoteResponseSchema.parse({ pageNumber: resolved.pageNumber, entries }), {
    status: 201,
  });
}

/** Edit one existing entry in place, leaving the others byte-for-byte alone. */
export async function PUT(request: Request, ctx: RouteContext<"/api/pdfs/[id]/pages/[n]/note">) {
  const denied = await denyIfSignedOut();
  if (denied) return denied;

  const { id, n } = await ctx.params;
  const resolved = await resolvePage(id, n);
  if ("error" in resolved) {
    return Response.json({ error: resolved.error }, { status: resolved.status });
  }
  const body = NoteEntryUpdateRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid request body" }, { status: 400 });
  const entries = await updateNoteEntry(
    id,
    resolved.pageNumber,
    body.data.entryId,
    body.data.content,
  );
  if (!entries) return Response.json({ error: "note entry not found" }, { status: 404 });
  return Response.json(PageNoteResponseSchema.parse({ pageNumber: resolved.pageNumber, entries }));
}
