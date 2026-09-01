"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { readLastPage } from "@/lib/lastPage";

/** localStorage is read, never subscribed to — the value only matters at render. */
const noopSubscribe = () => () => {};

/**
 * A link to a PDF that resumes where the reader left off. The server render and
 * the hydration render both see no remembered page (bare href) and the client
 * snapshot upgrades the link right after, so there is no hydration mismatch.
 */
export default function PdfLink({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: React.ReactNode;
}) {
  const page = useSyncExternalStore(
    noopSubscribe,
    () => readLastPage(id),
    () => null,
  );

  const href = page ? `/pdfs/${id}?page=${page}` : `/pdfs/${id}`;

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
