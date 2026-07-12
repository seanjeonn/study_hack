import PdfStudio from "./PdfStudio";

export default async function PdfPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  return (
    <main className="min-h-screen bg-[#f7f7f4] px-6 py-16 text-[#26251e]">
      <div className="mx-auto flex max-w-3xl flex-col gap-10">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-normal tracking-tight">PDF reader</h1>
          <p className="text-sm text-[#5a5852]">Upload a PDF and read it one page at a time.</p>
        </header>
        <PdfStudio initialDocId={id} />
      </div>
    </main>
  );
}
