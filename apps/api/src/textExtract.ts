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

// NUL (U+0000) — Postgres text columns reject it, and some PDFs emit it in the
// text layer, so it must be stripped before persisting. Built via fromCharCode
// to keep an actual NUL byte out of the source file.
const NUL = String.fromCharCode(0);

export interface PageText {
  pageNumber: number;
  text: string;
  hasText: boolean;
}

/**
 * Count "suspicious" characters — strong markers of broken text extraction:
 * control chars (excl. tab/newline), Misc Technical & Control Pictures (e.g. ⌧
 * from broken CID maps), the Unicode replacement char, and the Specials block
 * (e.g. unmapped ligatures surfacing as U+FFFF).
 *
 * Private Use Area is deliberately NOT counted: real PDFs legitimately use PUA
 * for bullet/icon glyphs (verified on actual course decks), so flagging it
 * would be a false positive. This catches gross corruption but NOT subtle
 * "valid-but-wrong glyph" garble (a font with no ToUnicode map) — the human
 * text panel and a future LLM coherence check remain the backstop for that.
 */
export function countSuspiciousChars(text: string): number {
  let count = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) continue;
    if (
      cp < 0x20 || // C0 controls
      (cp >= 0x7f && cp <= 0x9f) || // DEL + C1 controls
      (cp >= 0x2300 && cp <= 0x243f) || // Misc Technical + Control Pictures
      cp === 0xfffd || // replacement char
      (cp >= 0xfff0 && cp <= 0xffff) // Specials
    ) {
      count++;
    }
  }
  return count;
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
        text = text.split(NUL).join("");
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
