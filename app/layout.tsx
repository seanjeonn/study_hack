import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import AppSidebar from "@/app/components/AppSidebar";
import { readSession } from "@/lib/server/session";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "study_hack",
  description: "Read PDFs, keep a note on every page, and own every file it writes.",
};

/**
 * Nothing under this layout may be prerendered.
 *
 * Two reasons, and the first one predates sign-in: the library page reads the
 * workspace, so a build-time render baked "No PDFs yet" into the shipped
 * tarball and the page never changed after an upload. The second is the gate —
 * a session check that runs at build time is a session check that has already
 * decided, at build time, that nobody is signed in.
 *
 * Set once here rather than on each page: route segment config applies to the
 * whole subtree, and one place cannot drift from another.
 */
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The shell, not the gate: each page redirects for itself. A redirect here
  // would fire on /login too, and a layout cannot see which page it is
  // wrapping without reaching for headers.
  const session = await readSession();

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <div className="flex min-h-screen flex-col bg-[#f7f7f4] text-[#26251e] md:flex-row">
          {session ? <AppSidebar user={{ email: session.email, name: session.name }} /> : null}
          {/* min-w-0: without it the reader grid and long filenames push the flex column wider. */}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </body>
    </html>
  );
}
