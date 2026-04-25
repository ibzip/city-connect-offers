"use client";

import { useEffect, useState } from "react";
import type { RedemptionToken } from "@city-wallet/contracts";
import { Section, TokenCard } from "@city-wallet/ui";
import { apiGet, redeem } from "./api";

export function RedeemApp() {
  const [tokens, setTokens] = useState<RedemptionToken[]>([]);

  async function load() {
    const state = await apiGet<{ tokens: RedemptionToken[] }>("/api/consumer/state?userId=user_mia");
    setTokens(state.tokens);
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function redeemAtCounter(token: RedemptionToken) {
    await redeem(token.code, token.merchantId);
    await load();
  }

  return (
    <Section>
      <div className="mb-6">
        <h1 className="font-serif text-3xl">Redeem</h1>
        <p className="mt-1 text-sm text-ink-muted">Simulated in-store checkout for claimed bundle tokens.</p>
      </div>
      {tokens.length === 0 ? (
        <div className="surface-card rounded-2xl p-10 text-center text-ink-muted">
          <p className="mb-2 font-serif text-xl text-ink">No active tokens yet</p>
          <p className="text-sm">Claim the bundle from the wallet to issue redemption tokens.</p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {tokens.map((token) => <TokenCard key={token.tokenId} token={token} onRedeem={() => redeemAtCounter(token)} />)}
        </div>
      )}
    </Section>
  );
}
