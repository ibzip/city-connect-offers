import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "./pages/NotFound.tsx";
import { AppStoreProvider } from "./citywallet/store/AppStore";
import { AppShell } from "./citywallet/components/AppShell";
import { DemoStagePage } from "./citywallet/pages/DemoStagePage";
import { MerchantPage } from "./citywallet/pages/MerchantPage";
import { RedemptionPage } from "./citywallet/pages/RedemptionPage";
import { DebugPage } from "./citywallet/pages/DebugPage";

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
              <Route path="/" element={<DemoStagePage />} />
              <Route path="/merchant" element={<MerchantPage />} />
              <Route path="/redemption" element={<RedemptionPage />} />
              <Route path="/debug" element={<DebugPage />} />
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
