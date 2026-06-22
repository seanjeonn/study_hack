import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pdf as pdfRender } from "pdf-to-img";
import { extractAllPages } from "../src/textExtract.js";
import { transcribePagePng } from "../src/visionClient.js";

/**
 * 성능 점검 — re-runnable extraction diagnostic over PDFs on disk. DB- and
 * server-free. Without flags it reports per-doc text-layer coverage; with
 * `--vision` it also transcribes every page and reports the content uplift +
 * projected cost, so the team can re-verify performance and the text-vs-image
 * tradeoff at any time.
 *
 *   pnpm --filter @study-hack/api measure:extraction              # text layer only
 *   pnpm --filter @study-hack/api measure:extraction -- --vision  # + Sonnet 4.6 vision
 *   pnpm --filter @study-hack/api measure:extraction -- ./a.pdf   # explicit paths
 */

// Mirrors HAS_TEXT_MIN in extractionPipeline.ts (kept local so this stays DB-free).
const HAS_TEXT_MIN = 100;
// Rough per-page cost at Sonnet 4.6 ($3/$15 per MTok), ~1.8k in + ~0.6k out tokens.
const COST_PER_PAGE = 0.0144;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DOCS = path.resolve(scriptDir, "../../../docs");

function collectPdfs(args: string[]): string[] {
  const inputs = args.length > 0 ? args : [DEFAULT_DOCS];
  const pdfs: string[] = [];
  for (const input of inputs) {
    const abs = path.resolve(input);
    if (!existsSync(abs)) {
      console.error(`skipping missing path: ${abs}`);
      continue;
    }
    if (statSync(abs).isDirectory()) {
      for (const f of readdirSync(abs)) {
        if (f.toLowerCase().endsWith(".pdf")) pdfs.push(path.join(abs, f));
      }
    } else if (abs.toLowerCase().endsWith(".pdf")) {
      pdfs.push(abs);
    }
  }
  return [...new Set(pdfs)].sort();
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const useVision = argv.includes("--vision");
  const files = collectPdfs(argv.filter((a) => !a.startsWith("--")));
  if (files.length === 0) {
    console.error("no PDFs found. Pass a file/dir, or place PDFs in docs/.");
    process.exit(1);
  }
  console.log(`Measuring ${files.length} PDF(s)  vision=${useVision ? "on" : "off"}\n`);

  let totalVisionCalls = 0;
  for (const file of files) {
    const bytes = readFileSync(file);
    const pages = await extractAllPages(bytes);
    const charCounts = pages.map((p) => p.charCount);
    const totalChars = charCounts.reduce((a, b) => a + b, 0);
    const textPoor = pages.filter((p) => p.charCount < HAS_TEXT_MIN).map((p) => p.pageNumber);

    console.log("=".repeat(72));
    console.log(path.basename(file));
    console.log(
      `  pages=${pages.length}  text-layer chars: total=${totalChars}` +
        `  avg=${Math.round(totalChars / pages.length)}  median=${median(charCounts)}`,
    );
    console.log(
      `  text-poor pages (charCount<${HAS_TEXT_MIN}, vision matters most): ${textPoor.length}` +
        (textPoor.length ? `  → ${textPoor.slice(0, 30).join(", ")}` : ""),
    );

    if (useVision) {
      const doc = await pdfRender(bytes, { scale: 2 });
      let visionPages = 0;
      let visionFailed = 0;
      let totalContentChars = 0;
      const samples: string[] = [];
      for (const page of pages) {
        let content = page.text;
        let visionLen = 0;
        try {
          const png = await doc.getPage(page.pageNumber);
          const { visionText } = await transcribePagePng(png);
          totalVisionCalls++;
          if (visionText.length > 0) {
            visionPages++;
            visionLen = visionText.length;
            content = visionText;
          }
        } catch (err) {
          visionFailed++;
          console.error(`  ! vision failed on page ${page.pageNumber}: ${(err as Error).message}`);
        }
        totalContentChars += content.length;
        if (samples.length < 5 && visionLen > Math.max(page.charCount * 2, 200)) {
          samples.push(
            `    p${page.pageNumber}: textLayer=${page.charCount} → vision=${visionLen} chars`,
          );
        }
      }
      const uplift =
        totalChars > 0 ? Math.round(((totalContentChars - totalChars) / totalChars) * 100) : 0;
      console.log(
        `  vision: ${visionPages}/${pages.length} pages added content, ${visionFailed} failed`,
      );
      console.log(
        `  merged content chars: ${totalContentChars} (text-layer ${totalChars}, +${uplift}% from vision)`,
      );
      if (samples.length) {
        console.log("  pages where vision recovered image-locked content:");
        for (const s of samples) console.log(s);
      }
    }
    console.log("");
  }

  if (useVision) {
    console.log(
      `Total vision calls: ${totalVisionCalls}  ` +
        `(~$${(totalVisionCalls * COST_PER_PAGE).toFixed(2)} at Sonnet 4.6, rough estimate)`,
    );
  }
  // pdfjs/pdf-to-img can leave a worker handle open; exit explicitly.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
