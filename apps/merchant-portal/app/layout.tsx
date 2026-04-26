import "@city-wallet/ui/styles.css";
import type { Metadata } from "next";
import { MerchantPortalHeader } from "../src/merchant-portal-header";

export const metadata: Metadata = {
  title: "City Wallet Merchant Portal",
  description: "Merchant rules and dashboard for City Wallet",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <MerchantPortalHeader />
        {children}
      </body>
    </html>
  );
}
