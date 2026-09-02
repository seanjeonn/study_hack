"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import PdfLink from "@/app/components/PdfLink";
import { useLocale } from "@/app/components/useLocale";
import { groupPdfsBySubject } from "@/lib/grouping";
import { t } from "@/lib/i18n";
import { PdfListResponseSchema, type PdfSummary } from "@/lib/schemas";

/**
 * The app shell: the two destinations plus every PDF in the workspace.
 *
 * The list is fetched on the client rather than rendered in the layout,
 * because a layout does not re-render on a soft navigation — after an upload
 * pushes to the reader, the list would be stale. Refetching on every pathname
 * change keeps it honest without any extra wiring at the upload site.
 *
 * Rendered only when someone is signed in — the layout decides that, so `user`
 * is never null here.
 */
export default function AppSidebar({ user }: { user: { email: string; name?: string } }) {
  const pathname = usePathname();
  const strings = t(useLocale());
  const [pdfs, setPdfs] = useState<PdfSummary[]>([]);
  // The mobile panel is open for one pathname, so navigating closes it without
  // an effect that has to chase the route.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === pathname;
  const groups = groupPdfsBySubject(pdfs);
  // Nothing is filed under a subject yet — keep the plain "PDFs" list.
  const flat = groups.length === 1 && groups[0].subject === "";

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/pdfs");
        if (!res.ok) return;
        // Validate the inbound payload at the boundary before trusting it.
        const parsed = PdfListResponseSchema.parse(await res.json());
        if (active) setPdfs(parsed.pdfs);
      } catch {
        // Keep the previous list — an empty shell is worse than a stale one.
      }
    })();
    return () => {
      active = false;
    };
  }, [pathname]);

  return (
    <aside className="flex shrink-0 flex-col border-b border-[#e6e5e0] bg-[#f7f7f4] md:sticky md:top-0 md:h-screen md:w-60 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between gap-3 px-4 py-4">
        <Link href="/" className="font-mono text-sm font-medium text-[#26251e]">
          study_hack
        </Link>
        <button
          type="button"
          onClick={() => setOpenFor(open ? null : pathname)}
          className="text-sm font-medium text-[#5a5852] transition-colors hover:text-[#26251e] md:hidden"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>

      <div className={`${open ? "flex" : "hidden"} min-h-0 flex-1 flex-col gap-5 pb-4 md:flex`}>
        <nav className="flex flex-col gap-0.5 px-2">
          <NavLink href="/" active={pathname === "/"}>
            Library
          </NavLink>
          <NavLink href="/map" active={pathname === "/map"}>
            Concept map
          </NavLink>
          <NavLink href="/settings" active={pathname === "/settings"}>
            Settings
          </NavLink>
        </nav>

        <div className="flex min-h-0 flex-col gap-1.5">
          {pdfs.length === 0 ? (
            <>
              <SectionLabel>PDFs</SectionLabel>
              <p className="px-4 text-sm text-[#807d72]">No PDFs yet.</p>
            </>
          ) : flat ? (
            <>
              <SectionLabel>PDFs</SectionLabel>
              <div className="flex min-h-0 flex-col overflow-y-auto">
                <PdfList pdfs={pdfs} pathname={pathname} />
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
              {groups.map((group) => (
                <div key={group.subject} className="flex flex-col gap-1.5">
                  <SectionLabel>{group.subject || "Ungrouped"}</SectionLabel>
                  <PdfList pdfs={group.pdfs} pathname={pathname} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-auto flex flex-col gap-1 border-t border-[#e6e5e0] px-4 pt-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.88px] text-[#807d72]">
            {strings.signedInAs}
          </span>
          <span className="truncate text-sm text-[#26251e]" title={user.email}>
            {user.name || user.email}
          </span>
          <button
            type="button"
            onClick={signOut}
            className="self-start text-sm font-medium text-[#5a5852] transition-colors hover:text-[#26251e]"
          >
            {strings.signOut}
          </button>
        </div>
      </div>
    </aside>
  );
}

/**
 * Sign out, then reload the whole document rather than routing.
 *
 * The sidebar itself is rendered by the layout off the session, and a soft
 * navigation would leave it — and the name in it — on screen after the session
 * file is gone. A failed request still sends the browser to /login: the page
 * gate reads the file for itself, so the worst case is one bounce back here.
 */
async function signOut() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    window.location.href = "/login";
  }
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="truncate px-4 text-[11px] font-semibold uppercase tracking-[0.88px] text-[#807d72]">
      {children}
    </span>
  );
}

function PdfList({ pdfs, pathname }: { pdfs: PdfSummary[]; pathname: string }) {
  return (
    <ul className="flex flex-col gap-0.5 px-2">
      {pdfs.map((pdf) => (
        <li key={pdf.id}>
          <PdfLink
            id={pdf.id}
            className={`block truncate rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
              pathname === `/pdfs/${pdf.id}`
                ? "bg-[#efeee8] text-[#26251e]"
                : "text-[#5a5852] hover:bg-[#efeee8] hover:text-[#26251e]"
            }`}
          >
            {pdf.filename}
          </PdfLink>
        </li>
      ))}
    </ul>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-[#efeee8] text-[#26251e]"
          : "text-[#5a5852] hover:bg-[#efeee8] hover:text-[#26251e]"
      }`}
    >
      {children}
    </Link>
  );
}
