"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PdfListResponseSchema, type PdfListItem, type PdfStatus } from "@study-hack/shared";
import { authClient } from "../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const STATUS_LABEL: Record<PdfStatus, string> = {
  uploaded: "Uploaded",
  processing: "Processing",
  text_ready: "Ready",
  failed: "Failed",
};

export default function Home() {
  const router = useRouter();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [pdfs, setPdfs] = useState<PdfListItem[]>([]);

  // Redirect to the login page when there is no active session.
  useEffect(() => {
    if (!sessionPending && !session) router.replace("/login");
  }, [session, sessionPending, router]);

  // Load the caller's documents once a session is active.
  useEffect(() => {
    if (!session) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/pdf`, { credentials: "include" });
        if (!res.ok) return;
        // Validate the inbound payload at the boundary before trusting it.
        const parsed = PdfListResponseSchema.parse(await res.json());
        if (active) setPdfs(parsed.pdfs);
      } catch {
        // leave the list empty; the empty state renders instead
      }
    })();
    return () => {
      active = false;
    };
  }, [session]);

  async function handleSignOut() {
    await authClient.signOut();
    router.replace("/login");
  }

  // Hold rendering until the session resolves; the effect above redirects
  // unauthenticated visitors to /login.
  if (sessionPending || !session) return null;

  return (
    <main className="min-h-screen bg-[#f7f7f4] px-6 py-16 text-[#26251e]">
      <div className="mx-auto flex max-w-3xl flex-col gap-10">
        <header className="flex items-center justify-between gap-4 border-b border-[#e6e5e0] pb-4">
          <h1 className="text-3xl font-normal tracking-tight">My documents</h1>
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-sm text-[#5a5852]" title={session.user.email}>
              {session.user.email}
            </span>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="shrink-0 rounded-md border border-[#cfcdc4] px-3 py-1.5 text-sm text-[#26251e] transition-colors hover:bg-[#efeee8]"
            >
              Sign out
            </button>
          </div>
        </header>

        {pdfs.length > 0 ? (
          <section className="flex flex-col gap-3">
            <Link
              href="/pdf"
              className="self-end text-sm font-medium text-[#f54e00] hover:underline"
            >
              Upload a PDF →
            </Link>
            {pdfs.map((pdf) => (
              <Link
                key={pdf.id}
                href={`/pdf?id=${pdf.id}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-[#e6e5e0] bg-white px-5 py-4 transition-colors hover:bg-[#fafaf7]"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span
                    className="truncate text-sm font-medium text-[#26251e]"
                    title={pdf.filename}
                  >
                    {pdf.filename}
                  </span>
                  <span className="text-xs text-[#807d72]">
                    {pdf.pageCount} {pdf.pageCount === 1 ? "page" : "pages"} ·{" "}
                    {new Date(pdf.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <span className="shrink-0 rounded-full bg-[#efeee8] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.88px] text-[#807d72]">
                  {STATUS_LABEL[pdf.status]}
                </span>
              </Link>
            ))}
          </section>
        ) : (
          <section className="flex flex-col items-center gap-4 rounded-xl border border-[#e6e5e0] bg-white px-8 py-14 text-center">
            <p className="text-sm text-[#5a5852]">No documents yet — upload your first PDF.</p>
            <Link href="/pdf" className="text-sm font-medium text-[#f54e00] hover:underline">
              Upload a PDF →
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}
