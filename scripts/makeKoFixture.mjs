#!/usr/bin/env node
/**
 * Regenerate `tests/fixtures/ko-sample.pdf`, the Korean canary the CLI's
 * `--smoke` mode runs against.
 *
 * The fixture is written by hand rather than by a PDF library on purpose. It
 * has to exercise the one path that silently breaks when a packed tarball
 * loses pdfjs's bundled assets: a CID-keyed font with a *predefined* CMap
 * encoding (`UniKS-UCS2-H`) and no embedded font program. To turn those codes
 * back into Korean text, pdfjs must load `cmaps/UniKS-UCS2-H` and
 * `cmaps/Adobe-Korea1-UCS2` from disk. Without them every Hangul character
 * decodes to U+FFFD — which is exactly what `--smoke` asserts against.
 *
 * A PDF produced by a normal writer (a headless browser, say) embeds a font
 * subset with its own ToUnicode map and would pass the check even with the
 * cmaps missing, so it would be no canary at all.
 *
 * Usage: node scripts/makeKoFixture.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  "tests",
  "fixtures",
  "ko-sample.pdf",
);

/** Lines drawn with the CID font. Each must survive extraction verbatim. */
const KOREAN_LINES = [
  "안녕하세요 한국어 텍스트 추출 테스트입니다.",
  "기계학습 개념 지도 예제 문서",
];

/** One ASCII line in a base-14 font, so the page has something to render. */
const ASCII_LINE = "study_hack smoke fixture";

/** UniKS-UCS2-H takes UCS-2 character codes, i.e. plain UTF-16BE. */
function toUcs2Hex(text) {
  return Buffer.from(text, "utf16le").swap16().toString("hex").toUpperCase();
}

function pdfEscape(text) {
  return text.replace(/[\\()]/g, (c) => `\\${c}`);
}

function buildContentStream() {
  const lines = ["BT", "/A 16 Tf", "72 780 Td", `(${pdfEscape(ASCII_LINE)}) Tj`, "ET"];
  let y = 730;
  for (const line of KOREAN_LINES) {
    lines.push("BT", "/K 20 Tf", `72 ${y} Td`, `<${toUcs2Hex(line)}> Tj`, "ET");
    y -= 40;
  }
  return lines.join("\n") + "\n";
}

function buildPdf() {
  const content = buildContentStream();
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
      "/Resources << /Font << /K 4 0 R /A 7 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type0 /BaseFont /HYSMyeongJo-Medium-UniKS-UCS2-H " +
      "/Encoding /UniKS-UCS2-H /DescendantFonts [5 0 R] >>",
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYSMyeongJo-Medium " +
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 1 >> " +
      "/FontDescriptor 8 0 R /DW 1000 >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /FontDescriptor /FontName /HYSMyeongJo-Medium /Flags 6 " +
      "/FontBBox [0 -137 1000 859] /ItalicAngle 0 /Ascent 859 /Descent -141 " +
      "/CapHeight 859 /StemV 80 >>",
  ];

  const chunks = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets = [];
  let position = chunks[0].length;
  objects.forEach((body, index) => {
    offsets.push(position);
    const buf = Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, "latin1");
    chunks.push(buf);
    position += buf.length;
  });

  const xrefStart = position;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, "latin1"));

  return Buffer.concat(chunks);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buildPdf());
console.log(`wrote ${OUT}`);
