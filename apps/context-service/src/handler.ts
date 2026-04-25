import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { buildConsumerContextSnapshot } from "@city-wallet/context-domain";
import { getRepository } from "@city-wallet/db";

export async function handler(event: APIGatewayProxyEventV2) {
  if (event.requestContext.http.method !== "POST" || event.rawPath !== "/api/context/build") {
    return response(404, { error: "not found" });
  }
  const result = await buildConsumerContextSnapshot(getRepository(), parse(event));
  return response(200, result);
}

function parse(event: APIGatewayProxyEventV2) {
  return event.body ? JSON.parse(event.body) : {};
}

function response(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify(body) };
}
