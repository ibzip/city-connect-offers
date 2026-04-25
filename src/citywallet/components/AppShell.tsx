import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";

const tabs = [
  { to: "/", label: "Demo Stage" },
  { to: "/merchant", label: "Merchant" },
  { to: "/redemption", label: "Redemption" },
  { to: "/debug", label: "Debug" },
];

export function AppShell() {
  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="surface-acrylic sticky top-0 z-40 border-b border-black/5">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full ink-mark flex items-center justify-center font-serif italic text-lg">C</div>
            <div>
              <div className="font-serif text-lg leading-none">City Wallet</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted mt-1">
                AI-powered local commerce · gpt-5.2
              </div>
            </div>
          </div>
          <nav className="flex gap-1">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
                    isActive ? "bg-teal text-primary-foreground" : "text-ink-muted hover:bg-black/5",
                  )
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-[1400px] mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}