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

const prisma = new PrismaClient();

function data(value: unknown) {
  return JSON.stringify(value);
}

const DEFAULT_MOCK_PROFILE_ID = "mock_profile_default_mia";

const DEFAULT_MOCK_PROFILE_ENABLED_SOURCES = {
  calendar: true,
  fitness: true,
  mobility: true,
  mood: true,
  payment_preference: true,
  social: false,
  transit: false,
  dietary: true,
  device_attention: true,
  local_events: false,
};

const DEFAULT_MOCK_PROFILE_PAYLOADS = {
  calendar: {
    freeWindowMinutes: 35,
    nextEventInMinutes: 95,
    nextEventType: "work",
    dayLoad: "medium",
    hasHardStop: true,
    locationHint: "nearby",
  },
  fitness: {
    sleepQuality: "okay",
    energyLevel: "medium",
    recentWorkout: false,
    recoveryNeed: "low",
    activityLoadToday: "low",
  },
  mobility: {
    movementState: "walking_slowly",
    dwellPattern: "browsing",
    familiarity: "familiar_area",
  },
  mood: {
    moodState: "calm",
    confidence: 0.7,
    basis: ["light_calendar_load", "okay_sleep"],
  },
  payment_preference: {
    rewardPreference: "cashback",
    priceSensitivity: "medium",
    categoryAffinities: ["cafe", "bakery", "bookshop"],
    recentCategoryAvoidance: [],
  },
  dietary: {
    dietaryHints: [],
    avoidFoodCategories: [],
    preferredFoodStyle: "light",
  },
  device_attention: {
    screenActive: true,
    focusMode: false,
    batteryLevel: "medium",
    headphonesConnected: false,
    notificationTolerance: "medium",
  },
};

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

  await client.mockContextProfile.upsert({
    where: { id: DEFAULT_MOCK_PROFILE_ID },
    update: {
      userId: seededUserProfile.userId,
      name: "Default workday afternoon",
      enabledSourcesJson: data(DEFAULT_MOCK_PROFILE_ENABLED_SOURCES),
      signalPayloadsJson: data(DEFAULT_MOCK_PROFILE_PAYLOADS),
      activeScenario: null,
      isActive: true,
    },
    create: {
      id: DEFAULT_MOCK_PROFILE_ID,
      userId: seededUserProfile.userId,
      name: "Default workday afternoon",
      enabledSourcesJson: data(DEFAULT_MOCK_PROFILE_ENABLED_SOURCES),
      signalPayloadsJson: data(DEFAULT_MOCK_PROFILE_PAYLOADS),
      activeScenario: null,
      isActive: true,
      version: 1,
    },
  });
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
