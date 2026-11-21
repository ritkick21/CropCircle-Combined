# Stage 8 readiness report

## Demo scope

CropCircle Stage 8 targets a working local demonstration and a reviewable AWS deployment configuration. AWS staging and production remain unverified. They require a configured AWS account, a GitHub repository with environment-scoped OIDC, ACM and DNS, SMTP credentials, and a restore drill.

## Changes reviewed

| Area | Changes and controls |
| --- | --- |
| Identity | Reviewed hashed and rotating refresh tokens, revocation, secure production cookies, trusted origins, exact CORS, admin-only verification, and active organization membership checks. Workspace navigation reuses the short-lived access token in memory to avoid rotating the refresh cookie during a page transition. |
| REST and realtime | Strict DTO validation, parameterized SQL, shared Redis request and handshake limits, per-connection packet limits, private API responses, and restrictive browser content and framing headers. |
| Media and privacy | The API validates signatures and caps attachments at 5 MB before writing to private storage. Signed reads expire after two minutes and require an active listing at a verified organization, a shared issue, or an authorized group attachment. Public map results use coarse coordinates for sensitive locations. |
| Performance | The marker query uses a partial geometry GiST index for viewport searches and retains the geography index for proximity. The browser cancels stale requests and clusters map markers. Redis caches model inventory briefly. The ML worker checks exhausted leases periodically. Existing conditional SQL reservation updates guard stock under concurrency. |
| Deployment | Local services run in Compose. CloudFormation provisions private RDS and Redis, private S3, ECR, a TLS load balancer, and CloudWatch alarms. GitHub Actions verifies the demo before attempting an ECS release. |

## Local verification on November 21, 2026

- All nine migrations applied on disposable PostGIS databases. The database reports the new viewport, worker lease and listing creator indexes.
- Five TypeScript unit tests, two Jest security tests, three API contract tests and 14 Python tests passed. Both Playwright scenarios passed three consecutive runs on the final image, covering sign-in, session persistence, sign-out and mobile navigation.
- The integration checks covered email verification and recovery, cross-organization authorization, PostGIS queries, private object storage, competing reservation acceptance, two-replica WebSocket delivery and revocation, and NestJS to FastAPI inference.
- On the final stack, readiness returned HTTP 200 for all 60 requests at concurrency 6 with 82 ms p95. At concurrency 28 the guarded endpoint returned HTTP 401 for 79 anonymous requests and HTTP 429 for 201 excess requests. Readiness stayed healthy.
- Docker production builds and the local Compose health checks passed. The web, API and ML processes run as non-root users. CloudFormation lint and deployment script syntax checks passed. The Node production dependency audit reported no known vulnerabilities.

## Repeat the demo checks

Start the isolated Compose services with a generated shared `ML_SERVICE_KEY`. Use a disposable database and Redis instance. Set `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY` and `S3_SECRET_KEY` for host-side tests. Set `AUTH_TEST_API_URL`, `AUTH_TEST_MAIL_URL`, `STAGE7_API_URL`, `STAGE8_API_URL`, `STAGE8_WEB_URL`, `STAGE8_ML_URL` and the smoke URLs if using custom ports. Run the load check last because it exercises the shared limiter.

The two-replica realtime suite starts its own workers. Give those workers a separate migrated test database through `REALTIME_TEST_DATABASE_URL` and a separate local Redis database through `REALTIME_TEST_REDIS_URL` so they only consume their own events.

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm lint
pnpm typecheck
pnpm test
pnpm test:security
pnpm build
pnpm audit --prod --audit-level high
pnpm exec playwright install chromium
pnpm smoke
pnpm test:integration
pnpm test:contracts
pnpm test:browser
pnpm test:load
```

Install `apps/ml-service[dev,train]`, train with `python -m cropcircle_ml.train --data apps/ml-service/data --out apps/ml-service/models`, then run `ML_REQUIRE_MODELS=1 python -m pytest apps/ml-service/tests`. The CI workflow sets up these checks and validates the AWS template with `cfn-lint`.

## Known limitations

- The attachment controls validate signatures and enforce size and access limits. Malware scanning, image metadata stripping and a retention job for unattached objects remain future work. Uploaded files can contain identifying information.
- Organization verification is an administrator decision. Independent identity verification and admin MFA remain production work.
- Local load measurements exercise one workstation and a small fixture database. They do not establish production capacity. Test realistic data sizes and the hosted platform before committing to an SLA.
- Live AWS access, TLS, deployment rollback, database restore, production email and SNS delivery need a staging exercise. The recovery runbook covers one region. The external tile, geocoding and routing endpoints have separate availability limits.
- Forecasts and crop assessments are advisory and rely on the Stage 7 training data and evaluation. See [Stage 7 model evaluation](stage7.md).

The landing page uses a built-in generated photograph stored at `apps/web/public/harvest.webp`. The prompt requested a natural editorial farm scene with harvest crates of kale, purple carrots and tomatoes, crop rows behind them, warm afternoon sun, a darker left third, and no text or logos.
