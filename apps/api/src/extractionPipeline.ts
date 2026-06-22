import { eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { pdf, pdfPage } from "./db/schema.js";
import { renderPage } from "./pdfStore.js";
import { extractAllPages } from "./textExtract.js";
import { transcribePagePng } from "./visionClient.js";

/** A page with fewer than this many text-layer chars is flagged `has_text=false`. */
export const HAS_TEXT_MIN = 100;

/**
 * Extract every page of a stored PDF: pdfjs text layer (free) + a Sonnet 4.6
 * vision transcription of the rendered page image (recovers diagrams, equations,
 * and code that the text layer misses). Runs in the background after upload and
 * drives `pdf.status` (`processing` → `text_ready` | `failed`). Idempotent —
 * re-running upserts each page, so it doubles as the re-trigger path.
 *
 * Per-page vision failures degrade to text-layer-only for that page; only a
 * document-level failure (byte load / DB) marks the whole PDF `failed`.
 */
export async function runExtraction(pdfId: string): Promise<void> {
  try {
    await db.update(pdf).set({ status: "processing" }).where(eq(pdf.id, pdfId));

    const [row] = await db.select({ bytes: pdf.bytes }).from(pdf).where(eq(pdf.id, pdfId)).limit(1);
    if (!row) throw new Error(`pdf ${pdfId} not found`);

    const pages = await extractAllPages(row.bytes);

    const visionEnabled = process.env.VISION_ENABLED !== "false";
    const concurrency = Math.max(1, Number(process.env.VISION_CONCURRENCY) || 4);

    await mapWithConcurrency(pages, concurrency, async (page) => {
      let visionText: string | null = null;
      if (visionEnabled) {
        try {
          const png = await renderPage(pdfId, page.pageNumber);
          const { visionText: t } = await transcribePagePng(png);
          visionText = t.length > 0 ? t : null;
        } catch (err) {
          // Degrade this page to text-layer-only rather than failing the doc.
          console.error(`vision failed for pdf ${pdfId} page ${page.pageNumber}:`, err);
        }
      }

      const hasText = page.charCount >= HAS_TEXT_MIN;
      const values = {
        pdfId,
        pageNumber: page.pageNumber,
        textLayerText: page.text,
        charCount: page.charCount,
        hasText,
        visionUsed: visionText !== null,
        visionText,
        content: visionText ?? page.text,
      };
      await db
        .insert(pdfPage)
        .values(values)
        .onConflictDoUpdate({
          target: [pdfPage.pdfId, pdfPage.pageNumber],
          set: {
            textLayerText: values.textLayerText,
            charCount: values.charCount,
            hasText: values.hasText,
            visionUsed: values.visionUsed,
            visionText: values.visionText,
            content: values.content,
          },
        });
    });

    await db.update(pdf).set({ status: "text_ready" }).where(eq(pdf.id, pdfId));
  } catch (err) {
    console.error(`extraction failed for pdf ${pdfId}:`, err);
    await db
      .update(pdf)
      .set({ status: "failed" })
      .where(eq(pdf.id, pdfId))
      .catch(() => {});
  }
}

/** Run `worker` over `items` with at most `limit` in flight (no extra deps). */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(runners);
}
