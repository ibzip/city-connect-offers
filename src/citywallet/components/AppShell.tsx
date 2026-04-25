import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAppStore } from "../store/AppStore";
import { Wallet, LayoutDashboard, Settings2, Store, Brain, Receipt, RefreshCcw } from "lucide-react";

const NAV = [
  { to: "/", label: "Demo", icon: LayoutDashboard, end: true },
  { to: "/wallet", label: "Wallet", icon: Wallet },
  { to: "/merchant-rules", label: "Merchant Rules", icon: Settings2 },
  { to: "/merchant-dashboard", label: "Merchant Dashboard", icon: Store },
  { to: "/negotiation", label: "Negotiation Debug", icon: Brain },
  { to: "/redemption", label: "Redemption", icon: Receipt },
];

export function AppShell() {
  const { resetDemo } = useAppStore();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-hero text-primary-foreground shadow-glow">
              <Wallet className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="font-semibold">City Wallet</div>
              <div className="text-xs text-muted-foreground">Agentic local commerce</div>
            </div>
          </div>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn(
                    "rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
                    isActive && "bg-secondary text-foreground",
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <Button variant="outline" size="sm" onClick={resetDemo} className="gap-2">
            <RefreshCcw className="h-4 w-4" /> Reset demo
          </Button>
        </div>
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2 md:hidden">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
                  isActive && "bg-secondary text-foreground",
                )
              }
            >
              <n.icon className="mr-1 inline h-3.5 w-3.5" />
              {n.label}
            </NavLink>
          ))}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8 animate-fade-in">
        <Outlet />
      </main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        City Wallet · Hackathon MVP · Stuttgart Old Town demo
      </footer>
    </div>
  );
}