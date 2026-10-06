import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { NetworkMenuProvider, TestNetworkBanner } from "@/components/network-switcher";
import { getNetworkMenu } from "@/lib/networks";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_ORIGIN ?? "http://localhost:3000"),
  title: { default: "Stele — Verifiable agreements on Solana", template: "%s · Stele" },
  description:
    "Stele records the exact version of your terms — and every acceptance of it — as cryptographic evidence on Solana that anyone can verify independently.",
  applicationName: "Stele",
  openGraph: {
    title: "Stele — Prove what was agreed.",
    description:
      "Immutable document versions, wallet-signed acceptances and independently verifiable receipts on Solana.",
    type: "website",
    siteName: "Stele",
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: "#070a0f",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render per request: every script must carry this request's CSP nonce (see src/proxy.ts).
  await connection();
  const networkMenu = await getNetworkMenu();
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh bg-bg text-fg">
        <a
          href="#main"
          className="sr-only z-[100] rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <NetworkMenuProvider menu={networkMenu}>
          <TestNetworkBanner />
          {children}
        </NetworkMenuProvider>
      </body>
    </html>
  );
}
