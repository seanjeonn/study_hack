import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PageTextLayer {
  /** 1-indexed page number. */
  pageNumber: number;
  /** Raw text-layer content (selectable text only — image-locked text is not here). */
  text: string;
  /** Trimmed length of `text`; the cheap signal behind `has_text`. */
  charCount: number;
}

/**
 * Extract the text layer of every page using pdfjs `getTextContent`. The
 * document is parsed once and pages are walked in order. This is the free,
 * accurate-for-selectable-text half of extraction; diagrams/equations/code
 * rendered as images are NOT captured here (that is the vision step's job).
 */
export async function extractAllPages(bytes: Buffer): Promise<PageTextLayer[]> {
  // pdfjs takes ownership of (and may detach) the buffer it is given, so hand
  // it a standalone copy rather than a view into Node's shared Buffer pool.
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  try {
    const pages: PageTextLayer[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        // items are TextItem | TextMarkedContent; only the former has `str`.
        if ("str" in item) {
          text += item.str;
          if (item.hasEOL) text += "\n";
        }
      }
      pages.push({ pageNumber: n, text, charCount: text.trim().length });
      page.cleanup();
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}
