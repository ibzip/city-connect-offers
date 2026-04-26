import type {
  ConnectedSourceChip,
  DevSimulatorPreviewRequest,
  DevSimulatorPreviewResult,
  MockContextProfile,
  MockContextProfileUpsert,
  Offer,
  OrchestrateRequest,
  OrchestrationResult,
  RedemptionResult,
  RedemptionToken,
  UserProfile,
  UserProfileUpdate,
} from "@city-wallet/contracts";

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

export async function apiDelete<T>(path: string): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const response = await fetchWithApiError(`${baseUrl}${path}`, { method: "DELETE" }, baseUrl);
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const response = await fetchWithApiError(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, baseUrl);
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export async function apiProbeStatus(path: string): Promise<number> {
  const baseUrl = getApiBaseUrl();
  try {
    const response = await fetch(`${baseUrl}${path}`, { method: "GET", cache: "no-store" });
    return response.status;
  } catch {
    return 0;
  }
}

export function orchestrate(request: OrchestrateRequest) {
  return apiPost<OrchestrationResult>("/api/orchestrate", request);
}

export function claimOffer(offerId: string) {
  return apiPost<{ tokens: RedemptionToken[] }>("/api/offers/" + offerId + "/claim", { offerId });
}

export function rejectOffer(offerId: string) {
  return apiPost<{ ok: true; offer: Offer }>(`/api/offers/${encodeURIComponent(offerId)}/reject`, { offerId });
}

export function resetUserState(userId: string) {
  return apiPost<{ ok: true; clearedCounts: Record<string, number> }>(`/api/consumer/reset`, { userId });
}

export function redeem(code: string, merchantId: string) {
  return apiPost<RedemptionResult>("/api/redemption/redeem", { code, merchantId });
}

export function fetchConnectedSources(userId: string) {
  return apiGet<ConnectedSourceChip[]>(`/api/consumer/connected-sources?userId=${encodeURIComponent(userId)}`);
}

export interface ReverseGeocodeResponse {
  city: string | null;
  countryCode: string | null;
  displayName: string | null;
  provider: string;
  durationMs: number;
  error?: string;
}

export function reverseGeocode(latitude: number, longitude: number) {
  return apiGet<ReverseGeocodeResponse>(
    `/api/geocode/reverse?lat=${encodeURIComponent(String(latitude))}&lng=${encodeURIComponent(String(longitude))}`,
  );
}

export function fetchContextSummary(userId: string) {
  return apiGet<{
    context: unknown;
    profileId: string | null;
    profileVersion: number;
    assembledUserContext: unknown;
    userNegotiationPosition: unknown;
    noOfferReason: string | null;
    agentTrace: unknown;
  }>(`/api/consumer/context-summary?userId=${encodeURIComponent(userId)}`);
}

export function fetchContextProfileVersion(userId: string) {
  return apiGet<{ profileId: string | null; version: number; updatedAt: string | null }>(
    `/api/consumer/context-profile-version?userId=${encodeURIComponent(userId)}`,
  );
}

export function updateUserProfile(userId: string, update: UserProfileUpdate) {
  return apiPatch<UserProfile>(`/api/consumer/profile?userId=${encodeURIComponent(userId)}`, update);
}

export function listMockContextProfiles(userId: string) {
  return apiGet<MockContextProfile[]>(`/api/dev/context-simulator/profiles?userId=${encodeURIComponent(userId)}`);
}

export function getMockContextProfile(profileId: string) {
  return apiGet<MockContextProfile | null>(`/api/dev/context-simulator/profiles/${encodeURIComponent(profileId)}`);
}

export function saveMockContextProfile(profile: MockContextProfileUpsert) {
  return apiPost<MockContextProfile>(`/api/dev/context-simulator/profiles`, profile);
}

export function activateMockContextProfile(profileId: string, userId: string) {
  return apiPost<MockContextProfile>(`/api/dev/context-simulator/profiles/${encodeURIComponent(profileId)}/activate`, { userId });
}

export function deleteMockContextProfile(profileId: string) {
  return apiDelete<{ ok: true }>(`/api/dev/context-simulator/profiles/${encodeURIComponent(profileId)}`);
}

export function listScenarios() {
  return apiGet<Array<{
    id: string;
    label: string;
    description: string;
    enabledSources: Record<string, boolean>;
    signalPayloads: Record<string, unknown>;
    profileOverrides: {
      walkingToleranceMeters?: number;
      maxBundleStops?: number;
      maxOffersPerHour?: number;
      rewardPreference?: "cashback" | "discount" | "either";
      privacyMode?: "low" | "medium" | "high";
      declaredIntent?: string;
      availableMinutes?: number;
    } | null;
  }>>(`/api/dev/context-simulator/scenarios`);
}

export function previewSimulator(request: DevSimulatorPreviewRequest) {
  return apiPost<DevSimulatorPreviewResult>(`/api/dev/context-simulator/preview`, request);
}

export function runSimulatorContext(userId: string) {
  return apiPost<OrchestrationResult>(`/api/dev/context-simulator/run-context`, { userId });
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
