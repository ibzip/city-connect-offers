import assert from "node:assert/strict";
import test from "node:test";
import type { AnalyticsEvent, Offer, OrchestrationRun, UserEvent } from "@city-wallet/contracts";
import { SeededRepository } from "./index";

const userA = "user_mia";
const userB = "user_bob";

function offerFor(userId: string, offerId: string, _merchantId = "cafe_mueller"): Offer {
  return {
    offerId,
    consumerId: userId,
    type: "single_offer",
    status: "created",
    headline: "Test offer",
    subheadline: "Test sub",
    cta: "Claim",
    validityMinutes: 30,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    items: [],
    why: [],
  };
}

function userEventFor(userId: string): UserEvent {
  return {
    eventId: `evt_${Math.random().toString(36).slice(2)}`,
    userId,
    eventType: "WalletOpened",
    observedAt: new Date().toISOString(),
    payload: {},
  };
}

function analyticsFor(offerId?: string): AnalyticsEvent {
  return {
    eventId: `analytics_${Math.random().toString(36).slice(2)}`,
    type: "context_refreshed",
    layer: "context",
    message: "test",
    createdAt: new Date().toISOString(),
    offerId,
    payload: {},
  };
}

function runFor(userId: string, idem: string): OrchestrationRun {
  return {
    idempotencyKey: idem,
    userId,
    eventType: "WalletOpened",
    status: "running",
    resultJson: null,
    errorJson: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

test("clearUserTransientState removes per-user offers, runs, events, analytics and leaves other users alone", async () => {
  const repo = new SeededRepository();

  await repo.saveOffer(offerFor(userA, "offer_a1"));
  await repo.saveOffer(offerFor(userA, "offer_a2"));
  await repo.saveOffer(offerFor(userB, "offer_b1"));

  await repo.saveUserEvent(userEventFor(userA));
  await repo.saveUserEvent(userEventFor(userA));
  await repo.saveUserEvent(userEventFor(userB));

  await repo.recordAnalyticsEvent(analyticsFor("offer_a1"));
  await repo.recordAnalyticsEvent(analyticsFor("offer_b1"));

  await repo.createOrchestrationRun(runFor(userA, "idem_a_run"));
  await repo.createOrchestrationRun(runFor(userB, "idem_b_run"));

  // Sanity: starting state.
  assert.equal((await repo.listOffers(userA)).length, 2);
  assert.equal((await repo.listOffers(userB)).length, 1);

  const result = await repo.clearUserTransientState(userA);
  assert.ok(result.clearedCounts.offers >= 2, `expected at least 2 offers cleared, got ${result.clearedCounts.offers}`);

  // user_a state is wiped.
  assert.equal((await repo.listOffers(userA)).length, 0);
  assert.equal(await repo.getOrchestrationRun("idem_a_run"), null);

  // user_b state is preserved.
  assert.equal((await repo.listOffers(userB)).length, 1);
  const bRun = await repo.getOrchestrationRun("idem_b_run");
  assert.ok(bRun, "user_b orchestration run must remain");

  // Profile preservation: this method must NOT touch the seeded merchants
  // or the user profile (those drive the rest of the wallet/merchant
  // experience).
  const merchants = await repo.listMerchants();
  assert.ok(merchants.length > 0, "merchants must remain after clearing user state");
  const profile = await repo.getUserProfile(userA);
  assert.ok(profile, "user profile must remain after clearing user state");
});

test("clearUserTransientState reports zero counts on a fresh repository", async () => {
  const repo = new SeededRepository();
  const result = await repo.clearUserTransientState("user_unknown");
  assert.equal(result.clearedCounts.offers, 0);
  assert.equal(result.clearedCounts.orchestrationRuns, 0);
});
