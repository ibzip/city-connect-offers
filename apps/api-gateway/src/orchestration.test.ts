import assert from "node:assert/strict";
import test from "node:test";
import { SeededRepository, setRepositoryForTests } from "@city-wallet/db";
import { createRedemptionTokens, redeemToken } from "@city-wallet/redemption-domain";
import { orchestrate } from "./handler";

globalThis.fetch = async () => {
  throw new Error("forced provider failure in tests");
};

function setup() {
  const repository = new SeededRepository();
  setRepositoryForTests(repository);
  return repository;
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
