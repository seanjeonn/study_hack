import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#f7f6f2] p-16 font-sans">
      <h1 className="text-3xl font-semibold tracking-tight text-[#26251e]">study_hack</h1>
      <p className="max-w-md text-center text-sm text-[#5a5852]">
        Read a PDF, keep a note on every page, and own every file it writes.
      </p>
      <Link href="/pdf" className="text-sm font-medium text-[#f54e00] hover:underline">
        Open the PDF reader →
      </Link>
    </main>
  );
}
