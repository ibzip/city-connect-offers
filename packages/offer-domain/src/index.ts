import type {
  ConsumerContextSnapshot,
  Merchant,
  NegotiationDecision,
  Offer,
  OfferItem,
} from "@city-wallet/contracts";
import type { CityWalletRepository } from "@city-wallet/db";
import { calculateDistanceMeters, makeId, nowIso, roundMoney } from "@city-wallet/utils";

export function calculateCashback(priceEuro: number, percent = 0) {
  return roundMoney(priceEuro * (percent / 100));
}

export async function createOfferFromDecision(input: {
  repository: CityWalletRepository;
  decision: NegotiationDecision;
  merchants: Merchant[];
  context: ConsumerContextSnapshot;
}) {
  const offer = buildOfferDisplayModel(input.decision, input.merchants, input.context);
  if (!offer) return null;
  return input.repository.saveOffer(offer);
}

export function buildOfferDisplayModel(
  decision: NegotiationDecision,
  merchants: Merchant[],
  context: ConsumerContextSnapshot,
): Offer | null {
  if (decision.decision === "no_offer") return null;

  const offerId = makeId("offer");
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + decision.validityMinutes * 60 * 1000).toISOString();
  const items: OfferItem[] = decision.selectedMerchants.map((selection) => {
    const merchant = merchants.find((candidate) => candidate.id === selection.merchantId);
    const product = merchant?.products.find((candidate) => candidate.name === selection.product) ?? merchant?.products[0];
    const priceEuro = product?.priceEuro ?? 0;
    const incentivePercent = selection.incentive.percent;
    const distanceMeters = merchant && context.userLocation && merchant.latitude !== undefined && merchant.longitude !== undefined
      ? calculateDistanceMeters(context.userLocation.latitude, context.userLocation.longitude, merchant.latitude, merchant.longitude)
      : merchant?.distanceMeters ?? 0;
    const isSimulatedDemoOffer = merchant?.participationStatus === "demo_partner";
    return {
      offerItemId: makeId("offer_item"),
      offerId,
      merchantId: selection.merchantId,
      merchantName: merchant?.name ?? selection.merchantId,
      product: selection.product,
      incentiveType: selection.incentive.type,
      incentivePercent,
      priceEuro,
      estimatedCashbackEuro: selection.incentive.type === "cashback" ? calculateCashback(priceEuro, incentivePercent) : undefined,
      distanceMeters,
      merchantParticipationStatus: merchant?.participationStatus ?? "partner",
      merchantSource: merchant?.source,
      isSimulatedDemoOffer,
      demoDisclosure: merchant?.demoDisclosure,
    };
  });
  const isSimulatedDemoOffer = items.some((item) => item.isSimulatedDemoOffer);

  return {
    offerId,
    consumerId: context.userId,
    type: decision.decision === "bundle_offer" ? "bundle_offer" : "single_offer",
    status: "shown",
    headline: decision.consumerHeadline,
    subheadline: decision.consumerSubheadline,
    cta: decision.cta,
    validityMinutes: decision.validityMinutes,
    expiresAt,
    createdAt,
    isSimulatedDemoOffer,
    disclosure: isSimulatedDemoOffer
      ? "Simulated demo offer. The discovered business has not consented as an official partner; redemption is simulated only."
      : undefined,
    items,
    why: decision.reasoning,
  };
}

export async function listOffers(repository: CityWalletRepository, userId?: string) {
  return repository.listOffers(userId);
}

export async function getOffer(repository: CityWalletRepository, offerId: string) {
  return repository.getOffer(offerId);
}

export function offerCreatedEventPayload(offer: Offer) {
  return {
    offerId: offer.offerId,
    type: offer.type,
    status: offer.status,
    itemCount: offer.items.length,
    createdAt: nowIso(),
  };
}
