import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { HealthResponseSchema, PdfUploadResponseSchema } from "@study-hack/shared";
import { addPdf, getEntry, renderPage } from "./pdfStore.js";

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
    } catch {
      res.status(400).json({ error: "failed to parse the uploaded PDF" });
    }
  });
});

// Serve a single page as a PNG image (n is 1-indexed).
app.get("/pdf/:id/pages/:n", async (req, res) => {
  const entry = getEntry(req.params.id);
  if (!entry) {
    res.status(404).json({ error: "pdf not found" });
    return;
  }
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 1 || n > entry.pageCount) {
    res.status(400).json({ error: "page out of range" });
    return;
  }
  const image = await renderPage(entry, n);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.end(image);
});

app.listen(PORT, () => {
  console.log(`api listening on http://localhost:${PORT}`);
});
