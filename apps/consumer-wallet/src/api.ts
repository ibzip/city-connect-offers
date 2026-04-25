import type { OrchestrateRequest, OrchestrationResult, RedemptionResult, RedemptionToken } from "@city-wallet/contracts";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3010";

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export function orchestrate(request: OrchestrateRequest) {
  return apiPost<OrchestrationResult>("/api/orchestrate", request);
}

export function claimOffer(offerId: string) {
  return apiPost<{ tokens: RedemptionToken[] }>("/api/offers/" + offerId + "/claim", { offerId });
}

export function redeem(code: string, merchantId: string) {
  return apiPost<RedemptionResult>("/api/redemption/redeem", { code, merchantId });
}
