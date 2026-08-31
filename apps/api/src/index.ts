import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import {
  ExtractionReportSchema,
  HealthResponseSchema,
  PageNoteResponseSchema,
  PageNoteUpdateRequestSchema,
  PageTextResponseSchema,
  PdfListResponseSchema,
  PdfSummarySchema,
} from "@study-hack/shared";
import { readPageNote, writePageNote } from "./notes.js";
import {
  addPdf,
  getExtractionReport,
  getPageText,
  getPdfSummary,
  listPdfs,
  renderPage,
} from "./pdfStore.js";
import { isValidId, isValidPageNumber } from "./workspace.js";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json());

const uploadSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (_req, file, cb) => {
    // The browser-provided mimetype is unreliable — many environments send a
    // .pdf as "application/octet-stream" or an empty type — so accept by
    // mimetype OR a .pdf extension. The %PDF magic bytes are validated below.
    const accepted =
      file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");
    cb(null, accepted);
  },
}).single("file");

/**
 * Resolve `:id` and `:n` against the workspace, answering with the right status
 * for each failure mode: a malformed id or page number is a 400 (this is where
 * a path-traversal attempt is stopped), a missing PDF or out-of-range page is
 * a 404.
 */
async function resolvePage(
  id: string,
  rawPage: string,
): Promise<{ pageNumber: number } | { status: number; error: string }> {
  if (!isValidId(id)) return { status: 400, error: "invalid pdf id" };
  const summary = await getPdfSummary(id);
  if (!summary) return { status: 404, error: "pdf not found" };
  const pageNumber = Number(rawPage);
  if (!isValidPageNumber(pageNumber, summary.pageCount)) {
    return { status: 400, error: "page out of range" };
  }
  return { pageNumber };
}

app.get("/health", (_req, res) => {
  // Validate the outbound payload against the shared schema at the boundary
  // before returning it to the client (zod SSOT in @study-hack/shared).
  const payload = HealthResponseSchema.parse({
    status: "ok",
    service: "api",
    time: new Date().toISOString(),
  });
  res.json(payload);
});

// Every PDF in the workspace.
app.get("/pdfs", async (_req, res) => {
  const payload = PdfListResponseSchema.parse({ pdfs: await listPdfs() });
  res.json(payload);
});

// Upload a PDF. Text extraction runs synchronously, so a 201 means the PDF is
// fully indexed and immediately readable.
app.post("/pdf", (req, res) => {
  uploadSingle(req, res, async (err) => {
    if (err) {
      // multer surfaces size-limit and other upload failures here.
      const message = err instanceof multer.MulterError ? err.message : "upload failed";
      res.status(400).json({ error: message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "expected a PDF file in the 'file' field" });
      return;
    }
    // Authoritative content check at the boundary (mimetype can lie).
    if (req.file.buffer.subarray(0, 4).toString("latin1") !== "%PDF") {
      res.status(400).json({ error: "the uploaded file is not a valid PDF" });
      return;
    }
    try {
      const result = await addPdf(req.file.buffer, req.file.originalname);
      // Validate the outbound payload at the boundary before returning it.
      res.status(201).json(PdfSummarySchema.parse(result));
    } catch (error) {
      console.error("[upload] failed:", error);
      res.status(400).json({ error: "failed to parse the uploaded PDF" });
    }
  });
});

// Extraction-quality report, computed once at index time and read from meta.json.
app.get("/pdf/:id/extraction-report", async (req, res) => {
  if (!isValidId(req.params.id)) {
    res.status(400).json({ error: "invalid pdf id" });
    return;
  }
  const report = await getExtractionReport(req.params.id);
  if (!report) {
    res.status(404).json({ error: "pdf not found" });
    return;
  }
  res.json(ExtractionReportSchema.parse(report));
});

// Extracted text for a single page (n is 1-indexed).
app.get("/pdf/:id/pages/:n/text", async (req, res) => {
  const resolved = await resolvePage(req.params.id, req.params.n);
  if ("status" in resolved) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const pageText = await getPageText(req.params.id, resolved.pageNumber);
  if (!pageText) {
    res.status(404).json({ error: "page text not found" });
    return;
  }
  res.json(PageTextResponseSchema.parse(pageText));
});

// The user's note for a single page, as markdown. Always read fresh from disk
// so an edit made outside the app (Obsidian, an editor, git) is respected.
app.get("/pdf/:id/pages/:n/note", async (req, res) => {
  const resolved = await resolvePage(req.params.id, req.params.n);
  if ("status" in resolved) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const content = await readPageNote(req.params.id, resolved.pageNumber);
  res.json(PageNoteResponseSchema.parse({ pageNumber: resolved.pageNumber, content }));
});

app.put("/pdf/:id/pages/:n/note", async (req, res) => {
  const resolved = await resolvePage(req.params.id, req.params.n);
  if ("status" in resolved) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const body = PageNoteUpdateRequestSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "invalid request body" });
    return;
  }
  await writePageNote(req.params.id, resolved.pageNumber, body.data.content);
  res.json(
    PageNoteResponseSchema.parse({ pageNumber: resolved.pageNumber, content: body.data.content }),
  );
});

// Serve a single page as a PNG image (n is 1-indexed).
app.get("/pdf/:id/pages/:n", async (req, res) => {
  const resolved = await resolvePage(req.params.id, req.params.n);
  if ("status" in resolved) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const image = await renderPage(req.params.id, resolved.pageNumber);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.end(image);
});

app.listen(PORT, () => {
  console.log(`api listening on http://localhost:${PORT}`);
});
