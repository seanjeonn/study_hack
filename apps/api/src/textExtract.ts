import { createRequire } from "node:module";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Resolve pdfjs-dist's bundled cMap and standard-font assets by absolute path.
// These are required for correct CJK (Korean) text extraction — without the
// cMaps, characters from CID-keyed fonts decode to replacement chars (U+FFFD).
const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
const CMAP_URL = path.join(pdfjsRoot, "cmaps") + path.sep;
const STANDARD_FONT_DATA_URL = path.join(pdfjsRoot, "standard_fonts") + path.sep;

/** A page is considered to "have text" once its non-whitespace length clears this. */
const HAS_TEXT_MIN_CHARS = 10;

export interface PageText {
  pageNumber: number;
  text: string;
  hasText: boolean;
}

/**
 * Extract per-page text from a PDF using pdfjs-dist. Renders nothing — this is
 * the text path, separate from pdf-to-img's image path. Pages with almost no
 * extractable text are flagged `hasText: false` (OCR candidates).
 */
export async function extractPdfText(buffer: Buffer): Promise<PageText[]> {
  // pdfjs may transfer/detach the input, so hand it a fresh copy of the bytes.
  const data = new Uint8Array(buffer);
  const doc = await getDocument({
    data,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  }).promise;

  try {
    const pages: PageText[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      try {
        const content = await page.getTextContent();
        let text = "";
        for (const item of content.items) {
          // Skip marked-content markers (no `str`); keep actual text items.
          if (!("str" in item)) continue;
          text += item.str;
          if (item.hasEOL) text += "\n";
        }
        const nonWhitespace = text.replace(/\s/g, "").length;
        pages.push({ pageNumber: n, text, hasText: nonWhitespace >= HAS_TEXT_MIN_CHARS });
      } finally {
        page.cleanup();
      }
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}
