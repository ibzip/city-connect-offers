# City Wallet

City Wallet is a hackathon MVP for a configurable, plugin-first, event-triggered local-commerce platform. The demo now runs through the actual product surfaces:

- Consumer Wallet: `apps/consumer-wallet`
- Merchant Portal: `apps/merchant-portal`

There is no operator console and no separate demo app. The original AI-generated Vite prototype is preserved only as a non-workspace reference under `legacy/vite-prototype`.

## Architecture

The monorepo uses pnpm workspaces and Turborepo.

- `apps/consumer-wallet`: static-exportable Next.js consumer app for wallet, offer claim, redemption, and debug.
- `apps/merchant-portal`: static-exportable Next.js merchant app for rules, dashboard, and debug.
- `apps/api-gateway`: AWS Lambda-style API Gateway/orchestration handler with a local dev adapter.
- `apps/context-service`, `apps/merchant-intelligence-service`, `apps/negotiation-service`, `apps/validation-service`, `apps/offer-service`, `apps/redemption-service`, `apps/analytics-service`: thin deployable Lambda wrappers around domain packages.
- `packages/contracts`: Zod schemas and shared TypeScript contracts.
- `packages/config`: providers, triggers, bundle policy, discovery/import policy, offer/copy policy, platform goal model.
- `packages/data-seed`: seeded Mia/Stuttgart/merchant scenario data only.
- `packages/db`: repository interfaces, seeded DB-like repository, Prisma repository wrapper.
- `packages/*-domain`: generic business logic by service boundary.
- `packages/providers`: provider interfaces, Open-Meteo weather, browser/demo location input handling, Nominatim geocoding, Overpass POI discovery, Tavily enrichment, and mock fallbacks.
- `packages/service-clients`: local/http service invocation clients.
- `packages/ui`: shared polished UI components and City Wallet design system.
- `infra/aws-cdk`: AWS CDK stacks for static frontends, Lambda/API Gateway, and RDS PostgreSQL.
- `prisma`: schema, SQL migration, and seed script.

## Local Run

```bash
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Local ports:

- Consumer Wallet: `http://localhost:3000`
- Merchant Portal: `http://localhost:3001`
- API Gateway: `http://localhost:3010`

`NEXT_PUBLIC_API_BASE_URL` defaults to `http://localhost:3010` when not set.

### Mobile Testing With Ngrok

When opening the wallet or merchant portal on a phone, `localhost` points at the phone, not your laptop. Use a separate HTTPS tunnel for the API Gateway:

```bash
ngrok http 3010
ngrok http 3000
ngrok http 3001
```

Open the frontend tunnel with the API tunnel as a runtime override:

```text
https://YOUR-CONSUMER.ngrok-free.app/wallet/?apiBaseUrl=https://YOUR-API.ngrok-free.app
https://YOUR-MERCHANT.ngrok-free.app/dashboard/?apiBaseUrl=https://YOUR-API.ngrok-free.app
```

The apps store `apiBaseUrl` in browser local storage, so subsequent page loads keep using the API tunnel. You can also set `NEXT_PUBLIC_API_BASE_URL` before starting/building the frontends, then restart the Next dev servers.

## Demo Flow

1. Open `http://localhost:3000/wallet`.
2. Use the seeded Mia profile and context controls.
3. On wallet load, the app emits `WalletOpened`, tries browser geolocation, falls back to demo geofence if needed, assembles context, evaluates `UserEnteredZone`, and orchestrates automatically.
4. Use **Use my real location** or **Refresh context** only as fallback/manual refresh actions; both still go through trigger evaluation.
5. The wallet shows: “Cold outside? Make it a warm city break.”
6. Claim the bundle to issue `CW-CAFE-91K` and `CW-BOOK-72Q`.
7. Open `/redeem` and redeem both tokens.
8. Open `http://localhost:3001/dashboard` to see merchant insights, redemptions, cashback, and event logs.
9. Click a merchant card in the dashboard to open a centered configuration dialog for that merchant's profile, products, goals, static rules, and free-form rules.

## City-Wide Merchant Import

Merchant discovery is now an onboarding/import action, not a normal wallet-open action.

1. Open `http://localhost:3001/dashboard`.
2. Use the top-banner **Import merchants** button.
3. Activate by city/country, center coordinate + radius, or coordinate box.
4. Configure radius, target imported merchants, checkpoint chunk size, categories, and per-category caps.
5. Click **Preview import** to see radius, existing stored merchant count, planned action, estimated provider request count, caps, Google Places field mask, provider warnings, clamp warnings, and demo-onboarding status.
6. Click **Activate + import** to create/update a `CommerceZone`, query Google Places in bounded tiles when `GOOGLE_PLACES_API_KEY` is set, store merchants, auto-demo-onboard them when demo flags allow, generate synthetic business data, and refresh real merchant insights.
7. If the run pauses, use **Continue import** in the import runs panel.

Repeated imports are incremental. If the requested city already has enough stored merchants for the current target and caps, provider calls are skipped. If you raise the target, radius, categories, or category caps, the importer searches only for missing supply and deduplicates existing merchants. If you lower settings, existing merchants are retained and future imports use the lower settings.

Free-form merchant rules are not silently trusted. The backend compiles them with Azure OpenAI when configured, or a deterministic local compiler for simple phrases, into supported static rule fields before saving. If text cannot be compiled into enforceable constraints, the save fails with a clear error.

Safety defaults:

- default radius: `20000m`
- hard max radius: `25000m`
- default max imports: `1000`
- hard max imports: `1500`
- default import checkpoint chunk size: `25`
- hard max import checkpoint chunk size: `50`
- Google Places max requests per import: `GOOGLE_PLACES_MAX_REQUESTS_PER_IMPORT=1000`
- Google Places max imported merchants: `GOOGLE_PLACES_MAX_IMPORTED_MERCHANTS=1000`
- Google Places default radius: `GOOGLE_PLACES_DEFAULT_RADIUS_METERS=20000`
- local import runtime safety budget: `CITY_IMPORT_RUNTIME_BUDGET_MS=180000`
- Place Details calls are disabled by default for cost control.
- per-category caps keep cafes/restaurants from dominating the import.

Normal Consumer Wallet orchestration queries stored DB merchants near the user and expands search radius `250m -> 500m -> 1000m -> 2000m` when too few candidates exist. It does not call Google Places, Overpass, Tavily, or Nominatim on wallet open unless `ENABLE_WALLET_LIVE_DISCOVERY_FALLBACK=true`.

## Service Modes

Default local mode:

```bash
SERVICE_INVOCATION_MODE=local
```

The API Gateway calls domain packages directly through `packages/service-clients`.

HTTP mode:

```bash
SERVICE_INVOCATION_MODE=http
CONTEXT_SERVICE_URL=...
MERCHANT_INTELLIGENCE_SERVICE_URL=...
NEGOTIATION_SERVICE_URL=...
VALIDATION_SERVICE_URL=...
OFFER_SERVICE_URL=...
REDEMPTION_SERVICE_URL=...
ANALYTICS_SERVICE_URL=...
```

If a service URL is missing, clients fall back to local mode.

## Database

Local default:

```bash
DATABASE_URL="file:./dev.db"
pnpm db:migrate
pnpm db:seed
```

The Prisma schema contains all requested models: users, profiles, context snapshots, commerce zones, merchant import runs, merchants, products, goals, rules, transaction baselines/snapshots, insight snapshots, events/triggers, orchestration runs, provider caches, negotiation, validation, offers/items, redemption tokens/redemptions, cashback ledger, and analytics events.

AWS target is PostgreSQL-compatible RDS/Aurora. The CDK database stack creates a VPC, PostgreSQL RDS instance, generated DB secret in Secrets Manager, Lambda/DB security groups, SSM placeholders for optional external API keys, and an RDS Proxy TODO placeholder.

## AWS Deployment

```bash
pnpm cdk:synth
pnpm cdk:deploy
```

CDK stacks:

- `CityWalletFrontendStack`: S3 buckets and CloudFront distributions for Consumer Wallet and Merchant Portal.
- `CityWalletBackendStack`: HTTP API, orchestration Lambda, service Lambdas, route mappings, IAM permissions, CloudWatch logs.
- `CityWalletDatabaseStack`: VPC, RDS PostgreSQL, Secrets Manager DB credentials, outputs.

Frontend deployment target:

```bash
pnpm --filter @city-wallet/consumer-wallet build
pnpm --filter @city-wallet/merchant-portal build
```

Upload each app’s `out/` directory to its CDK-created S3 bucket and invalidate the matching CloudFront distribution. Set `NEXT_PUBLIC_API_BASE_URL` to the API Gateway URL before building production frontend assets.

Backend deployment target is Lambda behind API Gateway. The CDK uses `NodejsFunction` to bundle each TypeScript Lambda handler, attaches the functions to the database VPC, grants DB secret/SSM read placeholders, and emits CloudWatch logs by default.

## Environment

See `.env.example`.

Required/default:

- `DATABASE_URL`
- `NEXT_PUBLIC_API_BASE_URL`
- `SERVICE_INVOCATION_MODE`
- `CITY_WALLET_REPOSITORY`
- `CONSUMER_WALLET_ORIGIN`
- `MERCHANT_PORTAL_ORIGIN`

HTTP service mode:

- `CONTEXT_SERVICE_URL`
- `MERCHANT_INTELLIGENCE_SERVICE_URL`
- `NEGOTIATION_SERVICE_URL`
- `VALIDATION_SERVICE_URL`
- `OFFER_SERVICE_URL`
- `REDEMPTION_SERVICE_URL`
- `ANALYTICS_SERVICE_URL`

Optional real integrations:

- `OPENAI_API_KEY`
- `LLM_PROVIDER`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_DEPLOYMENT`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_API_VERSION`
- `AZURE_OPENAI_TIMEOUT_MS`
- `PAYONE_API_KEY`
- `WEATHER_API_KEY`
- `TAVILY_API_KEY`
- `NOMINATIM_USER_AGENT`
- `OVERPASS_USER_AGENT`
- `CITY_IMPORT_POI_PROVIDER` (`overpass` or `google_places`)
- `GOOGLE_PLACES_API_KEY`
- `GOOGLE_PLACES_MAX_REQUESTS_PER_IMPORT`
- `GOOGLE_PLACES_MAX_IMPORTED_MERCHANTS`
- `GOOGLE_PLACES_DEFAULT_RADIUS_METERS`
- `GOOGLE_PLACES_TIMEOUT_MS`
- `CITY_IMPORT_RUNTIME_BUDGET_MS`
- `ENABLE_OVERPASS_IMPORT_FALLBACK`
- `DEMO_MODE`
- `ALLOW_DEMO_PARTNER_OFFERS`
- `ENABLE_WALLET_LIVE_DISCOVERY_FALLBACK`
- `ENABLE_DEV_RESET`

## What Is Simulated

- Weather uses Open-Meteo when coordinates are available and falls back to `MockWeatherProvider` after timeout/failure/budget exhaustion.
- Location uses browser geolocation in the Consumer Wallet and falls back to `DemoGeofenceProvider`.
- Payment density uses `SimulatedPayoneProvider`.
- User context uses declared context.
- Local events use mock events.
- Negotiation uses deterministic `MockLLMClient` by default; Azure OpenAI can be enabled with env vars and falls back to mock.
- Seeded merchant data remains fake/seeded. City import uses Google Places as the primary coordinate-bearing source when `GOOGLE_PLACES_API_KEY` is set; Overpass remains the fallback. Imported demo-partner profiles are synthetic and clearly labeled with their discovery source.
- Redemption is simulated checkout with deterministic seeded token codes. Demo-partner redemption is simulated only.

## Pluggable Later

- Azure OpenAI LLM provider in `packages/negotiation-domain`.
- Real Payone provider in `packages/providers`.
- Google/Mapbox geocoding providers.
- Prisma PostgreSQL repository deployment via RDS/Aurora.
- RDS Proxy for Lambda connection pooling.

## Live Provider Guardrails

- One Open-Meteo request per orchestration, 3s timeout.
- Wallet orchestration uses stored DB merchants by default. Overpass/Tavily/Nominatim are skipped unless `ENABLE_WALLET_LIVE_DISCOVERY_FALLBACK=true`.
- City import uses Google Places Nearby Search as the primary paid coordinate-bearing provider when `GOOGLE_PLACES_API_KEY` is set. The field mask is limited to `places.id,places.displayName,places.location,places.primaryType,places.types,places.formattedAddress`; no Place Details calls are made by default, and website/photos/reviews/opening-hours/phone/rating/price fields are not requested.
- Google Places imports enforce `GOOGLE_PLACES_MAX_REQUESTS_PER_IMPORT`, `GOOGLE_PLACES_MAX_IMPORTED_MERCHANTS`, per-category caps, DB result cache, and place-id deduplication.
- Overpass remains the fallback import provider. Set `OVERPASS_USER_AGENT` so the public endpoint can accept requests reliably. Disable fallback with `ENABLE_OVERPASS_IMPORT_FALLBACK=false`.
- Up to three Nominatim geocode attempts per orchestration, 3s timeout, DB cache, configured `NOMINATIM_USER_AGENT`, and safe failure to `discovered_only_without_coordinates`.
- One Tavily enrichment request per orchestration, 4s timeout, no coordinates trusted from Tavily.
- Azure OpenAI timeout is `AZURE_OPENAI_TIMEOUT_MS`, default 15s.
- Seeded partners remain enabled under all provider failures.

## Idempotency And Cooldown

`POST /api/orchestrate` creates an `OrchestrationRun` with `status="running"` as soon as the idempotency key is available. Completed duplicate keys return the stored result. Fresh running duplicates return `orchestration_already_running`. Running keys older than two minutes are marked failed with `stale_orchestration_run`; retries must use a new key from a new context/time bucket.

The API Gateway also blocks replacement when an active unexpired offer exists (`active_offer_exists`) and enforces a default 30-minute/user-profile cooldown (`cooldown_active`).

## Verification

Known passing locally:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm cdk:synth
```

Smoke-tested happy path returns the seeded bundle, token codes `CW-CAFE-91K` / `CW-BOOK-72Q`, and cashback `€0.54` / `€1.20`.
