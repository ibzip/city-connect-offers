import assert from "node:assert/strict";
import test from "node:test";
import { SeededRepository, setRepositoryForTests } from "@city-wallet/db";
import { createRedemptionTokens, redeemToken } from "@city-wallet/redemption-domain";
import { handler, orchestrate } from "./handler";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

globalThis.fetch = async () => {
  throw new Error("forced provider failure in tests");
};

function setup() {
  const repository = new SeededRepository();
  setRepositoryForTests(repository);
  return repository;
}

function makeEvent(method: string, fullPath: string, body?: unknown): APIGatewayProxyEventV2 {
  const [path, query = ""] = fullPath.split("?");
  const queryStringParameters: Record<string, string> = {};
  if (query) {
    for (const part of query.split("&")) {
      const [key, value = ""] = part.split("=");
      queryStringParameters[decodeURIComponent(key)] = decodeURIComponent(value);
    }
  }
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: query,
    queryStringParameters,
    headers: { "content-type": "application/json" },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test",
      domainPrefix: "test",
      http: {
        method,
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "test",
      routeKey: "$default",
      stage: "$default",
      time: "00",
      timeEpoch: 0,
    },
    body: body ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

test("completed idempotency key returns stored result without duplicate offers", async () => {
  const repository = setup();
  const first = await orchestrate({ userId: "user_mia", eventType: "WalletOpened", idempotencyKey: "idem_complete" });
  const second = await orchestrate({ userId: "user_mia", eventType: "WalletOpened", idempotencyKey: "idem_complete" });
  assert.equal(first.offer?.offerId, second.offer?.offerId);
  assert.equal((await repository.listOffers("user_mia")).length, 1);
});

test("fresh running duplicate returns safe running response", async () => {
  const repository = setup();
  await repository.createOrchestrationRun({
    idempotencyKey: "idem_running",
    userId: "user_mia",
    eventType: "WalletOpened",
    status: "running",
    resultJson: null,
    errorJson: null,
  });
  const result = await orchestrate({ userId: "user_mia", eventType: "WalletOpened", idempotencyKey: "idem_running" });
  assert.equal(result.triggered, false);
  assert.equal(result.reason, "orchestration_already_running");
});

test("stale running duplicate is marked failed and not reused", async () => {
  const repository = setup();
  await repository.createOrchestrationRun({
    idempotencyKey: "idem_stale",
    userId: "user_mia",
    eventType: "WalletOpened",
    status: "running",
    resultJson: null,
    errorJson: null,
  });
  const tables = repository as unknown as { tables: { orchestrationRuns: Array<{ idempotencyKey: string; updatedAt: string }> } };
  const run = tables.tables.orchestrationRuns.find((candidate) => candidate.idempotencyKey === "idem_stale");
  if (run) run.updatedAt = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const result = await orchestrate({ userId: "user_mia", eventType: "WalletOpened", idempotencyKey: "idem_stale" });
  assert.equal(result.reason, "stale_orchestration_run");
  assert.equal((await repository.getOrchestrationRun("idem_stale"))?.status, "failed");
});

test("active offer and cooldown block duplicate negotiation paths", async () => {
  const repository = setup();
  const first = await orchestrate({ userId: "user_mia", eventType: "WalletOpened", idempotencyKey: "idem_offer" });
  assert.ok(first.offer);
  const active = await orchestrate({ userId: "user_mia", eventType: "WalletOpened", idempotencyKey: "idem_active" });
  assert.equal(active.reason, "active_offer_exists");

  const tokens = await createRedemptionTokens(repository, first.offer.offerId);
  await redeemToken(repository, { code: tokens[0]!.code, merchantId: tokens[0]!.merchantId });
  await redeemToken(repository, { code: tokens[1]!.code, merchantId: tokens[1]!.merchantId });
  const cooldown = await orchestrate({ userId: "user_mia", eventType: "WalletOpened", idempotencyKey: "idem_cooldown" });
  assert.equal(cooldown.reason, "cooldown_active");
});

test("wallet orchestration uses stored merchants without live discovery by default", async () => {
  setup();
  process.env.ENABLE_WALLET_LIVE_DISCOVERY_FALLBACK = "false";
  const result = await orchestrate({ userId: "user_mia", eventType: "WalletOpened", idempotencyKey: "idem_stored_supply" });
  assert.equal(result.nearbyMerchantSearch?.source, "stored_db");
  assert.equal(result.providerBudget?.overpassRequestsRemaining, 1);
  assert.equal(result.providerBudget?.tavilyRequestsRemaining, 1);
  assert.equal(result.analyticsEvents.filter((event) => event.type === "merchant_insight_refresh_completed").length, 1);
  assert.equal(result.analyticsEvents.some((event) => event.type === "merchant_insight_updated"), false);
});

test("dev simulator routes return 404 when ENABLE_DEV_CONTEXT_SIMULATOR is not true", async () => {
  setup();
  delete process.env.ENABLE_DEV_CONTEXT_SIMULATOR;
  const profilesResp = await handler(makeEvent("GET", "/api/dev/context-simulator/profiles"));
  assert.equal((profilesResp as { statusCode: number }).statusCode, 404);
  const previewResp = await handler(makeEvent("POST", "/api/dev/context-simulator/preview", { userId: "user_mia" }));
  assert.equal((previewResp as { statusCode: number }).statusCode, 404);
  const versionResp = await handler(makeEvent("GET", "/api/consumer/context-profile-version?userId=user_mia"));
  assert.notEqual((versionResp as { statusCode: number }).statusCode, 404, "consumer-facing version probe should NOT be gated by dev simulator flag");
});

test("dev simulator preview is side-effect-free: no offers, tokens, runs, or analytics offer events", async () => {
  const repository = setup();
  process.env.ENABLE_DEV_CONTEXT_SIMULATOR = "true";
  const beforeOffers = (await repository.listOffers()).length;
  const beforeTokens = (await repository.listRedemptionTokens()).length;
  const beforeAnalytics = (await repository.listAnalyticsEvents(1000)).length;
  const beforeRuns = (repository as unknown as { tables?: { orchestrationRuns: unknown[] } }).tables?.orchestrationRuns?.length ?? 0;

  const previewResp = await handler(
    makeEvent("POST", "/api/dev/context-simulator/preview", { userId: "user_mia" }),
  );
  assert.equal((previewResp as { statusCode: number }).statusCode, 200);

  assert.equal((await repository.listOffers()).length, beforeOffers, "preview must not create offers");
  assert.equal((await repository.listRedemptionTokens()).length, beforeTokens, "preview must not issue tokens");
  assert.equal((await repository.listAnalyticsEvents(1000)).length, beforeAnalytics, "preview must not record analytics");
  const afterRuns = (repository as unknown as { tables?: { orchestrationRuns: unknown[] } }).tables?.orchestrationRuns?.length ?? 0;
  assert.equal(afterRuns, beforeRuns, "preview must not create orchestration runs");
});

test("orchestrator is NOT halted in mock_llm mode (assembler+negotiator skipped, legacy path continues)", async () => {
  setup();
  process.env.LLM_PROVIDER = "mock_llm";
  delete process.env.AZURE_OPENAI_ENDPOINT;
  delete process.env.AZURE_OPENAI_DEPLOYMENT;
  delete process.env.AZURE_OPENAI_API_KEY;
  const result = await orchestrate({ userId: "user_mia", eventType: "WalletOpened", idempotencyKey: "idem_mock_llm_skip" });
  assert.equal(result.assembledUserContext, null);
  assert.equal(result.userNegotiationPosition, null);
  assert.notEqual(result.reason, "agent_failed");
});

test("orchestrator halts with no_offer when LLM_PROVIDER=azure_openai but Azure is not configured", async () => {
  setup();
  process.env.LLM_PROVIDER = "azure_openai";
  delete process.env.AZURE_OPENAI_ENDPOINT;
  delete process.env.AZURE_OPENAI_DEPLOYMENT;
  delete process.env.AZURE_OPENAI_API_KEY;
  delete process.env.AZURE_OPENAI_API_VERSION;
  const result = await orchestrate({ userId: "user_mia", eventType: "WalletOpened", idempotencyKey: "idem_azure_strict_no_config" });
  assert.ok(!result.offer, "no offer should be issued when Azure is required but unconfigured");
  assert.ok(result.noOfferReason === "agent_failed" || result.noOfferReason === "agent_skipped");
  process.env.LLM_PROVIDER = "mock_llm";
});

test("active mock profile profileOverrides widen the consumer context the orchestrator sees (e.g. tourist scenario)", async () => {
  const repository = setup();
  process.env.LLM_PROVIDER = "mock_llm";
  // Persist a fresh mock profile that mirrors the tourist scenario's overrides.
  const now = new Date().toISOString();
  await repository.saveMockContextProfile({
    id: "test_tourist_profile",
    userId: "user_mia",
    name: "Tourist exploring (test)",
    enabledSources: { calendar: true, mobility: true },
    signalPayloads: {},
    profileOverrides: {
      walkingToleranceMeters: 2_000,
      maxBundleStops: 3,
      declaredIntent: "local_discovery",
      availableMinutes: 180,
    },
    activeScenario: "tourist_exploring",
    isActive: false,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  await repository.setActiveMockContextProfile("user_mia", "test_tourist_profile");

  const persisted = await repository.getUserProfile("user_mia");
  const baselineWalk = persisted?.walkingToleranceMeters ?? 0;
  const result = await orchestrate({
    userId: "user_mia",
    eventType: "WalletOpened",
    idempotencyKey: "idem_tourist_overrides",
  });

  const ctx = result.consumerContext;
  assert.ok(ctx, "expected orchestration to produce a consumer context snapshot");
  assert.ok(
    ctx.walkingToleranceMeters >= 2_000,
    `expected effective walking tolerance >= 2000m from tourist override, got ${ctx.walkingToleranceMeters}`,
  );
  assert.equal(ctx.declaredIntent, "local_discovery");
  assert.equal(ctx.availableMinutes, 180);
  // The persisted UserProfile must NOT be mutated by the override.
  const persistedAfter = await repository.getUserProfile("user_mia");
  assert.equal(persistedAfter?.walkingToleranceMeters, baselineWalk);
});
