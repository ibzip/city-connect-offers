import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "./pages/NotFound.tsx";
import { AppStoreProvider } from "./citywallet/store/AppStore";
import { AppShell } from "./citywallet/components/AppShell";
import { DemoOverviewPage } from "./citywallet/pages/DemoOverviewPage";
import { WalletPage } from "./citywallet/pages/WalletPage";
import { MerchantRulesPage } from "./citywallet/pages/MerchantRulesPage";
import { MerchantDashboardPage } from "./citywallet/pages/MerchantDashboardPage";
import { NegotiationDebugPage } from "./citywallet/pages/NegotiationDebugPage";
import { RedemptionPage } from "./citywallet/pages/RedemptionPage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AppStoreProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<DemoOverviewPage />} />
              <Route path="/wallet" element={<WalletPage />} />
              <Route path="/merchant-rules" element={<MerchantRulesPage />} />
              <Route path="/merchant-dashboard" element={<MerchantDashboardPage />} />
              <Route path="/negotiation" element={<NegotiationDebugPage />} />
              <Route path="/redemption" element={<RedemptionPage />} />
            </Route>
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AppStoreProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
