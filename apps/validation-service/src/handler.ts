import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { validateNegotiationDecision } from "@city-wallet/validation-domain";

export async function handler(event: APIGatewayProxyEventV2) {
  if (event.requestContext.http.method !== "POST" || event.rawPath !== "/api/validate") return response(404, { error: "not found" });
  return response(200, validateNegotiationDecision(parse(event)));
}

function parse(event: APIGatewayProxyEventV2) {
  return event.body ? JSON.parse(event.body) : {};
}

function response(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify(body) };
}
