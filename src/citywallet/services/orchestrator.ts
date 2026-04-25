import type {
  AnalyticsEvent,
  CandidateBundle,
  CandidateMerchant,
  ConsumerAgentPosition,
  ConsumerContext,
  MerchantInsightSnapshot,
  NegotiationBrief,
  NegotiationDecision,
  Offer,
  TriggerConfig,
  TriggerEvent,
  ValidationReport,
} from "../types";
import { merchants } from "../config/merchants";
import { bundlePolicy, offerPolicy, platformGoalModel } from "../config/policies";
import { buildConsumerAgentPosition } from "../config/consumer";
import { buildCandidateBundles, selectCandidateMerchants } from "./candidates";
import { negotiate, type NegotiationSource } from "./negotiationAgent";
import { evaluateTriggers, type TriggerMatch } from "./triggerEvaluator";
import { validateDecision } from "./validators";
import { buildOfferFromDecision } from "./redemption";

export interface OrchestrationResult {
  triggerEvent: TriggerEvent;
  triggerMatches: TriggerMatch[];
  consumerAgent: ConsumerAgentPosition;
  candidates: CandidateMerchant[];
  candidateBundles: CandidateBundle[];
  brief: NegotiationBrief;
  decision: NegotiationDecision;
  validation: ValidationReport;
  offer: Offer | null;
  events: Omit<AnalyticsEvent, "id" | "ts">[];
  llm: {
    source: NegotiationSource;
    model?: string;
    reason?: string;
    latencyMs: number;
  };
}

export async function orchestrate(
  event: TriggerEvent,
  ctx: ConsumerContext,
  insights: MerchantInsightSnapshot[],
  triggers: TriggerConfig[],
): Promise<OrchestrationResult> {
  const events: Omit<AnalyticsEvent, "id" | "ts">[] = [];

  const triggerMatches = evaluateTriggers(triggers, event);
  const matched = triggerMatches.find((t) => t.matched);
  events.push({
    type: "trigger_matched",
    layer: "config",
    message: matched
      ? `Trigger "${matched.trigger.eventType}" matched → request_negotiation`
      : `No enabled trigger matched event ${event}`,
    data: { event },
  });

  const consumerAgent = buildConsumerAgentPosition(ctx.declared);
  const candidates = selectCandidateMerchants(merchants, insights, ctx);
  const candidateBundles = buildCandidateBundles(merchants, candidates, insights, ctx);

  const brief: NegotiationBrief = {
    context: ctx,
    consumerAgentPosition: consumerAgent,
    insights,
    candidates,
    candidateBundles,
    bundlePolicy,
    offerPolicy,
    platformGoals: platformGoalModel,
  };

  events.push({
    type: "negotiation_requested",
    layer: "negotiation",
    message: `Negotiation requested with ${candidates.filter((c) => c.considered).length} considered merchants and ${candidateBundles.length} bundle candidates`,
  });

  const result = await negotiate(brief);
  const decision = result.decision;

  events.push({
    type: "negotiation_decision_created",
    layer: "negotiation",
    message: `Decision: ${decision.decision} (confidence ${decision.confidence}) — ${result.source}${result.model ? ` · ${result.model}` : ""}${result.reason ? ` · ${result.reason}` : ""} · ${result.latencyMs}ms`,
    data: { decision: decision.decision, source: result.source, latencyMs: result.latencyMs },
  });

  const validation = validateDecision(decision, merchants, ctx.declared.walkingToleranceMeters);
  events.push({
    type: "offer_validated",
    layer: "validation",
    message: validation.passed
      ? `All ${validation.results.length} validators passed`
      : `Validation failed: ${validation.results.filter((r) => !r.passed).map((r) => r.validator).join(", ")}`,
  });

  let offer: Offer | null = null;
  if (validation.passed) {
    offer = buildOfferFromDecision(decision);
    if (offer) {
      events.push({
        type: "offer_shown",
        layer: "consumer",
        message: `Offer shown to ${ctx.user.displayName}: ${offer.headline}`,
      });
    }
  }

  return {
    triggerEvent: event,
    triggerMatches,
    consumerAgent,
    candidates,
    candidateBundles,
    brief,
    decision,
    validation,
    offer,
    events,
    llm: {
      source: result.source,
      model: result.model,
      reason: result.reason,
      latencyMs: result.latencyMs,
    },
  };
}