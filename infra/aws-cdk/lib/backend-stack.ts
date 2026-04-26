import * as path from "node:path";
import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export interface CityWalletBackendStackProps extends StackProps {
  dbSecret: secretsmanager.ISecret;
  dbEndpointAddress: string;
  lambdaSecurityGroup: ec2.ISecurityGroup;
  vpc: ec2.IVpc;
}

const serviceApps = [
  { id: "ContextService", directory: "context-service", routes: [{ method: apigwv2.HttpMethod.POST, path: "/api/context/build" }] },
  { id: "MerchantIntelligenceService", directory: "merchant-intelligence-service", routes: [
    { method: apigwv2.HttpMethod.POST, path: "/api/merchant-insights/refresh" },
    { method: apigwv2.HttpMethod.POST, path: "/api/commerce-zones/activate" },
    { method: apigwv2.HttpMethod.GET, path: "/api/commerce-zones" },
    { method: apigwv2.HttpMethod.GET, path: "/api/commerce-zones/city-suggestions" },
    { method: apigwv2.HttpMethod.GET, path: "/api/merchant-import-runs" },
    { method: apigwv2.HttpMethod.POST, path: "/api/merchant-import-runs/{runId}/continue" },
    { method: apigwv2.HttpMethod.POST, path: "/api/merchant-discovery/refresh" },
    { method: apigwv2.HttpMethod.GET, path: "/api/merchant-insights" },
    { method: apigwv2.HttpMethod.GET, path: "/api/merchant/rules" },
    { method: apigwv2.HttpMethod.POST, path: "/api/merchant/rules" },
  ] },
  { id: "NegotiationService", directory: "negotiation-service", routes: [{ method: apigwv2.HttpMethod.POST, path: "/api/negotiate" }] },
  { id: "ValidationService", directory: "validation-service", routes: [{ method: apigwv2.HttpMethod.POST, path: "/api/validate" }] },
  { id: "OfferService", directory: "offer-service", routes: [
    { method: apigwv2.HttpMethod.POST, path: "/api/offers/create" },
    { method: apigwv2.HttpMethod.GET, path: "/api/offers" },
    { method: apigwv2.HttpMethod.GET, path: "/api/offers/{offerId}" },
  ] },
  { id: "RedemptionService", directory: "redemption-service", routes: [
    { method: apigwv2.HttpMethod.POST, path: "/api/offers/{offerId}/claim" },
    { method: apigwv2.HttpMethod.POST, path: "/api/redemption/redeem" },
  ] },
  { id: "AnalyticsService", directory: "analytics-service", routes: [
    { method: apigwv2.HttpMethod.POST, path: "/api/events" },
    { method: apigwv2.HttpMethod.GET, path: "/api/events" },
    { method: apigwv2.HttpMethod.GET, path: "/api/merchant-dashboard" },
    { method: apigwv2.HttpMethod.GET, path: "/api/consumer-timeline" },
  ] },
];

export class CityWalletBackendStack extends Stack {
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: CityWalletBackendStackProps) {
    super(scope, id, props);
    const allowedOrigins = [
      "http://localhost:3000",
      "http://localhost:3001",
      process.env.CONSUMER_WALLET_ORIGIN,
      process.env.MERCHANT_PORTAL_ORIGIN,
    ].filter((origin): origin is string => Boolean(origin));

    const httpApi = new apigwv2.HttpApi(this, "CityWalletHttpApi", {
      corsPreflight: {
        allowHeaders: ["content-type", "authorization"],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowOrigins: allowedOrigins,
      },
    });
    this.apiUrl = httpApi.apiEndpoint;

    const serviceUrlEnvironment = {
      CONTEXT_SERVICE_URL: httpApi.apiEndpoint,
      MERCHANT_INTELLIGENCE_SERVICE_URL: httpApi.apiEndpoint,
      NEGOTIATION_SERVICE_URL: httpApi.apiEndpoint,
      VALIDATION_SERVICE_URL: httpApi.apiEndpoint,
      OFFER_SERVICE_URL: httpApi.apiEndpoint,
      REDEMPTION_SERVICE_URL: httpApi.apiEndpoint,
      ANALYTICS_SERVICE_URL: httpApi.apiEndpoint,
    };

    const apiGatewayFunction = this.createFunction("ApiGatewayOrchestrator", "api-gateway", {
      SERVICE_INVOCATION_MODE: process.env.SERVICE_INVOCATION_MODE ?? "local",
      DATABASE_URL_SECRET_NAME: props.dbSecret.secretName,
      DB_ENDPOINT_ADDRESS: props.dbEndpointAddress,
      CONSUMER_WALLET_ORIGIN: process.env.CONSUMER_WALLET_ORIGIN ?? "http://localhost:3000",
      MERCHANT_PORTAL_ORIGIN: process.env.MERCHANT_PORTAL_ORIGIN ?? "http://localhost:3001",
      OPENAI_API_KEY_PARAMETER_NAME: "/city-wallet/openai-api-key",
      AZURE_OPENAI_API_KEY_PARAMETER_NAME: "/city-wallet/azure-openai-api-key",
      AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT ?? "",
      AZURE_OPENAI_DEPLOYMENT: process.env.AZURE_OPENAI_DEPLOYMENT ?? "",
      AZURE_OPENAI_API_VERSION: process.env.AZURE_OPENAI_API_VERSION ?? "",
      AZURE_OPENAI_TIMEOUT_MS: process.env.AZURE_OPENAI_TIMEOUT_MS ?? "15000",
      LLM_PROVIDER: process.env.LLM_PROVIDER ?? "mock_llm",
      PAYONE_API_KEY_PARAMETER_NAME: "/city-wallet/payone-api-key",
      WEATHER_API_KEY_PARAMETER_NAME: "/city-wallet/weather-api-key",
      TAVILY_API_KEY_PARAMETER_NAME: "/city-wallet/tavily-api-key",
      NOMINATIM_USER_AGENT: process.env.NOMINATIM_USER_AGENT ?? "CityWalletHackathonMVP/0.1 local-dev",
      OVERPASS_USER_AGENT: process.env.OVERPASS_USER_AGENT ?? "CityWalletHackathonMVP/0.1 local-dev",
      CITY_IMPORT_POI_PROVIDER: process.env.CITY_IMPORT_POI_PROVIDER ?? "google_places",
      GOOGLE_PLACES_API_KEY_PARAMETER_NAME: "/city-wallet/google-places-api-key",
      GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY ?? "",
      GOOGLE_PLACES_MAX_REQUESTS_PER_IMPORT: process.env.GOOGLE_PLACES_MAX_REQUESTS_PER_IMPORT ?? "300",
      GOOGLE_PLACES_MAX_IMPORTED_MERCHANTS: process.env.GOOGLE_PLACES_MAX_IMPORTED_MERCHANTS ?? "1000",
      GOOGLE_PLACES_DEFAULT_RADIUS_METERS: process.env.GOOGLE_PLACES_DEFAULT_RADIUS_METERS ?? "20000",
      GOOGLE_PLACES_TIMEOUT_MS: process.env.GOOGLE_PLACES_TIMEOUT_MS ?? "6000",
      ENABLE_OVERPASS_IMPORT_FALLBACK: process.env.ENABLE_OVERPASS_IMPORT_FALLBACK ?? "true",
      ENABLE_WALLET_LIVE_DISCOVERY_FALLBACK: process.env.ENABLE_WALLET_LIVE_DISCOVERY_FALLBACK ?? "false",
      ENABLE_DEV_RESET: process.env.ENABLE_DEV_RESET ?? "false",
      ENABLE_DEV_CONTEXT_SIMULATOR: process.env.ENABLE_DEV_CONTEXT_SIMULATOR ?? "false",
      CONTEXT_SNAPSHOT_TTL_MINUTES: process.env.CONTEXT_SNAPSHOT_TTL_MINUTES ?? "15",
      LOCATION_CHANGE_THRESHOLD_METERS: process.env.LOCATION_CHANGE_THRESHOLD_METERS ?? "50",
      USER_CONTEXT_AGENT_TIMEOUT_MS: process.env.USER_CONTEXT_AGENT_TIMEOUT_MS ?? "12000",
      USER_NEGOTIATOR_AGENT_TIMEOUT_MS: process.env.USER_NEGOTIATOR_AGENT_TIMEOUT_MS ?? "12000",
      DEBUG_STORE_RAW_CONTEXT: process.env.DEBUG_STORE_RAW_CONTEXT ?? "false",
      ...serviceUrlEnvironment,
    }, props.vpc, props.lambdaSecurityGroup);
    props.dbSecret.grantRead(apiGatewayFunction);
    httpApi.addRoutes({
      path: "/api/{proxy+}",
      methods: [apigwv2.HttpMethod.ANY],
      integration: new integrations.HttpLambdaIntegration("ApiGatewayIntegration", apiGatewayFunction),
    });

    for (const app of serviceApps) {
      const fn = this.createFunction(app.id, app.directory, {
        SERVICE_INVOCATION_MODE: "local",
        DATABASE_URL_SECRET_NAME: props.dbSecret.secretName,
        DB_ENDPOINT_ADDRESS: props.dbEndpointAddress,
        OPENAI_API_KEY_PARAMETER_NAME: "/city-wallet/openai-api-key",
        AZURE_OPENAI_API_KEY_PARAMETER_NAME: "/city-wallet/azure-openai-api-key",
        AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT ?? "",
        AZURE_OPENAI_DEPLOYMENT: process.env.AZURE_OPENAI_DEPLOYMENT ?? "",
        AZURE_OPENAI_API_VERSION: process.env.AZURE_OPENAI_API_VERSION ?? "",
        AZURE_OPENAI_TIMEOUT_MS: process.env.AZURE_OPENAI_TIMEOUT_MS ?? "15000",
        LLM_PROVIDER: process.env.LLM_PROVIDER ?? "mock_llm",
        PAYONE_API_KEY_PARAMETER_NAME: "/city-wallet/payone-api-key",
        WEATHER_API_KEY_PARAMETER_NAME: "/city-wallet/weather-api-key",
        TAVILY_API_KEY_PARAMETER_NAME: "/city-wallet/tavily-api-key",
        NOMINATIM_USER_AGENT: process.env.NOMINATIM_USER_AGENT ?? "CityWalletHackathonMVP/0.1 local-dev",
        OVERPASS_USER_AGENT: process.env.OVERPASS_USER_AGENT ?? "CityWalletHackathonMVP/0.1 local-dev",
        CITY_IMPORT_POI_PROVIDER: process.env.CITY_IMPORT_POI_PROVIDER ?? "google_places",
        GOOGLE_PLACES_API_KEY_PARAMETER_NAME: "/city-wallet/google-places-api-key",
        GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY ?? "",
        GOOGLE_PLACES_MAX_REQUESTS_PER_IMPORT: process.env.GOOGLE_PLACES_MAX_REQUESTS_PER_IMPORT ?? "300",
        GOOGLE_PLACES_MAX_IMPORTED_MERCHANTS: process.env.GOOGLE_PLACES_MAX_IMPORTED_MERCHANTS ?? "1000",
        GOOGLE_PLACES_DEFAULT_RADIUS_METERS: process.env.GOOGLE_PLACES_DEFAULT_RADIUS_METERS ?? "20000",
        GOOGLE_PLACES_TIMEOUT_MS: process.env.GOOGLE_PLACES_TIMEOUT_MS ?? "6000",
        ENABLE_OVERPASS_IMPORT_FALLBACK: process.env.ENABLE_OVERPASS_IMPORT_FALLBACK ?? "true",
        ENABLE_WALLET_LIVE_DISCOVERY_FALLBACK: process.env.ENABLE_WALLET_LIVE_DISCOVERY_FALLBACK ?? "false",
        ENABLE_DEV_RESET: process.env.ENABLE_DEV_RESET ?? "false",
        ENABLE_DEV_CONTEXT_SIMULATOR: process.env.ENABLE_DEV_CONTEXT_SIMULATOR ?? "false",
        CONTEXT_SNAPSHOT_TTL_MINUTES: process.env.CONTEXT_SNAPSHOT_TTL_MINUTES ?? "15",
        LOCATION_CHANGE_THRESHOLD_METERS: process.env.LOCATION_CHANGE_THRESHOLD_METERS ?? "50",
        USER_CONTEXT_AGENT_TIMEOUT_MS: process.env.USER_CONTEXT_AGENT_TIMEOUT_MS ?? "12000",
        USER_NEGOTIATOR_AGENT_TIMEOUT_MS: process.env.USER_NEGOTIATOR_AGENT_TIMEOUT_MS ?? "12000",
        DEBUG_STORE_RAW_CONTEXT: process.env.DEBUG_STORE_RAW_CONTEXT ?? "false",
      }, props.vpc, props.lambdaSecurityGroup);
      props.dbSecret.grantRead(fn);
      for (const route of app.routes) {
        httpApi.addRoutes({
          path: route.path,
          methods: [route.method],
          integration: new integrations.HttpLambdaIntegration(`${app.id}${route.method}${route.path}`.replace(/\W/g, ""), fn),
        });
      }
    }

    new CfnOutput(this, "ApiGatewayUrl", { value: httpApi.apiEndpoint });
  }

  private createFunction(id: string, appDirectory: string, environment: Record<string, string>, vpc: ec2.IVpc, securityGroup: ec2.ISecurityGroup) {
    const repoRoot = path.join(__dirname, "../../..");
    const fn = new NodejsFunction(this, id, {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(repoRoot, "apps", appDirectory, "src/handler.ts"),
      handler: "handler",
      depsLockFilePath: path.join(repoRoot, "pnpm-lock.yaml"),
      projectRoot: repoRoot,
      timeout: Duration.seconds(20),
      memorySize: 512,
      vpc,
      securityGroups: [securityGroup],
      environment: {
        ...environment,
        CITY_WALLET_REPOSITORY: "prisma",
        NODE_OPTIONS: "--enable-source-maps",
      },
      bundling: {
        format: OutputFormat.CJS,
        minify: false,
        sourceMap: true,
        target: "node20",
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ["ssm:GetParameter", "secretsmanager:GetSecretValue"],
      resources: ["*"],
    }));
    return fn;
  }
}
