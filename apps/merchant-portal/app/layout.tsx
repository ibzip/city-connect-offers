import "@city-wallet/ui/styles.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "City Wallet Merchant Portal",
  description: "Merchant rules and dashboard for City Wallet",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="surface-acrylic sticky top-0 z-40 border-b border-black/5">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between px-5 py-4 sm:px-6">
            <Link href="/dashboard" className="flex items-center gap-3">
              <div className="ink-mark flex h-9 w-9 items-center justify-center rounded-full font-serif text-lg italic">C</div>
              <div>
                <div className="font-serif text-lg leading-none">City Wallet</div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">Merchant portal</div>
              </div>
            </Link>
            <nav className="flex gap-1 text-sm font-medium">
              <Link className="rounded-full px-3 py-1.5 text-ink-muted hover:bg-black/5" href="/dashboard">Dashboard</Link>
              <Link className="rounded-full px-3 py-1.5 text-ink-muted hover:bg-black/5" href="/rules">Rules</Link>
              <Link className="rounded-full px-3 py-1.5 text-ink-muted hover:bg-black/5" href="/debug">Debug</Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
