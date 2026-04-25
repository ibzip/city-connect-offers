import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { buildConsumerActivityTimeline, buildMerchantDashboardMetrics, recordAnalyticsEvent } from "@city-wallet/analytics-domain";
import { getRepository } from "@city-wallet/db";

export async function handler(event: APIGatewayProxyEventV2) {
  const repository = getRepository();
  const method = event.requestContext.http.method;
  if (method === "POST" && event.rawPath === "/api/events") return response(200, await recordAnalyticsEvent(repository, parse(event)));
  if (method === "GET" && event.rawPath === "/api/events") return response(200, await repository.listAnalyticsEvents(100));
  if (method === "GET" && event.rawPath === "/api/merchant-dashboard") return response(200, await buildMerchantDashboardMetrics(repository));
  if (method === "GET" && event.rawPath === "/api/consumer-timeline") return response(200, await buildConsumerActivityTimeline(repository));
  return response(404, { error: "not found" });
}

function parse(event: APIGatewayProxyEventV2) {
  return event.body ? JSON.parse(event.body) : {};
}

function response(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify(body) };
}
