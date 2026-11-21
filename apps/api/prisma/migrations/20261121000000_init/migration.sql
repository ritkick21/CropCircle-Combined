CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "exact_geog" geography(Point,4326),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sites_organization_id_idx" ON "sites"("organization_id");
CREATE INDEX "sites_exact_geog_gist_idx" ON "sites" USING GIST ("exact_geog");

ALTER TABLE "sites" ADD CONSTRAINT "sites_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
