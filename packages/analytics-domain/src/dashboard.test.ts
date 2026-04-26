import assert from "node:assert/strict";
import test from "node:test";
import type { Merchant } from "@city-wallet/contracts";
import { SeededRepository } from "@city-wallet/db";
import { buildMerchantDashboardMetrics } from "./index";

test("dashboard metrics page merchants and report total count", async () => {
  const repository = new SeededRepository();
  for (let index = 0; index < 60; index += 1) {
    await repository.saveMerchant(makeMerchant(index));
  }

  const firstPage = await buildMerchantDashboardMetrics(repository, { merchantLimit: 50, merchantOffset: 0 });
  assert.equal(firstPage.merchants.length, 50);
  assert.equal(firstPage.merchantPage.total, 63);
  assert.equal(firstPage.merchantPage.hasMore, true);
  assert.equal(firstPage.merchantSummary.bySource.google_places, 60);

  const secondPage = await buildMerchantDashboardMetrics(repository, { merchantLimit: 50, merchantOffset: 50 });
  assert.equal(secondPage.merchants.length, 13);
  assert.equal(secondPage.merchantPage.hasMore, false);
});

test("repository merchant filters support dashboard query fields", async () => {
  const repository = new SeededRepository();
  await repository.saveMerchant(makeMerchant(1, { category: "bookshop", participationStatus: "partner", source: "manual" }));
  await repository.saveMerchant(makeMerchant(2, { category: "cafe", participationStatus: "partner", source: "google_places" }));

  assert.equal(await repository.countMerchants({ source: "google_places" }), 1);
  assert.equal((await repository.listMerchants({ category: "bookshop", query: "merchant 1" })).length, 1);
  assert.equal((await repository.listMerchants({ source: "google_places" }))[0]?.category, "cafe");
});

function makeMerchant(index: number, overrides: Partial<Merchant> = {}): Merchant {
  return {
    id: `merchant_${index}`,
    name: `Merchant ${index}`,
    category: "cafe",
    zoneId: "zone_test",
    distanceMeters: 100,
    latitude: 48.1 + index * 0.0001,
    longitude: 11.5 + index * 0.0001,
    participationStatus: "partner",
    source: "google_places",
    externalId: `place_${index}`,
    syntheticFields: [],
    products: [],
    goals: [],
    ...overrides,
  };
}
