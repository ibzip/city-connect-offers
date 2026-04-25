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
- `packages/config`: providers, triggers, bundle policy, offer/copy policy, platform goal model.
- `packages/data-seed`: seeded Mia/Stuttgart/merchant scenario data only.
- `packages/db`: repository interfaces, seeded DB-like repository, Prisma repository wrapper.
- `packages/*-domain`: generic business logic by service boundary.
- `packages/providers`: mock/simulated provider interfaces and placeholders for real providers.
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

## Demo Flow

1. Open `http://localhost:3000/wallet`.
2. Use the seeded Mia profile and context controls.
3. Click **Find relevant offer**.
4. The API Gateway receives a user-side event and orchestrates services.
5. The wallet shows: “Cold outside? Make it a warm city break.”
6. Claim the bundle to issue `CW-CAFE-91K` and `CW-BOOK-72Q`.
7. Open `/redeem` and redeem both tokens.
8. Open `http://localhost:3001/dashboard` to see merchant insights, redemptions, cashback, and event logs.
9. Use `http://localhost:3001/rules` to inspect/edit seeded merchant rules.

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

The Prisma schema contains all requested models: users, profiles, context snapshots, merchants, products, goals, rules, transaction baselines/snapshots, insight snapshots, events/triggers, negotiation, validation, offers/items, redemption tokens/redemptions, cashback ledger, and analytics events.

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
- `PAYONE_API_KEY`
- `WEATHER_API_KEY`

## What Is Simulated

- Weather uses `MockWeatherProvider`.
- Location uses `DemoGeofenceProvider`.
- Payment density uses `SimulatedPayoneProvider`.
- User context uses declared context.
- Local events use mock events.
- Negotiation uses deterministic `MockLLMClient`.
- Redemption is simulated checkout with deterministic seeded token codes.

## Pluggable Later

- OpenAI LLM provider in `packages/negotiation-domain`.
- Open-Meteo weather provider in `packages/providers`.
- Real Payone provider in `packages/providers`.
- Browser or maps location provider.
- Prisma PostgreSQL repository deployment via RDS/Aurora.
- RDS Proxy for Lambda connection pooling.

## Verification

Known passing locally:

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm cdk:synth
```

Smoke-tested happy path returns the seeded bundle, token codes `CW-CAFE-91K` / `CW-BOOK-72Q`, and cashback `€0.54` / `€1.20`.
