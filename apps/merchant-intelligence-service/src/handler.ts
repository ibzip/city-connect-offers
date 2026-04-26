import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  ActivateCommerceZoneRequestSchema,
  MerchantRuleCompilePreviewRequestSchema,
  MerchantRuleUpdateSchema,
  MerchantUpdateSchema,
} from "@city-wallet/contracts";
import { getRepository } from "@city-wallet/db";
import {
  activateCommerceZoneAndImport,
  compileAndApplyMerchantRules,
  compileMerchantFreeformRules,
  continueMerchantImportRun,
  FreeformRuleCompilationError,
  refreshMerchantInsights,
  runOptionalMerchantDiscovery,
  suggestCommerceCities,
} from "@city-wallet/merchant-intelligence-domain";

export async function handler(event: APIGatewayProxyEventV2) {
  const repository = getRepository();
  const method = event.requestContext.http.method;
  if (method === "POST" && event.rawPath === "/api/merchant-insights/refresh") {
    const input = parse(event) as { merchantIds?: string[] };
    return response(200, await refreshMerchantInsights(repository, input.merchantIds));
  }
  if (method === "POST" && event.rawPath === "/api/commerce-zones/activate") {
    return response(200, await activateCommerceZoneAndImport({ repository, request: ActivateCommerceZoneRequestSchema.parse(parse(event)) }));
  }
  if (method === "GET" && event.rawPath === "/api/commerce-zones/city-suggestions") {
    return response(200, await suggestCommerceCities({
      repository,
      query: event.queryStringParameters?.query ?? "",
      country: event.queryStringParameters?.country,
    }));
  }
  const continueMatch = event.rawPath.match(/^\/api\/merchant-import-runs\/([^/]+)\/continue$/);
  if (method === "POST" && continueMatch) return response(200, await continueMerchantImportRun({ repository, runId: continueMatch[1] }));
  if (method === "GET" && event.rawPath === "/api/commerce-zones") return response(200, await repository.listCommerceZones());
  if (method === "GET" && event.rawPath === "/api/merchant-import-runs") return response(200, await repository.listMerchantImportRuns());
  if (method === "POST" && event.rawPath === "/api/merchant-discovery/refresh") {
    const input = parse(event);
    return response(200, await runOptionalMerchantDiscovery({ repository, context: input.context, budget: input.budget }));
  }
  if (method === "POST" && event.rawPath === "/api/merchant/rules/compile-preview") {
    return response(200, await compileMerchantFreeformRules(MerchantRuleCompilePreviewRequestSchema.parse(parse(event))));
  }
  if (method === "GET" && event.rawPath === "/api/merchant-insights") return response(200, await repository.listMerchantInsights());
  const merchantUpdateMatch = event.rawPath.match(/^\/api\/merchants\/([^/]+)$/);
  if ((method === "POST" || method === "PATCH") && merchantUpdateMatch) {
    const merchant = MerchantUpdateSchema.parse(parse(event));
    if (merchant.id !== merchantUpdateMatch[1]) return response(400, { error: "Merchant id in path and payload must match." });
    let compiled;
    try {
      compiled = await compileAndApplyMerchantRules(merchant);
    } catch (error) {
      if (error instanceof FreeformRuleCompilationError) {
        return response(400, error.preview ?? { ok: false, error: error.message });
      }
      throw error;
    }
    const saved = await repository.saveMerchant(compiled.merchant);
    const insights = await refreshMerchantInsights(repository, [saved.id]);
    return response(200, { merchant: saved, insights });
  }
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
