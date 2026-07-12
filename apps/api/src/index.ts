import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import {
  AskRequestSchema,
  AskResponseSchema,
  ExtractionReportSchema,
  HealthResponseSchema,
  MemoCreateRequestSchema,
  MemoListResponseSchema,
  MemoSchema,
  PageTextResponseSchema,
  PdfListResponseSchema,
  PdfStatusResponseSchema,
  PdfUploadResponseSchema,
  QuizAttemptsResponseSchema,
  QuizGenerateRequestSchema,
  QuizGenerateResponseSchema,
  QuizListResponseSchema,
  QuizSubmitRequestSchema,
  QuizSubmitResponseSchema,
  StudyLogResponseSchema,
} from "@study-hack/shared";
import { toNodeHandler } from "better-auth/node";
import { auth, requireAuth, WEB_ORIGIN } from "./auth.js";
import { askPdf } from "./ask.js";
import { LlmError } from "./llm.js";
import { createMemo, deleteMemo, getStudyLog, listMemos } from "./memo.js";
import {
  addPdf,
  getExtractionReport,
  getPageText,
  getPdf,
  getPdfStatus,
  listPdfs,
  renderPage,
} from "./pdfStore.js";
import { generateQuiz, generateRequiz, gradeSubmission, listAttempts, listQuiz } from "./quiz.js";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

app.use(cors({ origin: WEB_ORIGIN, credentials: true }));

// better-auth owns /api/auth/*. Must be mounted BEFORE express.json() —
// the handler reads the raw body itself (official better-auth requirement).
// `{*any}` is the Express 5 named-wildcard syntax.
app.all("/api/auth/{*any}", toNodeHandler(auth));

app.use(express.json());

// Everything under /pdf requires a session (login-required policy, slice 8).
app.use("/pdf", requireAuth);

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

// The caller's PDFs, newest first (my-documents list, slice 8).
app.get("/pdf", async (_req, res) => {
  const userId = res.locals.userId as string;
  const result = await listPdfs(userId);
  res.json(PdfListResponseSchema.parse(result));
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
      const userId = res.locals.userId as string;
      const result = await addPdf(req.file.buffer, req.file.originalname, userId);
      // Validate the outbound payload at the boundary before returning it.
      const payload = PdfUploadResponseSchema.parse(result);
      res.status(201).json(payload);
    } catch {
      // Note: this also catches DB insert failures, which would be reported as
      // a parse error. Acceptable for the MVP — revisit if DB errors need to be
      // distinguished from malformed PDFs.
      res.status(400).json({ error: "failed to parse the uploaded PDF" });
    }
  });
});

// PDF metadata + processing status, for the web client to poll extraction progress.
app.get("/pdf/:id", async (req, res) => {
  const userId = res.locals.userId as string;
  const status = await getPdfStatus(req.params.id, userId);
  if (!status) {
    res.status(404).json({ error: "pdf not found" });
    return;
  }
  const payload = PdfStatusResponseSchema.parse(status);
  res.json(payload);
});

// Extraction-quality report aggregated from the page texts.
app.get("/pdf/:id/extraction-report", async (req, res) => {
  const userId = res.locals.userId as string;
  const report = await getExtractionReport(req.params.id, userId);
  if (!report) {
    res.status(404).json({ error: "pdf not found" });
    return;
  }
  const payload = ExtractionReportSchema.parse(report);
  res.json(payload);
});

// Full-context Q&A over the PDF's extracted text (quality probe — small PDFs only).
app.post("/pdf/:id/ask", async (req, res) => {
  const userId = res.locals.userId as string;
  let body;
  try {
    body = AskRequestSchema.parse(req.body);
  } catch {
    res.status(400).json({ error: "invalid request body" });
    return;
  }
  const status = await getPdfStatus(req.params.id, userId);
  if (!status) {
    res.status(404).json({ error: "pdf not found" });
    return;
  }
  try {
    const result = await askPdf(req.params.id, body.question);
    // Validate the outbound payload at the boundary before returning it.
    res.json(AskResponseSchema.parse(result));
  } catch (err) {
    if (err instanceof LlmError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(`[ask] pdf=${req.params.id} failed:`, err);
    res.status(502).json({ error: "ask failed" });
  }
});

// Generate MCQ quiz questions grounded in the PDF's extracted text (page citations).
app.post("/pdf/:id/quiz", async (req, res) => {
  const userId = res.locals.userId as string;
  let body;
  try {
    body = QuizGenerateRequestSchema.parse(req.body);
  } catch {
    res.status(400).json({ error: "invalid request body" });
    return;
  }
  const status = await getPdfStatus(req.params.id, userId);
  if (!status) {
    res.status(404).json({ error: "pdf not found" });
    return;
  }
  if (status.status !== "text_ready") {
    res.status(409).json({ error: "page text is not ready for this PDF" });
    return;
  }
  try {
    const result = await generateQuiz(req.params.id, body.count, userId);
    // Validate the outbound payload at the boundary before returning it.
    res.json(QuizGenerateResponseSchema.parse(result));
  } catch (err) {
    if (err instanceof LlmError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(`[quiz] pdf=${req.params.id} failed:`, err);
    res.status(502).json({ error: "quiz generation failed" });
  }
});

// Previously generated quiz questions for a PDF. Answers are withheld —
// grading happens server-side via POST /pdf/:id/quiz/submit (slice 5).
app.get("/pdf/:id/quiz", async (req, res) => {
  const userId = res.locals.userId as string;
  const status = await getPdfStatus(req.params.id, userId);
  if (!status) {
    res.status(404).json({ error: "pdf not found" });
    return;
  }
  const result = await listQuiz(req.params.id);
  res.json(QuizListResponseSchema.parse(result));
});

// Grade a set of submitted quiz answers server-side and reveal the correct
// answer + explanation only for the submitted questions.
app.post("/pdf/:id/quiz/submit", async (req, res) => {
  const userId = res.locals.userId as string;
  let body;
  try {
    body = QuizSubmitRequestSchema.parse(req.body);
  } catch {
    res.status(400).json({ error: "invalid request body" });
    return;
  }
  const status = await getPdfStatus(req.params.id, userId);
  if (!status) {
    res.status(404).json({ error: "pdf not found" });
    return;
  }
  try {
    const result = await gradeSubmission(req.params.id, body.answers, userId);
    // Validate the outbound payload at the boundary before returning it.
    res.json(QuizSubmitResponseSchema.parse(result));
  } catch (err) {
    if (err instanceof LlmError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(`[grade] pdf=${req.params.id} failed:`, err);
    res.status(502).json({ error: "grading failed" });
  }
});

// Weakness-based re-quiz: generate new questions covering the same concepts
// as the learner's most recently missed questions, closing the study loop.
app.post("/pdf/:id/quiz/requiz", async (req, res) => {
  const userId = res.locals.userId as string;
  const status = await getPdfStatus(req.params.id, userId);
  if (!status) {
    res.status(404).json({ error: "pdf not found" });
    return;
  }
  if (status.status !== "text_ready") {
    res.status(409).json({ error: "page text is not ready for this PDF" });
    return;
  }
  try {
    const result = await generateRequiz(req.params.id, userId);
    // Validate the outbound payload at the boundary before returning it.
    res.json(QuizGenerateResponseSchema.parse(result));
  } catch (err) {
    if (err instanceof LlmError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(`[requiz] pdf=${req.params.id} failed:`, err);
    res.status(502).json({ error: "re-quiz failed" });
  }
});

// Latest graded attempt per question for a PDF's quiz, so the client can
// restore prior graded state (e.g. after a page reload).
app.get("/pdf/:id/quiz/attempts", async (req, res) => {
  const userId = res.locals.userId as string;
  const status = await getPdfStatus(req.params.id, userId);
  if (!status) {
    res.status(404).json({ error: "pdf not found" });
    return;
  }
  const result = await listAttempts(req.params.id);
  res.json(QuizAttemptsResponseSchema.parse(result));
});

// Create a user-authored memo for a PDF, optionally attached to a viewer page.
app.post("/pdf/:id/memos", async (req, res) => {
  const userId = res.locals.userId as string;
  let body;
  try {
    body = MemoCreateRequestSchema.parse(req.body);
  } catch {
    res.status(400).json({ error: "invalid request body" });
    return;
  }
  const status = await getPdfStatus(req.params.id, userId);
  if (!status) {
    res.status(404).json({ error: "pdf not found" });
    return;
  }
  try {
    const result = await createMemo(req.params.id, body.content, body.pageNumber, userId);
    // Validate the outbound payload at the boundary before returning it.
    res.status(201).json(MemoSchema.parse(result));
  } catch (err) {
    console.error(`[memo] pdf=${req.params.id} failed:`, err);
    res.status(502).json({ error: "failed to create memo" });
  }
});

// All memos for a PDF.
app.get("/pdf/:id/memos", async (req, res) => {
  const userId = res.locals.userId as string;
  const status = await getPdfStatus(req.params.id, userId);
  if (!status) {
    res.status(404).json({ error: "pdf not found" });
    return;
  }
  const result = await listMemos(req.params.id);
  res.json(MemoListResponseSchema.parse(result));
});

// Delete a single memo.
app.delete("/pdf/:id/memos/:memoId", async (req, res) => {
  const userId = res.locals.userId as string;
  const status = await getPdfStatus(req.params.id, userId);
  if (!status) {
    res.status(404).json({ error: "pdf not found" });
    return;
  }
  const ok = await deleteMemo(req.params.id, req.params.memoId);
  if (!ok) {
    res.status(404).json({ error: "memo not found" });
    return;
  }
  res.status(204).end();
});

// Study log: memos and previously-missed quiz questions, newest first.
app.get("/pdf/:id/study-log", async (req, res) => {
  const userId = res.locals.userId as string;
  const status = await getPdfStatus(req.params.id, userId);
  if (!status) {
    res.status(404).json({ error: "pdf not found" });
    return;
  }
  const result = await getStudyLog(req.params.id);
  res.json(StudyLogResponseSchema.parse(result));
});

// Extracted text for a single page (n is 1-indexed). 404 until extraction runs.
app.get("/pdf/:id/pages/:n/text", async (req, res) => {
  const userId = res.locals.userId as string;
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 1) {
    res.status(400).json({ error: "page out of range" });
    return;
  }
  const status = await getPdfStatus(req.params.id, userId);
  if (!status) {
    res.status(404).json({ error: "pdf not found" });
    return;
  }
  const pageText = await getPageText(req.params.id, n);
  if (!pageText) {
    res.status(404).json({ error: "page text not found" });
    return;
  }
  const payload = PageTextResponseSchema.parse(pageText);
  res.json(payload);
});

// Serve a single page as a PNG image (n is 1-indexed).
app.get("/pdf/:id/pages/:n", async (req, res) => {
  const userId = res.locals.userId as string;
  const entry = await getPdf(req.params.id, userId);
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

app.listen(PORT, () => {
  console.log(`api listening on http://localhost:${PORT}`);
});
