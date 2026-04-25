import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { MerchantRuleUpdateSchema } from "@city-wallet/contracts";
import { getRepository } from "@city-wallet/db";
import { refreshMerchantInsights } from "@city-wallet/merchant-intelligence-domain";

export async function handler(event: APIGatewayProxyEventV2) {
  const repository = getRepository();
  const method = event.requestContext.http.method;
  if (method === "POST" && event.rawPath === "/api/merchant-insights/refresh") return response(200, await refreshMerchantInsights(repository));
  if (method === "GET" && event.rawPath === "/api/merchant-insights") return response(200, await repository.listMerchantInsights());
  if (method === "GET" && event.rawPath === "/api/merchant/rules") return response(200, await repository.listMerchantRules());
  if (method === "POST" && event.rawPath === "/api/merchant/rules") return response(200, await repository.saveMerchantRule(MerchantRuleUpdateSchema.parse(parse(event))));
  return response(404, { error: "not found" });
}

function parse(event: APIGatewayProxyEventV2) {
  return event.body ? JSON.parse(event.body) : {};
}

function response(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify(body) };
}
