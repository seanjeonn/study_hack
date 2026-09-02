import { notFound } from "next/navigation";
import PdfReader from "@/app/components/PdfReader";
import SubjectField from "@/app/components/SubjectField";
import { getPdfDetail } from "@/lib/server/pdfStore";
import { requireSession } from "@/lib/server/session";
import { listSubjects } from "@/lib/server/subjects";
import { isValidId } from "@/lib/server/workspace";

export default async function PdfPage({ params }: PageProps<"/pdfs/[id]">) {
  await requireSession();
  const { id } = await params;
  if (!isValidId(id)) notFound();
  const detail = await getPdfDetail(id);
  if (!detail) notFound();
  const subjects = await listSubjects();

  return (
    <main className="flex flex-col px-6 py-12 lg:h-screen lg:overflow-hidden lg:py-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 lg:min-h-0 lg:flex-1 lg:gap-4">
        <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="truncate text-2xl font-normal tracking-tight">
              {detail.summary.filename}
            </h1>
            <p className="font-mono text-xs text-[#807d72]">{detail.summary.id}</p>
          </div>
          <SubjectField
            pdfId={detail.summary.id}
            subject={detail.summary.subject}
            subjects={subjects}
          />
        </header>

        <PdfReader summary={detail.summary} extraction={detail.extraction} />
      </div>
    </main>
  );
}
