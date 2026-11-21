# Health and service contract

| Service    | Liveness                  | Readiness                                    |
| ---------- | ------------------------- | -------------------------------------------- |
| Web        | `GET /api/health`         | `GET /api/dependencies` for API connectivity |
| API        | `GET /api/v1/health/live` | `GET /api/v1/health/ready`                   |
| AI service | `GET /health/live`        | `GET /health/ready`                          |

Liveness reports that the process can respond. Readiness checks live dependencies and returns HTTP 503 when a required dependency is unavailable. The API requires a PostgreSQL query, `PostGIS_Version()`, and Redis `PING`. It probes the AI service when `ML_SERVICE_URL` is configured, reporting a degraded optional dependency without preventing the API process from serving non-AI requests. The AI service checks PostgreSQL, PostGIS and Redis. Health responses contain no connection strings or credentials.

The TypeScript contract lives in `packages/shared-types/src/index.ts`. The API client is in `packages/api-client/src/index.ts`. API health routes are exposed under the `/api/v1` prefix; Socket.IO is mounted at `/realtime` and uses the Redis adapter. These are Stage 2 operational contracts, not product API endpoints.
