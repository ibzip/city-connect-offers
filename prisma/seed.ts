import { PrismaClient } from "@prisma/client";
import {
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

async function main() {
  await prisma.$transaction([
    prisma.debugRun.deleteMany(),
    prisma.analyticsEvent.deleteMany(),
    prisma.cashbackLedgerEntry.deleteMany(),
    prisma.redemption.deleteMany(),
    prisma.redemptionToken.deleteMany(),
    prisma.offerItem.deleteMany(),
    prisma.offer.deleteMany(),
    prisma.validationResult.deleteMany(),
    prisma.negotiationDecision.deleteMany(),
    prisma.negotiationBrief.deleteMany(),
    prisma.triggerMatch.deleteMany(),
    prisma.userEvent.deleteMany(),
    prisma.merchantInsightSnapshot.deleteMany(),
    prisma.merchantTransactionSnapshot.deleteMany(),
    prisma.merchantTransactionBaseline.deleteMany(),
    prisma.merchantRule.deleteMany(),
    prisma.merchantGoal.deleteMany(),
    prisma.merchantProduct.deleteMany(),
    prisma.merchant.deleteMany(),
    prisma.userContextSnapshot.deleteMany(),
    prisma.userProfile.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  await prisma.user.create({ data: { id: seededUserProfile.userId } });
  await prisma.userProfile.create({
    data: {
      userId: seededUserProfile.userId,
      data: data(seededUserProfile),
    },
  });
  await prisma.userContextSnapshot.create({
    data: {
      id: seededConsumerContext.snapshotId,
      userId: seededConsumerContext.userId,
      data: data(seededConsumerContext),
      createdAt: new Date(seededConsumerContext.createdAt),
    },
  });

  for (const merchant of seededMerchants) {
    await prisma.merchant.create({
      data: {
        id: merchant.id,
        data: data(merchant),
      },
    });
  }

  for (const product of seededMerchantProducts) {
    await prisma.merchantProduct.create({
      data: {
        id: product.id,
        merchantId: product.merchantId,
        data: data(product),
      },
    });
  }

  for (const goal of seededMerchantGoals) {
    await prisma.merchantGoal.create({
      data: {
        id: goal.id,
        merchantId: goal.merchantId,
        data: data(goal),
      },
    });
  }

  for (const rule of seededMerchantRules) {
    await prisma.merchantRule.create({
      data: {
        merchantId: rule.merchantId,
        data: data(rule),
      },
    });
  }

  for (const signal of seededPaymentDensitySignals) {
    await prisma.merchantTransactionBaseline.create({
      data: {
        merchantId: signal.merchantId,
        data: data({
          merchantId: signal.merchantId,
          baselineTransactions: signal.baselineTransactions,
          baselineRevenue: signal.baselineRevenue,
        }),
      },
    });
    await prisma.merchantTransactionSnapshot.create({
      data: {
        merchantId: signal.merchantId,
        data: data(signal),
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Seeded City Wallet local data.");
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
