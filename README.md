# CropCircle Combined

This repository contains a Next.js App Router web app, a NestJS API with Socket.IO, a private FastAPI service, shared TypeScript contracts, and a local PostgreSQL/PostGIS + Redis stack. The API includes [authentication and organization memberships](docs/api/auth.md).

The authenticated resource map is at `/map`. It uses MapLibre GL JS with OpenFreeMap tiles by default. Place search and driving routes use configurable Photon and OSRM endpoints. See [map architecture and configuration](docs/architecture/map.md).

The marketplace, map, and farmer collaboration pages share live updates and a persistent inbox. See [Stage 6 event contracts, room permissions, and integration tests](docs/stage6.md).

Open [Sustainability](http://localhost:3000/sustainability) for Stage 7 forecasts, crop issue hypotheses, recipient planning, and role-scoped impact metrics. See the [Stage 7 demo and model evaluation](docs/stage7.md).

Stage 8 includes the [demo verification report](docs/stage8.md), [AWS deployment and recovery guide](docs/deployment.md), and [environment variable reference](docs/environment.md).

## FarmLine crop help

Open **Crop help** from the CropCircle home page. Sign in using your CropCircle account, or choose **Create an account** and copy the verification code from Mailpit at <http://localhost:8025> for local development. One session works across FarmLine, the marketplace, the resource map, collaboration and sustainability.

1. In **Get help**, choose **Fill in a demo example** or describe a crop problem. The report stays private until you share it. FarmLine returns scouting steps, links to related extension guides, field reports and research, and relevant fixes other growers chose to share.
2. From **My cases**, share the report with a specific researcher or open it to researcher review. You can also copy a draft for your local extension office.
3. In a separate browser profile, sign in as a researcher. **Review cases** receives the request and can reply with advice, a sample request, or a field trial offer if the grower opted in.
4. In the grower profile, read the reply and mark the case resolved. Choose whether to share the crop and resolution with other growers. Researchers can also publish field trials and add links to the source library.

To set up the researcher for the demo, create and verify a second account in the browser, run `pnpm install --frozen-lockfile` and `pnpm db:generate` on the host, then grant the role against the local database:

```sh
pnpm --filter @cropcircle/api exec tsx --env-file=../../.env test/demo-role.ts RESEARCHER researcher@example.invalid
```

Use the actual email you verified. The local guide set covers sorghum aphids and wheat stripe rust, with general scouting steps for other reports. Browser dictation depends on browser support. FarmLine uses the shared CropCircle API and PostGIS database. Live AI web search, automated article ingestion, and the original Twilio phone/SMS service aren’t included. CropCircle’s existing prediction tools remain under Sustainability.

Set `FARMLINE_TEST_DATABASE_URL` to your local `DATABASE_URL` before running `pnpm test:browser` to include the two-account FarmLine test. For custom ports, also set `STAGE8_WEB_URL`, `STAGE8_API_URL` and `AUTH_TEST_MAIL_URL`.

The guided help and source catalog are adapted from [FarmLine](https://github.com/nephr0x/cropCircle/tree/60934391a308b215fb7df0c52be7b0546e3ae214/finalrepo) under its [MIT license](docs/FARMLINE-LICENSE.txt). The existing CropCircle workspace comes from [CircleCrop_ver.1.2](https://github.com/ritkick21/CircleCrop_ver.1.2/tree/73e19fc507ae8a00aec7e81677f38c71c2bfbf27).

## Requirements

- Docker Engine or Docker Desktop with Compose v2
- Node.js 22 or newer and pnpm 11.25.0 for local checks
- Python 3.10 or newer for FastAPI tests outside Docker

The repository pins pnpm in `package.json`. If pnpm is not available, run `corepack enable` and `corepack prepare pnpm@11.25.0 --activate`.

On this Windows workstation, Docker Desktop may be unavailable while Docker Engine is installed in the `Ubuntu` WSL distribution. Run `powershell -ExecutionPolicy Bypass -File infra/scripts/start-wsl.ps1` from the repository root to start that engine, copy the source to a native WSL build context, launch Compose, and run the smoke checks.

## Start the full environment

From the repository root:

```sh
cp .env.example .env
docker compose up --build -d
docker compose ps
node infra/scripts/smoke.mjs
node infra/scripts/socket-smoke.mjs
```

In PowerShell, use `Copy-Item .env.example .env` in place of `cp`. Compose builds the three apps, starts PostgreSQL/PostGIS and Redis, applies the checked-in Prisma migration through the one-shot `migrate` service, and then starts the API and web app. The smoke commands check web and service health and verify that Socket.IO rejects an anonymous connection. Set `SOCKET_ACCESS_TOKEN` to a valid local access token to smoke-test the authenticated ping.

| Service            | Local address                  | Operational endpoint                                    |
| ------------------ | ------------------------------ | ------------------------------------------------------- |
| Web                | <http://localhost:3000>        | `/api/health`; `/api/dependencies` checks the API       |
| API                | <http://localhost:3001/api/v1> | `/health/live`, `/health/ready`                         |
| AI service         | <http://localhost:8000>        | `/health/live`, `/health/ready`                         |
| PostgreSQL/PostGIS | `localhost:5432`               | Compose `db` health check                               |
| Redis              | `localhost:6379`               | Compose `redis` health check                            |
| Mailpit            | <http://localhost:8025>        | Local inbox for verification, recovery, and invitations |

Run `docker compose logs -f` to inspect startup and `docker compose down` to stop the stack. Named database and Redis volumes persist across stops. The port and development database credentials can be changed in `.env`; the files in `apps/*/.env.example` document local process settings.

## Install dependencies and run checks

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm lint
pnpm typecheck
pnpm test
```

Install Python dependencies and run the FastAPI tests from the repository root:

```sh
python -m venv apps/ml-service/.venv
apps/ml-service/.venv/bin/python -m pip install -e "apps/ml-service[dev]"
apps/ml-service/.venv/bin/python -m pytest apps/ml-service/tests
```

On Windows PowerShell, replace the final two commands with:

```powershell
.\apps\ml-service\.venv\Scripts\python.exe -m pip install -e "apps/ml-service[dev]"
.\apps\ml-service\.venv\Scripts\python.exe -m pytest apps/ml-service/tests
```

To run migrations against the Compose database again:

```sh
docker compose run --rm migrate
```

For local Prisma development, set `DATABASE_URL` to the host-side URL from `.env` and run `pnpm db:migrate`; `pnpm db:migrate:deploy` applies checked-in migrations without creating a new one. In PowerShell:

```powershell
$env:DATABASE_URL = "postgresql://cropcircle:cropcircle_dev@localhost:5432/cropcircle"
pnpm db:migrate
```

## Workspace layout

| Path                    | Purpose                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `apps/web`              | Next.js, React, TypeScript, Tailwind CSS, shadcn/ui components |
| `apps/api`              | NestJS REST/Socket.IO boundary and Prisma schema/migrations    |
| `apps/ml-service`       | Private FastAPI service                                        |
| `packages/shared-types` | Versioned TypeScript response and event shapes                 |
| `packages/api-client`   | Typed API client used by the web app                           |
| `packages/config`       | Shared TypeScript and ESLint baseline                          |
| `infra`                 | Compose notes and smoke script                                 |
| `docs`                  | Requirements, architecture, API and database notes             |

See [architecture](docs/architecture/README.md), [health API](docs/api/health.md), [database](docs/database/README.md), and [contribution conventions](CONTRIBUTING.md) for implementation details.
