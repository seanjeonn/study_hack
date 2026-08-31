import type { ExtractionReport } from "@/lib/schemas";

const RECOMMENDATION_LABEL: Record<ExtractionReport["recommendation"], string> = {
  ok: "Extraction quality looks good",
  consider_ocr: "Consider OCR (many pages have little or no text)",
  consider_llm_or_ocr: "Consider OCR/LLM (text may be garbled)",
};

export default function ExtractionReportPanel({ report }: { report: ExtractionReport }) {
  const tone =
    report.recommendation === "ok"
      ? "border-[#bfe3d3] bg-[#e6f4ee] text-[#1f8a65]"
      : "border-[#e7cfa0] bg-[#f7efe0] text-[#8a6418]";
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#e6e5e0] bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-xs text-[#5a5852]">
        <span>
          Text coverage {Math.round(report.hasTextRatio * 100)}% ({report.textPages}/
          {report.pageCount}p)
        </span>
        <span>Avg {Math.round(report.avgCharsPerTextPage)} chars/page</span>
        <span>Garbled {Math.round(report.suspiciousRatio * 1000) / 10}%</span>
        {report.suspectPages > 0 ? <span>{report.suspectPages} suspect pages</span> : null}
      </div>
      <span
        className={`w-fit rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.88px] ${tone}`}
      >
        {RECOMMENDATION_LABEL[report.recommendation]}
      </span>
    </div>
  );
}
