ALTER TABLE "marketplace_profiles"
  ADD COLUMN "cold_storage" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "accepts_sales" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "crop_listings"
  ADD COLUMN "pickup_from" TIMESTAMPTZ(6),
  ADD COLUMN "pickup_until" TIMESTAMPTZ(6),
  ADD COLUMN "requires_cold_storage" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "IntelligenceKind" AS ENUM ('RECOMMENDATION', 'SURPLUS', 'DEMAND', 'CLASSIFY', 'SIMILARITY');
CREATE TYPE "IntelligenceStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETE', 'FAILED');
CREATE TABLE "intelligence_jobs" (
  "id" UUID PRIMARY KEY,
  "kind" "IntelligenceKind" NOT NULL,
  "status" "IntelligenceStatus" NOT NULL DEFAULT 'QUEUED',
  "user_id" UUID,
  "organization_id" UUID,
  "subject_id" UUID,
  "input" JSONB NOT NULL DEFAULT '{}',
  "output" JSONB,
  "signals" JSONB,
  "model_version" TEXT,
  "error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lease_until" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(6)
);
CREATE INDEX "intelligence_jobs_status_created_at_idx" ON "intelligence_jobs" ("status", "created_at");
CREATE INDEX "intelligence_jobs_organization_id_kind_subject_id_created_a_idx"
  ON "intelligence_jobs" ("organization_id", "kind", "subject_id", "created_at");
CREATE INDEX "intelligence_jobs_user_id_created_at_idx" ON "intelligence_jobs" ("user_id", "created_at");
