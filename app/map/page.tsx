import ConceptMap from "@/app/components/ConceptMap";

export default function MapPage() {
  return (
    <main className="px-6 py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-normal tracking-tight">Concept map</h1>
            <p className="text-sm text-[#5a5852]">
              Concepts your PDFs share. Each one is a markdown file you can edit.
            </p>
          </div>
        </header>
        <ConceptMap />
      </div>
    </main>
  );
}
