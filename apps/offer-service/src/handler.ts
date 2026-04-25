import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { getRepository } from "@city-wallet/db";
import { createOfferFromDecision } from "@city-wallet/offer-domain";

export async function handler(event: APIGatewayProxyEventV2) {
  const repository = getRepository();
  const method = event.requestContext.http.method;
  if (method === "POST" && event.rawPath === "/api/offers/create") return response(200, await createOfferFromDecision({ repository, ...parse(event) }));
  if (method === "GET" && event.rawPath === "/api/offers") return response(200, await repository.listOffers(event.queryStringParameters?.userId));
  const match = event.rawPath.match(/^\/api\/offers\/([^/]+)$/);
  if (method === "GET" && match) return response(200, await repository.getOffer(match[1]));
  return response(404, { error: "not found" });
}

function parse(event: APIGatewayProxyEventV2) {
  return event.body ? JSON.parse(event.body) : {};
}

function response(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify(body) };
}
