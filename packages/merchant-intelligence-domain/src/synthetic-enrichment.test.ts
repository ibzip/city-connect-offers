import assert from "node:assert/strict";
import test from "node:test";
import type { Merchant } from "@city-wallet/contracts";
import { enrichImportedMerchantWithSyntheticData } from "./index";

function discoveredMerchant(): Merchant {
  return {
    id: "disc_cafe",
    externalId: "tavily_1",
    name: "Nearby Cafe",
    category: "cafe",
    zoneId: "zone",
    distanceMeters: 80,
    address: "Market Street 1",
    latitude: 48.775,
    longitude: 9.177,
    participationStatus: "partner",
    source: "tavily",
    confidence: 0.6,
    syntheticFields: [],
    products: [],
    goals: [],
  };
}

test("enrichImportedMerchantWithSyntheticData attaches synthetic profile and keeps partner status", () => {
  const enriched = enrichImportedMerchantWithSyntheticData(discoveredMerchant());
  assert.equal(enriched.participationStatus, "partner");
  assert.ok(enriched.products.length >= 3);
  assert.ok(enriched.rule?.allowsBundles);
  assert.deepEqual(enriched.syntheticFields, ["products", "goals", "rules", "transactions", "redemption"]);
});
