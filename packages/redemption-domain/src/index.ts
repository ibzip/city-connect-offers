import type { CityWalletRepository } from "@city-wallet/db";
import type { Offer, RedemptionResult, RedemptionToken } from "@city-wallet/contracts";
import { seedScenario } from "@city-wallet/data-seed";
import { makeId, nowIso, roundMoney, stableHash } from "@city-wallet/utils";

export async function createRedemptionTokens(repository: CityWalletRepository, offerId: string) {
  const offer = await repository.getOffer(offerId);
  if (!offer) {
    throw new Error(`Unknown offer ${offerId}`);
  }

  const tokens = offer.items.map((item): RedemptionToken => {
    const code = seedScenario.deterministicTokenCodes[item.merchantId as keyof typeof seedScenario.deterministicTokenCodes] ??
      `CW-${stableHash(`${offer.offerId}:${item.merchantId}:${item.offerItemId}`).slice(0, 8)}`;

    return {
      tokenId: makeId("token"),
      offerId: offer.offerId,
      offerItemId: item.offerItemId,
      merchantId: item.merchantId,
      merchantName: item.merchantName,
      product: item.product,
      status: "active",
      code,
      cashbackEuro: item.estimatedCashbackEuro ?? calculateItemCashback(item.priceEuro, item.incentivePercent),
      createdAt: nowIso(),
    };
  });

  await repository.updateOfferStatus(offer.offerId, "accepted");
  return repository.saveRedemptionTokens(tokens);
}

export async function validateRedemptionToken(
  repository: CityWalletRepository,
  input: { code: string; merchantId: string },
) {
  const token = await repository.getRedemptionTokenByCode(input.code);
  if (!token) {
    return { valid: false, message: "Unknown token.", token: null };
  }
  if (token.status !== "active") {
    return { valid: false, message: `Token is ${token.status}.`, token };
  }
  if (token.merchantId !== input.merchantId) {
    return { valid: false, message: "Token is for a different merchant.", token };
  }
  return { valid: true, message: "Token is valid.", token };
}

export async function redeemToken(
  repository: CityWalletRepository,
  input: { code: string; merchantId: string },
): Promise<RedemptionResult> {
  const validation = await validateRedemptionToken(repository, input);
  if (!validation.valid || !validation.token) {
    return {
      success: false,
      token: validation.token ?? undefined,
      cashbackIssuedEuro: 0,
      message: validation.message,
    };
  }

  const token: RedemptionToken = {
    ...validation.token,
    status: "redeemed",
    redeemedAt: nowIso(),
  };
  await repository.updateRedemptionToken(token);
  const offer = await repository.getOffer(token.offerId);
  if (offer) {
    const allTokens = await repository.listRedemptionTokens(token.offerId);
    if (allTokens.every((candidate) => candidate.status === "redeemed" || candidate.tokenId === token.tokenId)) {
      await repository.updateOfferStatus(token.offerId, "redeemed");
    }
  }

  const result: RedemptionResult = {
    success: true,
    token,
    cashbackIssuedEuro: token.cashbackEuro,
    message: `Redeemed ${token.code}; €${token.cashbackEuro.toFixed(2)} cashback issued.`,
  };

  await repository.saveRedemption({
    ...result,
    merchantId: token.merchantId,
    offerId: token.offerId,
    tokenId: token.tokenId,
    createdAt: nowIso(),
  });
  if (offer) {
    await repository.saveCashbackLedgerEntry({
      id: makeId("cashback"),
      userId: offer.consumerId,
      offerId: token.offerId,
      merchantId: token.merchantId,
      amountEuro: token.cashbackEuro,
      createdAt: nowIso(),
    });
  }
  return result;
}

function calculateItemCashback(priceEuro: number, percent = 0) {
  return roundMoney(priceEuro * (percent / 100));
}
