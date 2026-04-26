import type { OrchestrateRequest, OrchestrationResult, RedemptionResult, RedemptionToken } from "@city-wallet/contracts";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3010";
const API_BASE_STORAGE_KEY = "city_wallet_api_base_url";

export function getApiBaseUrl() {
  if (typeof window !== "undefined") {
    const queryOverride = new URLSearchParams(window.location.search).get("apiBaseUrl");
    if (queryOverride) {
      const normalized = normalizeBaseUrl(queryOverride);
      window.localStorage.setItem(API_BASE_STORAGE_KEY, normalized);
      return normalized;
    }
    const storedOverride = window.localStorage.getItem(API_BASE_STORAGE_KEY);
    if (storedOverride) return normalizeBaseUrl(storedOverride);
  }
  return normalizeBaseUrl(API_BASE_URL);
}

export async function apiGet<T>(path: string): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const response = await fetchWithApiError(`${baseUrl}${path}`, { cache: "no-store" }, baseUrl);
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const response = await fetchWithApiError(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, baseUrl);
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

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

async function fetchWithApiError(input: RequestInfo | URL, init: RequestInit, baseUrl: string) {
  try {
    return await fetch(input, init);
  } catch (error) {
    const hint = baseUrl.includes("localhost")
      ? "The API base URL is localhost. On a phone/ngrok page, set it to your API ngrok HTTPS URL with ?apiBaseUrl=https://YOUR-API.ngrok-free.app or NEXT_PUBLIC_API_BASE_URL, then reload."
      : `Could not reach API base URL ${baseUrl}. Check that the API Gateway dev server/tunnel is running.`;
    throw new Error(`${hint} Original error: ${error instanceof Error ? error.message : "fetch failed"}`);
  }
}
