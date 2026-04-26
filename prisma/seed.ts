import { PrismaClient } from "@prisma/client";
import {
  seededCommerceZones,
  seededConsumerContext,
  seededMerchantGoals,
  seededMerchantProducts,
  seededMerchantRules,
  seededMerchants,
  seededPaymentDensitySignals,
  seededUserProfile,
} from "@city-wallet/data-seed";
import { getScenarioPreset } from "@city-wallet/raw-context-domain";

const prisma = new PrismaClient();

function data(value: unknown) {
  return JSON.stringify(value);
}

const DEFAULT_MOCK_PROFILE_ID = "mock_profile_default_mia";
const DEFAULT_MOCK_PROFILE_LEGACY_ID = "mock_profile_workday_mia_v1";

const ACTIVE_DEFAULT_SCENARIO = "lunch_break_with_visitor" as const;

/**
 * Idempotent seeding: upserts the canonical seed rows by primary key without
 * deleting anything. Safe to run repeatedly. User-imported merchants, import
 * runs, analytics events, orchestration runs, etc. are left untouched.
 */
export async function seedIdempotent(client: PrismaClient = prisma) {
  for (const zone of seededCommerceZones) {
    await client.commerceZone.upsert({
      where: { id: zone.id },
      update: {
        name: zone.name,
        city: zone.city,
        country: zone.country,
        centerLat: zone.centerLat,
        centerLng: zone.centerLng,
        radiusMeters: zone.radiusMeters,
        isActive: zone.isActive,
        data: data(zone),
      },
      create: {
        id: zone.id,
        name: zone.name,
        city: zone.city,
        country: zone.country,
        centerLat: zone.centerLat,
        centerLng: zone.centerLng,
        radiusMeters: zone.radiusMeters,
        isActive: zone.isActive,
        data: data(zone),
      },
    });
  }

  await client.user.upsert({
    where: { id: seededUserProfile.userId },
    update: {},
    create: { id: seededUserProfile.userId },
  });

  await client.userProfile.upsert({
    where: { userId: seededUserProfile.userId },
    update: { data: data(seededUserProfile) },
    create: {
      userId: seededUserProfile.userId,
      data: data(seededUserProfile),
    },
  });

  await client.userContextSnapshot.upsert({
    where: { id: seededConsumerContext.snapshotId },
    update: {
      userId: seededConsumerContext.userId,
      data: data(seededConsumerContext),
      createdAt: new Date(seededConsumerContext.createdAt),
    },
    create: {
      id: seededConsumerContext.snapshotId,
      userId: seededConsumerContext.userId,
      data: data(seededConsumerContext),
      createdAt: new Date(seededConsumerContext.createdAt),
    },
  });

  for (const merchant of seededMerchants) {
    await client.merchant.upsert({
      where: { id: merchant.id },
      update: {
        name: merchant.name,
        zoneId: merchant.zoneId,
        category: merchant.category,
        participationStatus: merchant.participationStatus ?? "partner",
        source: merchant.source ?? "seeded",
        latitude: merchant.latitude,
        longitude: merchant.longitude,
        data: data(merchant),
      },
      create: {
        id: merchant.id,
        name: merchant.name,
        zoneId: merchant.zoneId,
        category: merchant.category,
        participationStatus: merchant.participationStatus ?? "partner",
        source: merchant.source ?? "seeded",
        latitude: merchant.latitude,
        longitude: merchant.longitude,
        data: data(merchant),
      },
    });
  }

  for (const product of seededMerchantProducts) {
    await client.merchantProduct.upsert({
      where: { id: product.id },
      update: {
        merchantId: product.merchantId,
        data: data(product),
      },
      create: {
        id: product.id,
        merchantId: product.merchantId,
        data: data(product),
      },
    });
  }

  for (const goal of seededMerchantGoals) {
    await client.merchantGoal.upsert({
      where: { id: goal.id },
      update: {
        merchantId: goal.merchantId,
        data: data(goal),
      },
      create: {
        id: goal.id,
        merchantId: goal.merchantId,
        data: data(goal),
      },
    });
  }

  for (const rule of seededMerchantRules) {
    // MerchantRule has merchantId as its primary key.
    await client.merchantRule.upsert({
      where: { merchantId: rule.merchantId },
      update: { data: data(rule) },
      create: {
        merchantId: rule.merchantId,
        data: data(rule),
      },
    });
  }

  for (const signal of seededPaymentDensitySignals) {
    // Baseline + snapshot ids are auto-generated cuids in schema; we keep
    // historical rows untouched and only insert if no baseline/snapshot
    // exists yet for this seeded merchant.
    const existingBaseline = await client.merchantTransactionBaseline.findFirst({
      where: { merchantId: signal.merchantId },
    });
    if (!existingBaseline) {
      await client.merchantTransactionBaseline.create({
        data: {
          merchantId: signal.merchantId,
          data: data({
            merchantId: signal.merchantId,
            baselineTransactions: signal.baselineTransactions,
            baselineRevenue: signal.baselineRevenue,
          }),
        },
      });
    }

    const existingSnapshot = await client.merchantTransactionSnapshot.findFirst({
      where: { merchantId: signal.merchantId },
    });
    if (!existingSnapshot) {
      await client.merchantTransactionSnapshot.create({
        data: {
          merchantId: signal.merchantId,
          data: data(signal),
        },
      });
    }
  }

  // Make the lunch + visitor scenario the default active mock profile for
  // Mia, so opening the wallet on a fresh DB demonstrates the multi-offer
  // flow described in the product brief. Any other rows that were marked
  // active (e.g. from prior dev sessions) are flipped to inactive to satisfy
  // the "single active profile per user" invariant.
  const preset = getScenarioPreset(ACTIVE_DEFAULT_SCENARIO);
  if (!preset) {
    throw new Error(`Missing scenario preset "${ACTIVE_DEFAULT_SCENARIO}" - cannot seed default profile.`);
  }

  await client.mockContextProfile.updateMany({
    where: {
      userId: seededUserProfile.userId,
      isActive: true,
      NOT: { id: DEFAULT_MOCK_PROFILE_ID },
    },
    data: { isActive: false },
  });

  await client.mockContextProfile.upsert({
    where: { id: DEFAULT_MOCK_PROFILE_ID },
    update: {
      userId: seededUserProfile.userId,
      name: preset.label,
      enabledSourcesJson: data(preset.enabledSources),
      signalPayloadsJson: data(preset.signalPayloads),
      profileOverridesJson: preset.profileOverrides ? data(preset.profileOverrides) : null,
      activeScenario: preset.id,
      isActive: true,
    },
    create: {
      id: DEFAULT_MOCK_PROFILE_ID,
      userId: seededUserProfile.userId,
      name: preset.label,
      enabledSourcesJson: data(preset.enabledSources),
      signalPayloadsJson: data(preset.signalPayloads),
      profileOverridesJson: preset.profileOverrides ? data(preset.profileOverrides) : null,
      activeScenario: preset.id,
      isActive: true,
      version: 1,
    },
  });

  // Best-effort cleanup of an older default id used in earlier dev branches,
  // so we never end up with two "default" rows competing.
  await client.mockContextProfile.deleteMany({ where: { id: DEFAULT_MOCK_PROFILE_LEGACY_ID } });
}

/**
 * Destructive reset: deletes every row from every domain table and then
 * re-runs the idempotent seed. Use for wiping the local DB to a clean
 * canonical state. This will remove user-imported merchants and any other
 * locally-generated data.
 */
export async function resetAndSeed(client: PrismaClient = prisma) {
  await client.$transaction([
    client.userContextAgentRun.deleteMany(),
    client.mockContextProfile.deleteMany(),
    client.orchestrationRun.deleteMany(),
    client.merchantImportRun.deleteMany(),
    client.poiDiscoveryCache.deleteMany(),
    client.geocodingCache.deleteMany(),
    client.debugRun.deleteMany(),
    client.analyticsEvent.deleteMany(),
    client.cashbackLedgerEntry.deleteMany(),
    client.redemption.deleteMany(),
    client.redemptionToken.deleteMany(),
    client.offerItem.deleteMany(),
    client.offer.deleteMany(),
    client.validationResult.deleteMany(),
    client.negotiationDecision.deleteMany(),
    client.negotiationBrief.deleteMany(),
    client.triggerMatch.deleteMany(),
    client.userEvent.deleteMany(),
    client.merchantInsightSnapshot.deleteMany(),
    client.merchantTransactionSnapshot.deleteMany(),
    client.merchantTransactionBaseline.deleteMany(),
    client.merchantRule.deleteMany(),
    client.merchantGoal.deleteMany(),
    client.merchantProduct.deleteMany(),
    client.merchant.deleteMany(),
    client.commerceZone.deleteMany(),
    client.userContextSnapshot.deleteMany(),
    client.userProfile.deleteMany(),
    client.user.deleteMany(),
  ]);

  await seedIdempotent(client);
}

async function main() {
  const reset = process.argv.includes("--reset");
  if (reset) {
    await resetAndSeed();
    console.log("Reset and re-seeded City Wallet local data.");
  } else {
    await seedIdempotent();
    console.log("Seeded City Wallet local data (idempotent; existing rows preserved).");
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
