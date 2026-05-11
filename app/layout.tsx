import type { Metadata } from "next";
import { JetBrains_Mono, Newsreader } from "next/font/google";
import HeaderPath from "./HeaderPath";
import "./globals.css";

const mono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const serif = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const SITE_URL = "https://midterm-tracker.vercel.app";
const SITE_TITLE = "Midterms 2026 — live prediction-market odds";
const SITE_DESCRIPTION =
  "Live prediction-market odds for the 2026 U.S. midterms. Every House district and Senate race priced from Kalshi, aggregated into a seat-distribution forecast.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Midterms 2026",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    // app/opengraph-image.tsx is auto-resolved into the og:image tag.
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${mono.variable} ${serif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="px-8 py-6 border-b border-[var(--color-rule)] sticky top-0 z-20 bg-[var(--color-paper)]">
          <div className="mx-auto max-w-6xl flex items-baseline justify-between gap-4">
            <HeaderPath />
            <span className="text-[10px] tracking-wider text-[var(--color-ink-mute)]">
              source: kalshi · 119th cong. boundaries
            </span>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-[var(--color-rule)] mt-24 py-6 px-8">
          <div className="mx-auto max-w-6xl text-[10px] tracking-wider text-[var(--color-ink-mute)] flex items-baseline justify-between">
            <span>boundaries: U.S. Census cb_2024_us_cd119_500k</span>
            <span>odds: kalshi.com prediction markets</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
