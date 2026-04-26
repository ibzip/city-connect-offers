import assert from "node:assert/strict";
import test from "node:test";
import type { Merchant } from "@city-wallet/contracts";
import { createDemoPartnerFromDiscoveredMerchant } from "./index";

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
    participationStatus: "discovered_only",
    source: "tavily",
    confidence: 0.6,
    syntheticFields: [],
    products: [],
    goals: [],
  };
}

test("createDemoPartnerFromDiscoveredMerchant generates synthetic demo profile", () => {
  const demo = createDemoPartnerFromDiscoveredMerchant(discoveredMerchant());
  assert.equal(demo.participationStatus, "demo_partner");
  assert.ok(demo.products.length >= 3);
  assert.ok(demo.rule?.allowsBundles);
  assert.deepEqual(demo.syntheticFields, ["products", "goals", "rules", "transactions", "redemption"]);
  assert.match(demo.demoDisclosure ?? "", /simulated/i);
});
