import { createContext, useCallback, useContext, useMemo, useReducer } from "react";
import type { ReactNode } from "react";
import type {
  AnalyticsEvent,
  AnalyticsEventType,
  ConsumerContext,
  DemoTimelineStep,
  LayerKey,
  MerchantAnalytics,
  MerchantConfig,
  MerchantInsightSnapshot,
  Offer,
  OfferStatus,
  RedemptionToken,
  TriggerConfig,
  TriggerEvent,
} from "../types";
import { merchants as seedMerchants, merchantPaymentDensity } from "../config/merchants";
import { triggers as seedTriggers } from "../config/triggers";
import { defaultConsumerContext } from "../config/consumer";
import { buildMerchantInsightSnapshot } from "../services/insightEngine";
import { orchestrate, type OrchestrationResult } from "../services/orchestrator";
import { calculateCashback, issueTokens } from "../services/redemption";

interface State {
  consumer: ConsumerContext;
  merchants: MerchantConfig[];
  insights: MerchantInsightSnapshot[];
  triggers: TriggerConfig[];
  events: AnalyticsEvent[];
  timeline: DemoTimelineStep[];
  lastOrchestration: OrchestrationResult | null;
  offer: Offer | null;
  tokens: RedemptionToken[];
  analytics: Record<string, MerchantAnalytics>;
}

function freshAnalytics(): Record<string, MerchantAnalytics> {
  return Object.fromEntries(
    seedMerchants.map((m) => [
      m.id,
      {
        merchantId: m.id,
        offersGenerated: 0,
        offersAccepted: 0,
        tokensRedeemed: 0,
        cashbackIssuedEUR: 0,
        revenueInfluencedEUR: 0,
      },
    ]),
  );
}

function initialState(): State {
  return {
    consumer: defaultConsumerContext,
    merchants: seedMerchants,
    insights: [],
    triggers: seedTriggers,
    events: [],
    timeline: [],
    lastOrchestration: null,
    offer: null,
    tokens: [],
    analytics: freshAnalytics(),
  };
}

type Action =
  | { type: "RESET" }
  | { type: "SET_CONSUMER"; payload: ConsumerContext }
  | { type: "SET_MERCHANTS"; payload: MerchantConfig[] }
  | { type: "SET_INSIGHTS"; payload: MerchantInsightSnapshot[] }
  | { type: "SET_TRIGGERS"; payload: TriggerConfig[] }
  | { type: "PUSH_EVENT"; payload: AnalyticsEvent }
  | { type: "PUSH_EVENTS"; payload: AnalyticsEvent[] }
  | { type: "PUSH_TIMELINE"; payload: DemoTimelineStep }
  | { type: "SET_ORCH"; payload: OrchestrationResult | null }
  | { type: "SET_OFFER"; payload: Offer | null }
  | { type: "UPDATE_OFFER_STATUS"; payload: OfferStatus }
  | { type: "SET_TOKENS"; payload: RedemptionToken[] }
  | { type: "REDEEM_TOKEN"; payload: { tokenId: string; cashback: number } }
  | { type: "BUMP_ANALYTICS"; payload: { merchantId: string; patch: Partial<MerchantAnalytics> } };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "RESET":
      return initialState();
    case "SET_CONSUMER":
      return { ...state, consumer: action.payload };
    case "SET_MERCHANTS":
      return { ...state, merchants: action.payload };
    case "SET_INSIGHTS":
      return { ...state, insights: action.payload };
    case "SET_TRIGGERS":
      return { ...state, triggers: action.payload };
    case "PUSH_EVENT":
      return { ...state, events: [action.payload, ...state.events].slice(0, 200) };
    case "PUSH_EVENTS":
      return { ...state, events: [...action.payload, ...state.events].slice(0, 200) };
    case "PUSH_TIMELINE":
      return { ...state, timeline: [...state.timeline, action.payload] };
    case "SET_ORCH":
      return { ...state, lastOrchestration: action.payload };
    case "SET_OFFER":
      return { ...state, offer: action.payload };
    case "UPDATE_OFFER_STATUS":
      return state.offer ? { ...state, offer: { ...state.offer, status: action.payload } } : state;
    case "SET_TOKENS":
      return { ...state, tokens: action.payload };
    case "REDEEM_TOKEN": {
      const tokens = state.tokens.map((t) =>
        t.id === action.payload.tokenId
          ? { ...t, status: "redeemed" as const, cashbackIssuedEUR: action.payload.cashback, redeemedAt: Date.now() }
          : t,
      );
      return { ...state, tokens };
    }
    case "BUMP_ANALYTICS": {
      const cur = state.analytics[action.payload.merchantId];
      if (!cur) return state;
      const next: MerchantAnalytics = {
        merchantId: cur.merchantId,
        offersGenerated: cur.offersGenerated + (action.payload.patch.offersGenerated ?? 0),
        offersAccepted: cur.offersAccepted + (action.payload.patch.offersAccepted ?? 0),
        tokensRedeemed: cur.tokensRedeemed + (action.payload.patch.tokensRedeemed ?? 0),
        cashbackIssuedEUR: cur.cashbackIssuedEUR + (action.payload.patch.cashbackIssuedEUR ?? 0),
        revenueInfluencedEUR: cur.revenueInfluencedEUR + (action.payload.patch.revenueInfluencedEUR ?? 0),
      };
      return { ...state, analytics: { ...state.analytics, [cur.merchantId]: next } };
    }
    default:
      return state;
  }
}

function mkEvent(
  type: AnalyticsEventType,
  layer: LayerKey,
  message: string,
  data?: Record<string, unknown>,
): AnalyticsEvent {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    layer,
    message,
    data,
    ts: Date.now(),
  };
}

function mkStep(title: string, layer: LayerKey, detail?: string): DemoTimelineStep {
  return { id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, title, layer, ts: Date.now(), detail };
}

interface AppStoreContextValue {
  state: State;
  refreshMerchantInsights: () => void;
  updateConsumerContext: (next: ConsumerContext) => void;
  updateMerchant: (m: MerchantConfig) => void;
  triggerEvent: (event: TriggerEvent) => void;
  claimOffer: () => void;
  dismissOffer: () => void;
  redeemToken: (tokenId: string) => void;
  resetDemo: () => void;
}

const AppStoreContext = createContext<AppStoreContextValue | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  const refreshMerchantInsights = useCallback(() => {
    const insights = state.merchants.map((m) => {
      const d = merchantPaymentDensity.find((x) => x.merchantId === m.id)!;
      return buildMerchantInsightSnapshot(
        m,
        d,
        state.consumer.weather.temperatureC,
        state.consumer.time.label,
      );
    });
    dispatch({ type: "SET_INSIGHTS", payload: insights });
    dispatch({
      type: "PUSH_EVENTS",
      payload: insights.map((i) =>
        mkEvent("merchant_insight_updated", "merchant", `Insight updated for ${i.merchantId}: ${i.businessState} (urgency ${i.urgencyScore})`, { id: i.merchantId }),
      ),
    });
    dispatch({ type: "PUSH_TIMELINE", payload: mkStep("Merchant insights refreshed", "merchant", `${insights.length} merchant snapshots updated`) });
  }, [state.merchants, state.consumer]);

  const updateConsumerContext = useCallback((next: ConsumerContext) => {
    dispatch({ type: "SET_CONSUMER", payload: next });
    dispatch({ type: "PUSH_EVENT", payload: mkEvent("context_refreshed", "consumer", `Consumer context updated for ${next.user.displayName}`) });
  }, []);

  const updateMerchant = useCallback((m: MerchantConfig) => {
    const merchants = state.merchants.map((x) => (x.id === m.id ? m : x));
    dispatch({ type: "SET_MERCHANTS", payload: merchants });
  }, [state.merchants]);

  const triggerEvent = useCallback(
    (event: TriggerEvent) => {
      // Ensure insights exist
      let insights = state.insights;
      if (insights.length === 0) {
        insights = state.merchants.map((m) => {
          const d = merchantPaymentDensity.find((x) => x.merchantId === m.id)!;
          return buildMerchantInsightSnapshot(m, d, state.consumer.weather.temperatureC, state.consumer.time.label);
        });
        dispatch({ type: "SET_INSIGHTS", payload: insights });
      }

      const result = orchestrate(event, state.consumer, insights, state.triggers);
      dispatch({ type: "SET_ORCH", payload: result });

      const events: AnalyticsEvent[] = result.events.map((e) =>
        mkEvent(e.type, e.layer, e.message, e.data),
      );
      dispatch({ type: "PUSH_EVENTS", payload: events });
      dispatch({ type: "PUSH_TIMELINE", payload: mkStep(`Trigger: ${event}`, "config", `${result.candidates.filter((c) => c.considered).length} candidates → ${result.decision.decision}`) });
      dispatch({ type: "PUSH_TIMELINE", payload: mkStep("Negotiation decision", "negotiation", `${result.decision.decision} (confidence ${result.decision.confidence})`) });
      dispatch({ type: "PUSH_TIMELINE", payload: mkStep(result.validation.passed ? "Validation passed" : "Validation failed", "validation", `${result.validation.results.length} validators run`) });

      if (result.offer) {
        dispatch({ type: "SET_OFFER", payload: result.offer });
        result.offer.items.forEach((it) => {
          dispatch({ type: "BUMP_ANALYTICS", payload: { merchantId: it.merchantId, patch: { offersGenerated: 1 } } });
        });
        dispatch({ type: "PUSH_TIMELINE", payload: mkStep("Offer shown in wallet", "consumer", result.offer.headline) });
      }
    },
    [state.consumer, state.insights, state.merchants, state.triggers],
  );

  const claimOffer = useCallback(() => {
    if (!state.offer) return;
    dispatch({ type: "UPDATE_OFFER_STATUS", payload: "claimed" });
    const tokens = issueTokens({ ...state.offer, status: "claimed" });
    dispatch({ type: "SET_TOKENS", payload: tokens });
    dispatch({
      type: "PUSH_EVENTS",
      payload: [
        mkEvent("offer_accepted", "consumer", `Mia claimed bundle: ${state.offer.headline}`),
        ...tokens.map((t) =>
          mkEvent("redemption_token_issued", "redemption", `Token ${t.id} issued for ${t.merchantName}`, { tokenId: t.id }),
        ),
      ],
    });
    state.offer.items.forEach((it) => {
      dispatch({ type: "BUMP_ANALYTICS", payload: { merchantId: it.merchantId, patch: { offersAccepted: 1 } } });
    });
    dispatch({ type: "PUSH_TIMELINE", payload: mkStep("Bundle claimed — tokens issued", "redemption", `${tokens.length} tokens`) });
  }, [state.offer]);

  const dismissOffer = useCallback(() => {
    if (!state.offer) return;
    dispatch({ type: "UPDATE_OFFER_STATUS", payload: "dismissed" });
    dispatch({ type: "PUSH_EVENT", payload: mkEvent("offer_dismissed", "consumer", "Mia dismissed the offer") });
    dispatch({ type: "PUSH_TIMELINE", payload: mkStep("Offer dismissed", "consumer") });
  }, [state.offer]);

  const redeemToken = useCallback(
    (tokenId: string) => {
      const token = state.tokens.find((t) => t.id === tokenId);
      if (!token || token.status !== "active") return;
      const cashback = calculateCashback(token);
      dispatch({ type: "REDEEM_TOKEN", payload: { tokenId, cashback } });
      dispatch({
        type: "PUSH_EVENTS",
        payload: [
          mkEvent("token_redeemed", "redemption", `Token ${token.id} redeemed at ${token.merchantName}`),
          mkEvent("cashback_issued", "redemption", `€${cashback.toFixed(2)} cashback issued for ${token.productName}`),
        ],
      });
      dispatch({
        type: "BUMP_ANALYTICS",
        payload: {
          merchantId: token.merchantId,
          patch: {
            tokensRedeemed: 1,
            cashbackIssuedEUR: cashback,
            revenueInfluencedEUR: token.productPriceEUR,
          },
        },
      });
      dispatch({ type: "PUSH_TIMELINE", payload: mkStep(`Token redeemed at ${token.merchantName}`, "redemption", `€${cashback.toFixed(2)} cashback`) });
    },
    [state.tokens],
  );

  const resetDemo = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  const value = useMemo<AppStoreContextValue>(
    () => ({
      state,
      refreshMerchantInsights,
      updateConsumerContext,
      updateMerchant,
      triggerEvent,
      claimOffer,
      dismissOffer,
      redeemToken,
      resetDemo,
    }),
    [state, refreshMerchantInsights, updateConsumerContext, updateMerchant, triggerEvent, claimOffer, dismissOffer, redeemToken, resetDemo],
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore() {
  const ctx = useContext(AppStoreContext);
  if (!ctx) throw new Error("useAppStore must be used within AppStoreProvider");
  return ctx;
}