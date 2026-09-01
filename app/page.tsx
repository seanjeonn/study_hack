import PdfLink from "@/app/components/PdfLink";
import UploadButton from "@/app/components/UploadButton";
import { groupPdfsBySubject, subjectsOf } from "@/lib/grouping";
import type { PdfSummary } from "@/lib/schemas";
import { listPdfs } from "@/lib/server/pdfStore";
import { WORKSPACE_ROOT } from "@/lib/server/workspace";

export default async function LibraryPage() {
  const pdfs = await listPdfs();
  const groups = groupPdfsBySubject(pdfs);
  // Nothing is filed under a subject yet — show the plain list, not one section
  // headed "Ungrouped".
  const flat = groups.length === 1 && groups[0].subject === "";

  return (
    <main className="px-6 py-16">
      <div className="mx-auto flex max-w-3xl flex-col gap-10">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-normal tracking-tight">Library</h1>
          <p className="text-sm text-[#5a5852]">
            Your PDFs and notes live in{" "}
            <code className="font-mono text-[13px] text-[#26251e]">{WORKSPACE_ROOT}</code> — plain
            files you can open in any editor.
          </p>
        </header>

        <UploadButton subjects={subjectsOf(pdfs)} />

        {pdfs.length === 0 ? (
          <p className="rounded-xl border border-[#e6e5e0] bg-white px-6 py-12 text-center text-sm text-[#807d72]">
            No PDFs yet. Upload one to get started.
          </p>
        ) : flat ? (
          <PdfCards pdfs={pdfs} />
        ) : (
          <div className="flex flex-col gap-8">
            {groups.map((group) => (
              <section key={group.subject} className="flex flex-col gap-3">
                <h2 className="text-[22px] font-normal leading-[1.3] tracking-[-0.11px] text-[#26251e]">
                  {group.subject || "Ungrouped"}
                </h2>
                <PdfCards pdfs={group.pdfs} />
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function PdfCards({ pdfs }: { pdfs: PdfSummary[] }) {
  return (
    <ul className="flex flex-col divide-y divide-[#efeee8] overflow-hidden rounded-xl border border-[#e6e5e0] bg-white">
      {pdfs.map((pdf) => (
        <li key={pdf.id}>
          <PdfLink
            id={pdf.id}
            className="flex items-center justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-[#f7f7f4]"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm text-[#26251e]">{pdf.filename}</span>
              <span className="font-mono text-xs text-[#807d72]">{pdf.id}</span>
            </span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-[#807d72]">
              {pdf.pageCount}p
            </span>
          </PdfLink>
        </li>
      ))}
    </ul>
  );
}
