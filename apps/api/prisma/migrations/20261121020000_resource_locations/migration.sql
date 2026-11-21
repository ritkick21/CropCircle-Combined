CREATE TYPE "ResourceCategory" AS ENUM ('FOOD_BANK', 'COMMUNITY_FOOD', 'FOSTER_SUPPORT', 'FARMER', 'FARMERS_MARKET', 'GROCERY_RESTAURANT', 'WHOLESALER', 'RESEARCH_CENTER', 'EXTENSION_SERVICE', 'SPECIALIST');

CREATE TABLE "resource_locations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "site_id" UUID,
  "category" "ResourceCategory" NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "description" VARCHAR(1000),
  "address_label" VARCHAR(240),
  "public_geog" geography(Point,4326) NOT NULL,
  "verified_at" TIMESTAMPTZ(6),
  "published_at" TIMESTAMPTZ(6),
  "available" BOOLEAN NOT NULL DEFAULT true,
  "accepted_crops" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "capacity_kg" DECIMAL(12,2),
  "hours" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "resource_locations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "resource_locations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "resource_locations_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "resource_locations_capacity_kg_check" CHECK ("capacity_kg" IS NULL OR "capacity_kg" >= 0),
  CONSTRAINT "resource_locations_public_geog_check" CHECK (ST_IsValid("public_geog"::geometry))
);
CREATE UNIQUE INDEX "resource_locations_site_id_key" ON "resource_locations"("site_id");
CREATE INDEX "resource_locations_category_published_at_verified_at_idx" ON "resource_locations"("category", "published_at", "verified_at");
CREATE INDEX "resource_locations_public_geog_gist_idx" ON "resource_locations" USING GIST ("public_geog");
CREATE INDEX "resource_locations_organization_id_idx" ON "resource_locations"("organization_id");
