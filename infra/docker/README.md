# Local containers

The root `compose.yaml` builds each application from its own Dockerfile under `apps/` and uses this directory for future container-specific configuration. The `migrate` one-shot container applies checked-in Prisma migrations before the API starts. PostgreSQL and Redis use named volumes so `docker compose down` preserves local data.

`docker compose down -v` deletes local database and Redis data; run it only when intentionally resetting the development environment.
