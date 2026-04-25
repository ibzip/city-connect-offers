import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { getRepository } from "@city-wallet/db";
import { createRedemptionTokens, redeemToken } from "@city-wallet/redemption-domain";

export async function handler(event: APIGatewayProxyEventV2) {
  const repository = getRepository();
  const claim = event.rawPath.match(/^\/api\/offers\/([^/]+)\/claim$/);
  if (event.requestContext.http.method === "POST" && claim) return response(200, await createRedemptionTokens(repository, claim[1]));
  if (event.requestContext.http.method === "POST" && event.rawPath === "/api/redemption/redeem") return response(200, await redeemToken(repository, parse(event)));
  return response(404, { error: "not found" });
}

function parse(event: APIGatewayProxyEventV2) {
  return event.body ? JSON.parse(event.body) : {};
}

function response(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify(body) };
}
