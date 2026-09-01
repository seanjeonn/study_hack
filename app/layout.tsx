import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import AppSidebar from "@/app/components/AppSidebar";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <div className="flex min-h-screen flex-col bg-[#f7f7f4] text-[#26251e] md:flex-row">
          <AppSidebar />
          {/* min-w-0: without it the reader grid and long filenames push the flex column wider. */}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </body>
    </html>
  );
}
