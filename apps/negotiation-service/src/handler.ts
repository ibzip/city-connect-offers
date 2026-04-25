import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { buildBundleCandidates, buildNegotiationBrief, runNegotiation, selectCandidateMerchants } from "@city-wallet/negotiation-domain";

export async function handler(event: APIGatewayProxyEventV2) {
  if (event.requestContext.http.method !== "POST" || event.rawPath !== "/api/negotiate") return response(404, { error: "not found" });
  const input = parse(event);
  const candidateMerchants = selectCandidateMerchants(input.merchants, input.merchantInsights, input.consumerContext);
  const bundleCandidates = buildBundleCandidates(input.merchants, candidateMerchants, input.merchantInsights, input.consumerContext);
  const negotiationBrief = buildNegotiationBrief({ ...input, candidateMerchants, bundleCandidates });
  const negotiationDecision = await runNegotiation({ brief: negotiationBrief, merchants: input.merchants });
  return response(200, { candidateMerchants, bundleCandidates, negotiationBrief, negotiationDecision });
}

function parse(event: APIGatewayProxyEventV2) {
  return event.body ? JSON.parse(event.body) : {};
}

function response(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify(body) };
}
