# Database baseline

Local Compose uses the `postgis/postgis:17-3.6-alpine` image with a persistent named volume. Prisma 6 owns schema migrations in `apps/api/prisma/migrations`. The first migration enables PostGIS and creates minimal `organizations` and `sites` tables with an indexed private `geography(Point,4326)` site coordinate. It is infrastructure groundwork; product schema awaits the decisions recorded in the SRS.

Apply checked-in migrations with `docker compose run --rm migrate`, or set a host-side `DATABASE_URL` and run `pnpm db:migrate:deploy`. Create a new migration in local development with `pnpm db:migrate`; inspect its SQL before committing. PostGIS geography is represented as Prisma `Unsupported` and accessed through parameterized SQL until it can be mapped safely by the chosen ORM version.

The API readiness query verifies `PostGIS_Version()`. A healthy PostgreSQL container alone does not prove that the extension or app migration is usable. The initial migration includes a GiST index for future bounded radius searches.

The identity migration adds users, sessions, verification and recovery tokens, organization memberships, and invitations. It preserves existing organization and site data. Users and organizations have distinct UUIDs, and a unique user/organization pair allows each user to join several organizations. Passwords are stored as salted scrypt hashes. The database stores only hashes of refresh, verification, recovery, and invitation tokens. None of the identity or organization routes serialize the sites table or its private coordinates.
