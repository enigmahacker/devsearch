import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";

import { Cursor } from "@/components/Cursor";
import { SetupDialog } from "@/components/SetupDialog";
import { SupportButton } from "@/components/SupportButton";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// Every page is rendered per request so Next can stamp the CSP nonce from middleware onto its scripts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "DevSearch",
  description: "Search official docs, GitHub and Stack Overflow with grounded, cited answers.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <div aria-hidden className="aurora" />
        <div aria-hidden className="grid-bg" />
        <div aria-hidden className="spotlight" />
        <header className="sticky top-0 z-20 border-b border-white/5 bg-background/60 backdrop-blur-xl">
          <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <Link href="/search" className="flex items-center gap-2 font-semibold tracking-tight">
                <span className="logo-dot" aria-hidden />
                DevSearch
              </Link>
              {/* Set by the ds CLI; absent when running from source. */}
              {process.env.DEVSEARCH_VERSION && <span className="version-tag">v{process.env.DEVSEARCH_VERSION}</span>}
            </div>
            <div className="flex items-center gap-4">
              <SupportButton />
              <Link href="/settings" className="nav-link text-sm text-muted-foreground transition-colors hover:text-foreground">
                Settings
              </Link>
            </div>
          </nav>
        </header>
        {children}
        <SetupDialog />
        <Cursor />
      </body>
    </html>
  );
}
