import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { and, count, eq } from "drizzle-orm";
import {
  HealthResponseSchema,
  PdfPageTextSchema,
  PdfStatusResponseSchema,
  PdfUploadResponseSchema,
} from "@study-hack/shared";
import { db } from "./db/client.js";
import { pdf, pdfPage } from "./db/schema.js";
import { addPdf, getPdf, renderPage } from "./pdfStore.js";
import { runExtraction } from "./extractionPipeline.js";

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

// Upload a PDF, parse it, and return its id + page count.
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
      const payload = PdfUploadResponseSchema.parse(result);
      res.status(201).json(payload);
      // Kick off per-page text + vision extraction in the background; the upload
      // response has already been sent, so the 201 stays instant. Progress is
      // observable via GET /pdf/:id/status.
      void runExtraction(result.id);
    } catch {
      // Note: this also catches DB insert failures, which would be reported as
      // a parse error. Acceptable for the MVP — revisit if DB errors need to be
      // distinguished from malformed PDFs.
      res.status(400).json({ error: "failed to parse the uploaded PDF" });
    }
  });
});

// Serve a single page as a PNG image (n is 1-indexed).
app.get("/pdf/:id/pages/:n", async (req, res) => {
  const entry = await getPdf(req.params.id);
  if (!entry) {
    res.status(404).json({ error: "pdf not found" });
    return;
  }
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 1 || n > entry.pageCount) {
    res.status(400).json({ error: "page out of range" });
    return;
  }
  const image = await renderPage(req.params.id, n);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.end(image);
});

// Extraction progress for a PDF — the web client polls this until `text_ready`.
app.get("/pdf/:id/status", async (req, res) => {
  const [meta] = await db
    .select({ status: pdf.status, pageCount: pdf.pageCount })
    .from(pdf)
    .where(eq(pdf.id, req.params.id))
    .limit(1);
  if (!meta) {
    res.status(404).json({ error: "pdf not found" });
    return;
  }
  const [counted] = await db
    .select({ value: count() })
    .from(pdfPage)
    .where(eq(pdfPage.pdfId, req.params.id));
  // parse() is the validation boundary: `status` is a free-text column, so this
  // rejects any value outside the known lifecycle.
  const payload = PdfStatusResponseSchema.parse({
    id: req.params.id,
    status: meta.status,
    pageCount: meta.pageCount,
    pagesExtracted: counted.value,
  });
  res.json(payload);
});

// Merged per-page extracted text (vision transcription, or the text layer when
// vision was skipped/failed). n is 1-indexed.
app.get("/pdf/:id/pages/:n/text", async (req, res) => {
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 1) {
    res.status(400).json({ error: "page out of range" });
    return;
  }
  const [row] = await db
    .select()
    .from(pdfPage)
    .where(and(eq(pdfPage.pdfId, req.params.id), eq(pdfPage.pageNumber, n)))
    .limit(1);
  if (!row) {
    // No row yet means either an unknown id or extraction has not reached this
    // page — the client should poll /status to tell them apart.
    res.status(404).json({ error: "page text not found" });
    return;
  }
  const payload = PdfPageTextSchema.parse({
    pageNumber: row.pageNumber,
    hasText: row.hasText,
    visionUsed: row.visionUsed,
    content: row.content,
    textLayerText: row.textLayerText,
  });
  res.json(payload);
});

// Manually (re)run extraction — covers a process restart mid-job or re-running
// after tuning. Idempotent: each page is upserted.
app.post("/pdf/:id/extract", async (req, res) => {
  const [meta] = await db
    .select({ pageCount: pdf.pageCount })
    .from(pdf)
    .where(eq(pdf.id, req.params.id))
    .limit(1);
  if (!meta) {
    res.status(404).json({ error: "pdf not found" });
    return;
  }
  void runExtraction(req.params.id);
  const payload = PdfStatusResponseSchema.parse({
    id: req.params.id,
    status: "processing",
    pageCount: meta.pageCount,
    pagesExtracted: 0,
  });
  res.status(202).json(payload);
});

app.listen(PORT, () => {
  console.log(`api listening on http://localhost:${PORT}`);
});
