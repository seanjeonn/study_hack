"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import {
  AskResponseSchema,
  ExtractionReportSchema,
  MemoSchema,
  PageTextResponseSchema,
  PdfStatusResponseSchema,
  PdfUploadResponseSchema,
  QuizAttemptsResponseSchema,
  QuizGenerateResponseSchema,
  QuizListResponseSchema,
  QuizSubmitResponseSchema,
  StudyLogResponseSchema,
  type AskResponse,
  type ExtractionReport,
  type PageTextResponse,
  type PdfStatus,
  type PdfUploadResponse,
  type QuizQuestion,
  type QuizResultItem,
  type StudyLogItem,
} from "@study-hack/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const STATUS_LABEL: Record<PdfStatus, string> = {
  uploaded: "텍스트 추출 대기 중…",
  processing: "텍스트 추출 중…",
  text_ready: "텍스트 준비됨",
  failed: "텍스트 추출 실패",
};

const RECOMMENDATION_LABEL: Record<ExtractionReport["recommendation"], string> = {
  ok: "추출 품질 양호",
  consider_ocr: "OCR 고려 (텍스트가 거의 없는 페이지 많음)",
  consider_llm_or_ocr: "OCR/LLM 고려 (텍스트 깨짐 의심)",
};

export default function PdfStudio() {
  const [doc, setDoc] = useState<PdfUploadResponse | null>(null);
  const [status, setStatus] = useState<PdfStatus | null>(null);
  const [report, setReport] = useState<ExtractionReport | null>(null);
  const [pageText, setPageText] = useState<PageTextResponse | null>(null);
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askQuestion, setAskQuestion] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [askAnswer, setAskAnswer] = useState<AskResponse | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [quizResults, setQuizResults] = useState<Record<string, QuizResultItem> | null>(null);
  const [quizScore, setQuizScore] = useState<{ correctCount: number; total: number } | null>(null);
  const [quizSubmitting, setQuizSubmitting] = useState(false);
  const [retryWrongOnly, setRetryWrongOnly] = useState(false);
  const [memoDraft, setMemoDraft] = useState("");
  const [memoSaving, setMemoSaving] = useState(false);
  const [studyLog, setStudyLog] = useState<StudyLogItem[]>([]);
  const [studyLogError, setStudyLogError] = useState<string | null>(null);

  // Poll processing status until extraction reaches a terminal state.
  useEffect(() => {
    if (!doc || status === "text_ready" || status === "failed") return;
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`${API_URL}/pdf/${doc.id}`);
        if (!res.ok) return;
        const parsed = PdfStatusResponseSchema.parse(await res.json());
        if (active) setStatus(parsed.status);
      } catch {
        // transient; next tick retries
      }
    };
    void tick();
    const interval = setInterval(tick, 1500);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [doc, status]);

  // Once text is ready, load the quality report (once per document).
  useEffect(() => {
    if (!doc || status !== "text_ready" || report) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/pdf/${doc.id}/extraction-report`);
        if (!res.ok) return;
        const parsed = ExtractionReportSchema.parse(await res.json());
        if (active) setReport(parsed);
      } catch {
        // leave report null; panel just won't show
      }
    })();
    return () => {
      active = false;
    };
  }, [doc, status, report]);

  // Load the current page's extracted text whenever the page or readiness changes.
  useEffect(() => {
    if (!doc || status !== "text_ready") return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/pdf/${doc.id}/pages/${page}/text`);
        if (!res.ok) return;
        const parsed = PageTextResponseSchema.parse(await res.json());
        if (active) setPageText(parsed);
      } catch {
        // leave null
      }
    })();
    return () => {
      active = false;
    };
  }, [doc, status, page]);

  // Once text is ready, restore a previously generated quiz + its graded
  // state (if any) so a page reload doesn't lose progress. Never auto-generates.
  useEffect(() => {
    if (!doc || status !== "text_ready") return;
    let active = true;
    (async () => {
      try {
        const quizRes = await fetch(`${API_URL}/pdf/${doc.id}/quiz`);
        if (!quizRes.ok) return;
        const quizParsed = QuizListResponseSchema.parse(await quizRes.json());
        if (quizParsed.questions.length === 0) return;

        const attemptsRes = await fetch(`${API_URL}/pdf/${doc.id}/quiz/attempts`);
        const attemptsParsed = attemptsRes.ok
          ? QuizAttemptsResponseSchema.parse(await attemptsRes.json())
          : { items: [] };
        if (!active) return;

        setQuizQuestions(quizParsed.questions);
        if (attemptsParsed.items.length > 0) {
          const answers: Record<string, number> = {};
          const results: Record<string, QuizResultItem> = {};
          for (const item of attemptsParsed.items) {
            answers[item.questionId] = item.userAnswer;
            results[item.questionId] = {
              questionId: item.questionId,
              choiceIndex: item.userAnswer,
              correctIndex: item.correctIndex,
              isCorrect: item.isCorrect,
              explanation: item.explanation,
              sourcePageIds: item.sourcePageIds,
            };
          }
          setQuizAnswers(answers);
          setQuizResults(results);
          setQuizScore({
            correctCount: attemptsParsed.items.filter((item) => item.isCorrect).length,
            total: attemptsParsed.items.length,
          });
        }
      } catch {
        // leave quiz state empty; user can generate one manually
      }
    })();
    return () => {
      active = false;
    };
  }, [doc, status]);

  // Once text is ready, load the study log (memos + missed questions).
  useEffect(() => {
    if (!doc || status !== "text_ready") return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/pdf/${doc.id}/study-log`);
        if (!res.ok) return;
        const parsed = StudyLogResponseSchema.parse(await res.json());
        if (active) setStudyLog(parsed.items);
      } catch {
        // leave studyLog empty; panel just won't show entries
      }
    })();
    return () => {
      active = false;
    };
  }, [doc, status]);

  // Re-fetch the study log after a memo is added or deleted (user-triggered,
  // not tied to an effect, so no active-guard is needed here).
  async function refreshStudyLog() {
    if (!doc) return;
    try {
      const res = await fetch(`${API_URL}/pdf/${doc.id}/study-log`);
      if (!res.ok) return;
      const parsed = StudyLogResponseSchema.parse(await res.json());
      setStudyLog(parsed.items);
    } catch {
      // leave the previous study log in place
    }
  }

  async function submitMemo() {
    if (!doc || !memoDraft.trim() || memoSaving) return;
    setMemoSaving(true);
    setStudyLogError(null);
    try {
      const res = await fetch(`${API_URL}/pdf/${doc.id}/memos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: memoDraft.trim(), pageNumber: page }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `failed to save note (${res.status})`);
      }
      // Validate the inbound payload at the boundary before trusting it.
      MemoSchema.parse(await res.json());
      setMemoDraft("");
      await refreshStudyLog();
    } catch (err) {
      setStudyLogError(err instanceof Error ? err.message : "failed to save note");
    } finally {
      setMemoSaving(false);
    }
  }

  async function deleteMemoItem(memoId: string) {
    if (!doc) return;
    setStudyLogError(null);
    try {
      const res = await fetch(`${API_URL}/pdf/${doc.id}/memos/${memoId}`, { method: "DELETE" });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `failed to delete note (${res.status})`);
      }
      await refreshStudyLog();
    } catch (err) {
      setStudyLogError(err instanceof Error ? err.message : "failed to delete note");
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`${API_URL}/pdf`, { method: "POST", body });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `upload failed (${res.status})`);
      }
      // Validate the inbound payload at the boundary before trusting it.
      const parsed = PdfUploadResponseSchema.parse(await res.json());
      setDoc(parsed);
      setStatus("uploaded");
      setReport(null);
      setPageText(null);
      setPage(1);
      setPageLoading(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function submitAsk() {
    if (!doc || !askQuestion.trim() || askLoading) return;
    setAskLoading(true);
    setAskError(null);
    try {
      const res = await fetch(`${API_URL}/pdf/${doc.id}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: askQuestion.trim() }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `ask failed (${res.status})`);
      }
      // Validate the inbound payload at the boundary before trusting it.
      const parsed = AskResponseSchema.parse(await res.json());
      setAskAnswer(parsed);
    } catch (err) {
      setAskError(err instanceof Error ? err.message : "ask failed");
    } finally {
      setAskLoading(false);
    }
  }

  async function generateQuiz() {
    if (!doc || quizLoading) return;
    setQuizLoading(true);
    setQuizError(null);
    try {
      const res = await fetch(`${API_URL}/pdf/${doc.id}/quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 5 }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `quiz generation failed (${res.status})`);
      }
      // Validate the inbound payload at the boundary before trusting it.
      const parsed = QuizGenerateResponseSchema.parse(await res.json());
      setQuizQuestions(parsed.questions);
      setQuizAnswers({});
      setQuizResults(null);
      setQuizScore(null);
      setRetryWrongOnly(false);
    } catch (err) {
      setQuizError(err instanceof Error ? err.message : "quiz generation failed");
    } finally {
      setQuizLoading(false);
    }
  }

  function selectQuizChoice(questionId: string, choiceIndex: number) {
    if (quizResults?.[questionId]) return;
    setQuizAnswers((prev) => ({ ...prev, [questionId]: choiceIndex }));
  }

  async function submitQuiz() {
    if (!doc || quizSubmitting) return;
    const targets = quizQuestions.filter(
      (q) => quizAnswers[q.id] !== undefined && !quizResults?.[q.id],
    );
    if (targets.length === 0) return;
    setQuizSubmitting(true);
    setQuizError(null);
    try {
      const res = await fetch(`${API_URL}/pdf/${doc.id}/quiz/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: targets.map((q) => ({ questionId: q.id, choiceIndex: quizAnswers[q.id] })),
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `quiz grading failed (${res.status})`);
      }
      // Validate the inbound payload at the boundary before trusting it.
      const parsed = QuizSubmitResponseSchema.parse(await res.json());
      const merged = { ...(quizResults ?? {}) };
      for (const result of parsed.results) merged[result.questionId] = result;
      const graded = Object.values(merged);
      setQuizResults(merged);
      setQuizScore({
        correctCount: graded.filter((r) => r.isCorrect).length,
        total: graded.length,
      });
      setRetryWrongOnly(false);
    } catch (err) {
      setQuizError(err instanceof Error ? err.message : "quiz grading failed");
    } finally {
      setQuizSubmitting(false);
    }
  }

  function retryWrong() {
    if (!quizResults) return;
    const wrongIds = Object.values(quizResults)
      .filter((r) => !r.isCorrect)
      .map((r) => r.questionId);
    if (wrongIds.length === 0) return;
    setRetryWrongOnly(true);
    setQuizResults((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      for (const id of wrongIds) delete next[id];
      return next;
    });
    setQuizAnswers((prev) => {
      const next = { ...prev };
      for (const id of wrongIds) delete next[id];
      return next;
    });
  }

  function go(target: number) {
    if (!doc) return;
    const clamped = Math.min(Math.max(target, 1), doc.pageCount);
    if (clamped !== page) {
      setPage(clamped);
      setPageLoading(true);
    }
  }

  function reset() {
    setDoc(null);
    setStatus(null);
    setReport(null);
    setPageText(null);
    setPage(1);
    setError(null);
    setAskQuestion("");
    setAskLoading(false);
    setAskError(null);
    setAskAnswer(null);
    setQuizLoading(false);
    setQuizError(null);
    setQuizQuestions([]);
    setQuizAnswers({});
    setQuizResults(null);
    setQuizScore(null);
    setQuizSubmitting(false);
    setRetryWrongOnly(false);
    setMemoDraft("");
    setMemoSaving(false);
    setStudyLog([]);
    setStudyLogError(null);
  }

  if (!doc) {
    return (
      <section className="flex flex-col items-center gap-5 rounded-xl border border-[#e6e5e0] bg-white px-8 py-14 text-center">
        <p className="text-sm text-[#5a5852]">Choose a PDF file to get started.</p>
        <label className="cursor-pointer rounded-md bg-[#f54e00] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#d04200]">
          {uploading ? "Uploading…" : "Select PDF"}
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={uploading}
            onChange={handleFile}
          />
        </label>
        {error ? <p className="text-sm text-[#cf2d56]">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <p className="truncate text-sm text-[#5a5852]" title={doc.filename}>
            {doc.filename}
          </p>
          {status ? <StatusBadge status={status} /> : null}
        </div>
        <button
          type="button"
          onClick={reset}
          className="shrink-0 rounded-md border border-[#cfcdc4] px-3 py-1.5 text-sm text-[#26251e] transition-colors hover:bg-[#efeee8]"
        >
          New PDF
        </button>
      </div>

      {report ? <ExtractionReportPanel report={report} /> : null}

      {status === "text_ready" ? (
        <div className="flex flex-col gap-3 rounded-xl border border-[#e6e5e0] bg-white p-4">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={askQuestion}
              onChange={(e) => setAskQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitAsk();
              }}
              disabled={askLoading}
              placeholder="Ask a question about this PDF…"
              className="flex-1 rounded-md border border-[#cfcdc4] bg-white px-3 py-2 text-sm text-[#26251e] placeholder:text-[#a09c92] disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void submitAsk()}
              disabled={askLoading || !askQuestion.trim()}
              className="shrink-0 rounded-md bg-[#f54e00] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#d04200] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {askLoading ? "Thinking…" : "Ask"}
            </button>
          </div>
          {askLoading ? (
            <p className="text-sm text-[#807d72]">Thinking…</p>
          ) : askError ? (
            <p className="text-sm text-[#cf2d56]">{askError}</p>
          ) : askAnswer ? (
            <div className="flex flex-col gap-2">
              <p className="whitespace-pre-wrap text-sm text-[#26251e]">{askAnswer.answer}</p>
              {askAnswer.citedPages.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {askAnswer.citedPages.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => go(n)}
                      className="rounded-full border border-[#cfcdc4] px-2.5 py-0.5 text-xs text-[#26251e] transition-colors hover:bg-[#efeee8]"
                    >
                      p.{n}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[#807d72]">No supporting pages cited.</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {status === "text_ready" ? (
        <div className="flex flex-col gap-4 rounded-xl border border-[#e6e5e0] bg-white p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-[#5a5852]">
              {quizScore
                ? `Score: ${quizScore.correctCount} / ${quizScore.total}`
                : "Test yourself with a generated quiz."}
            </p>
            <button
              type="button"
              onClick={() => void generateQuiz()}
              disabled={quizLoading}
              className="shrink-0 rounded-md bg-[#f54e00] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#d04200] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {quizLoading ? "Generating…" : "Generate quiz"}
            </button>
          </div>
          {quizError ? <p className="text-sm text-[#cf2d56]">{quizError}</p> : null}
          {quizQuestions.length > 0 ? (
            <div className="flex flex-col gap-4">
              {quizQuestions.map((q, i) => (
                <QuizQuestionCard
                  key={q.id}
                  index={i}
                  question={q}
                  selected={quizAnswers[q.id]}
                  result={quizResults?.[q.id] ?? null}
                  onSelect={(choiceIndex) => selectQuizChoice(q.id, choiceIndex)}
                  onGoToPage={go}
                />
              ))}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void submitQuiz()}
                  disabled={
                    quizSubmitting ||
                    !quizQuestions.some(
                      (q) => quizAnswers[q.id] !== undefined && !quizResults?.[q.id],
                    )
                  }
                  className="w-fit rounded-md bg-[#f54e00] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#d04200] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {quizSubmitting ? "Grading…" : retryWrongOnly ? "Submit retry" : "Submit"}
                </button>
                {quizResults && Object.values(quizResults).some((r) => !r.isCorrect) ? (
                  <button
                    type="button"
                    onClick={retryWrong}
                    className="w-fit rounded-md border border-[#cfcdc4] px-4 py-2 text-sm text-[#26251e] transition-colors hover:bg-[#efeee8]"
                  >
                    Retry wrong answers
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {status === "text_ready" ? (
        <div className="flex flex-col gap-4 rounded-xl border border-[#e6e5e0] bg-white p-4">
          <div className="flex flex-col gap-2">
            <textarea
              value={memoDraft}
              onChange={(e) => setMemoDraft(e.target.value)}
              disabled={memoSaving}
              placeholder={`Add a note for page ${page}…`}
              rows={3}
              className="w-full resize-none rounded-md border border-[#cfcdc4] bg-white px-3 py-2 text-sm text-[#26251e] placeholder:text-[#a09c92] disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void submitMemo()}
              disabled={memoSaving || !memoDraft.trim()}
              className="w-fit rounded-md bg-[#f54e00] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#d04200] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {memoSaving ? "Saving…" : "Add note"}
            </button>
          </div>

          {studyLogError ? <p className="text-sm text-[#cf2d56]">{studyLogError}</p> : null}

          {studyLog.length > 0 ? (
            <div className="flex flex-col gap-3">
              {studyLog.map((item) =>
                item.kind === "memo" ? (
                  <div
                    key={`memo-${item.id}`}
                    className="flex flex-col gap-2 rounded-xl border border-[#e6e5e0] p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.88px] text-[#807d72]">
                        Note{item.pageNumber !== null ? ` · p.${item.pageNumber}` : ""}
                      </span>
                      <button
                        type="button"
                        onClick={() => void deleteMemoItem(item.id)}
                        aria-label="Delete note"
                        className="text-sm text-[#807d72] transition-colors hover:text-[#cf2d56]"
                      >
                        ×
                      </button>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-[#26251e]">{item.content}</p>
                    {item.pageNumber !== null ? (
                      <button
                        type="button"
                        onClick={() => go(item.pageNumber as number)}
                        className="w-fit rounded-full border border-[#cfcdc4] px-2.5 py-0.5 text-xs text-[#26251e] transition-colors hover:bg-[#efeee8]"
                      >
                        p.{item.pageNumber}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div
                    key={`wrong-${item.questionId}`}
                    className="flex flex-col gap-2 rounded-xl border border-[#f3c3d0] bg-[#fbe6ec] p-3"
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-[0.88px] text-[#cf2d56]">
                      Missed question
                    </span>
                    <p className="text-sm text-[#26251e]">{item.question}</p>
                    <p className="text-sm text-[#5a5852]">
                      Your answer: {item.userAnswerText} / Correct: {item.correctAnswerText}
                    </p>
                    {item.sourcePageIds.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {item.sourcePageIds.map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => go(n)}
                            className="rounded-full border border-[#cfcdc4] px-2.5 py-0.5 text-xs text-[#26251e] transition-colors hover:bg-[#efeee8]"
                          >
                            p.{n}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ),
              )}
            </div>
          ) : (
            <p className="text-sm text-[#807d72]">No notes or missed questions yet.</p>
          )}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="relative flex min-h-[60vh] items-center justify-center overflow-auto rounded-xl border border-[#e6e5e0] bg-white p-4">
          {pageLoading ? (
            <span className="absolute text-sm text-[#807d72]">Rendering page {page}…</span>
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={page}
            src={`${API_URL}/pdf/${doc.id}/pages/${page}`}
            alt={`${doc.filename} — page ${page}`}
            onLoad={() => setPageLoading(false)}
            className="max-w-full"
            style={{ opacity: pageLoading ? 0 : 1 }}
          />
        </div>

        <div className="flex min-h-[60vh] flex-col overflow-hidden rounded-xl border border-[#e6e5e0] bg-white">
          <div className="border-b border-[#efeee8] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.88px] text-[#807d72]">
            추출 텍스트 · 페이지 {page}
          </div>
          <div className="flex-1 overflow-auto p-4">
            <PageTextPanel
              status={status}
              pageText={pageText?.pageNumber === page ? pageText : null}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-6">
        <button
          type="button"
          onClick={() => go(page - 1)}
          disabled={page <= 1}
          className="rounded-md border border-[#cfcdc4] px-4 py-2 text-sm text-[#26251e] transition-colors hover:bg-[#efeee8] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>
        <span className="font-mono text-sm tabular-nums text-[#5a5852]">
          {page} / {doc.pageCount}
        </span>
        <button
          type="button"
          onClick={() => go(page + 1)}
          disabled={page >= doc.pageCount}
          className="rounded-md border border-[#cfcdc4] px-4 py-2 text-sm text-[#26251e] transition-colors hover:bg-[#efeee8] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: PdfStatus }) {
  const tone =
    status === "text_ready"
      ? "bg-[#e6f4ee] text-[#1f8a65]"
      : status === "failed"
        ? "bg-[#fbe6ec] text-[#cf2d56]"
        : "bg-[#efeee8] text-[#807d72]";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.88px] ${tone}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function ExtractionReportPanel({ report }: { report: ExtractionReport }) {
  const tone =
    report.recommendation === "ok"
      ? "border-[#bfe3d3] bg-[#e6f4ee] text-[#1f8a65]"
      : "border-[#e7cfa0] bg-[#f7efe0] text-[#8a6418]";
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#e6e5e0] bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-xs text-[#5a5852]">
        <span>
          텍스트 커버리지 {Math.round(report.hasTextRatio * 100)}% ({report.textPages}/
          {report.pageCount}p)
        </span>
        <span>평균 {Math.round(report.avgCharsPerTextPage)}자/페이지</span>
        <span>깨짐 {Math.round(report.suspiciousRatio * 1000) / 10}%</span>
        {report.suspectPages > 0 ? <span>의심 페이지 {report.suspectPages}개</span> : null}
      </div>
      <span
        className={`w-fit rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.88px] ${tone}`}
      >
        {RECOMMENDATION_LABEL[report.recommendation]}
      </span>
    </div>
  );
}

function QuizQuestionCard({
  index,
  question,
  selected,
  result,
  onSelect,
  onGoToPage,
}: {
  index: number;
  question: QuizQuestion;
  selected: number | undefined;
  result: QuizResultItem | null;
  onSelect: (choiceIndex: number) => void;
  onGoToPage: (n: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[#e6e5e0] p-4">
      <p className="text-sm text-[#26251e]">
        {index + 1}. {question.question}
      </p>
      <div className="flex flex-col gap-2">
        {question.choices.map((choice, choiceIndex) => {
          const isSelected = selected === choiceIndex;
          const isCorrectChoice = result !== null && choiceIndex === result.correctIndex;
          const isWrongSelected =
            result !== null && isSelected && choiceIndex !== result.correctIndex;
          let tone = "border-[#cfcdc4] text-[#26251e]";
          if (isCorrectChoice) {
            tone = "border-[#1f8a65] bg-[#e6f4ee] text-[#1f8a65]";
          } else if (isWrongSelected) {
            tone = "border-[#cf2d56] bg-[#fbe6ec] text-[#cf2d56]";
          } else if (isSelected) {
            tone = "border-[#f54e00] bg-[#fdece4] text-[#26251e]";
          }
          return (
            <button
              key={choiceIndex}
              type="button"
              onClick={() => onSelect(choiceIndex)}
              disabled={result !== null}
              className={`rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed ${tone}`}
            >
              {choice}
            </button>
          );
        })}
      </div>
      {result ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-[#5a5852]">{result.explanation}</p>
          {result.sourcePageIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {result.sourcePageIds.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onGoToPage(n)}
                  className="rounded-full border border-[#cfcdc4] px-2.5 py-0.5 text-xs text-[#26251e] transition-colors hover:bg-[#efeee8]"
                >
                  p.{n}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PageTextPanel({
  status,
  pageText,
}: {
  status: PdfStatus | null;
  pageText: PageTextResponse | null;
}) {
  if (status !== "text_ready") {
    return (
      <p className="text-sm text-[#807d72]">
        {status === "failed" ? "텍스트 추출에 실패했습니다." : "텍스트를 추출하는 중입니다…"}
      </p>
    );
  }
  if (!pageText) {
    return <p className="text-sm text-[#807d72]">이 페이지의 텍스트를 불러오는 중…</p>;
  }
  if (!pageText.hasText) {
    return (
      <p className="text-sm text-[#8a6418]">
        이 페이지에는 추출 가능한 텍스트가 거의 없습니다 (스캔/이미지 — OCR 후보).
      </p>
    );
  }
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-[#26251e]">
      {pageText.text}
    </pre>
  );
}
