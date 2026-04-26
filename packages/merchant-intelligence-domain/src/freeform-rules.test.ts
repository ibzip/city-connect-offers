import assert from "node:assert/strict";
import test from "node:test";
import type { Merchant } from "@city-wallet/contracts";
import { compileAndApplyMerchantRules, compileMerchantFreeformRules, FreeformRuleCompilationError } from "./index";

const merchant: Merchant = {
  id: "merchant_rule_test",
  externalId: "merchant_rule_test",
  name: "Rule Test Cafe",
  category: "cafe",
  zoneId: "zone_rule_test",
  distanceMeters: 80,
  latitude: 48.13,
  longitude: 11.57,
  participationStatus: "demo_partner",
  source: "manual",
  syntheticFields: [],
  products: [
    { id: "p1", merchantId: "merchant_rule_test", name: "cappuccino", priceEuro: 3.6, category: "warm_drink" },
    { id: "p2", merchantId: "merchant_rule_test", name: "latte", priceEuro: 4.1, category: "warm_drink" },
  ],
  goals: [],
  rule: {
    merchantId: "merchant_rule_test",
    maxDiscountPercent: 20,
    dailyBudgetEuro: 50,
    dailyBudgetRemainingEuro: 50,
    eligibleProducts: ["cappuccino", "latte"],
    allowsBundles: true,
    preferredBundleCategories: ["bookshop"],
    offerTypesAllowed: ["cashback", "bundle_unlock"],
    brandTone: "local",
  },
};

test("mock free-form compiler turns simple text into static merchant rule patch", async () => {
  const preview = await compileMerchantFreeformRules({
    merchant,
    freeformRulesText: "Max discount 8%. Daily budget 25. No bundles. Cashback only. Eligible products: cappuccino.",
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.compiledRule?.compiler, "mock_llm");
  assert.equal(preview.compiledRule?.staticRulePatch.maxDiscountPercent, 8);
  assert.equal(preview.compiledRule?.staticRulePatch.dailyBudgetEuro, 25);
  assert.equal(preview.compiledRule?.staticRulePatch.allowsBundles, false);
  assert.deepEqual(preview.compiledRule?.staticRulePatch.offerTypesAllowed, ["cashback"]);
  assert.deepEqual(preview.appliedRule?.eligibleProducts, ["cappuccino"]);
});

test("free-form rules are applied before merchant save and become static constraints", async () => {
  const result = await compileAndApplyMerchantRules({
    ...merchant,
    rule: {
      ...merchant.rule!,
      freeformRulesText: "Remaining budget 12. Max cashback 6%. Brand tone warm local.",
    },
  });

  assert.equal(result.merchant.rule?.maxDiscountPercent, 6);
  assert.equal(result.merchant.rule?.dailyBudgetRemainingEuro, 12);
  assert.equal(result.merchant.rule?.brandTone, "warm_local");
  assert.equal(result.merchant.rule?.freeformRulesStatus, "compiled");
});

test("uncompilable free-form rules fail instead of being silently enforced", async () => {
  await assert.rejects(
    () => compileAndApplyMerchantRules({
      ...merchant,
      rule: {
        ...merchant.rule!,
        freeformRulesText: "Only give offers to people who look wealthy.",
      },
    }),
    FreeformRuleCompilationError,
  );
});
