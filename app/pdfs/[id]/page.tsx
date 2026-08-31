import Link from "next/link";
import { notFound } from "next/navigation";
import PdfReader from "@/app/components/PdfReader";
import { getPdfDetail } from "@/lib/server/pdfStore";
import { isValidId } from "@/lib/server/workspace";

export default async function PdfPage({ params }: PageProps<"/pdfs/[id]">) {
  const { id } = await params;
  if (!isValidId(id)) notFound();
  const detail = await getPdfDetail(id);
  if (!detail) notFound();

  return (
    <main className="min-h-screen bg-[#f7f7f4] px-6 py-12 text-[#26251e]">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="truncate text-2xl font-normal tracking-tight">
              {detail.summary.filename}
            </h1>
            <p className="font-mono text-xs text-[#807d72]">{detail.summary.id}</p>
          </div>
          <div className="flex items-baseline gap-5">
            <Link href="/map" className="text-sm font-medium text-[#f54e00] hover:underline">
              Concept map
            </Link>
            <Link href="/" className="text-sm font-medium text-[#f54e00] hover:underline">
              ← Library
            </Link>
          </div>
        </header>

        <PdfReader summary={detail.summary} extraction={detail.extraction} />
      </div>
    </main>
  );
}
