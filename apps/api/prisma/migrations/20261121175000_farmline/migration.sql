CREATE TYPE "FarmReplyKind" AS ENUM ('ADVICE', 'TRIAL_OFFER', 'SAMPLE_REQUEST');

CREATE TYPE "FarmResourceKind" AS ENUM ('GUIDE', 'FIELD_REPORT', 'RESEARCH');

CREATE TABLE "farm_cases" (
    "id" UUID NOT NULL,
    "crop" VARCHAR(80) NOT NULL,
    "region" VARCHAR(100),
    "description" VARCHAR(2000) NOT NULL,
    "open_to_trials" BOOLEAN NOT NULL DEFAULT false,
    "grower_id" UUID NOT NULL,
    "researcher_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shared_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "resolution" VARCHAR(1200),
    "publish_fix" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "farm_cases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "farm_replies" (
    "id" UUID NOT NULL,
    "kind" "FarmReplyKind" NOT NULL,
    "body" VARCHAR(1500) NOT NULL,
    "case_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "farm_replies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "farm_trials" (
    "id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "crop" VARCHAR(80) NOT NULL,
    "description" VARCHAR(1200) NOT NULL,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "farm_trials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "farm_resources" (
    "id" UUID NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "crop" VARCHAR(80) NOT NULL,
    "summary" VARCHAR(500) NOT NULL,
    "kind" "FarmResourceKind" NOT NULL,
    "url" VARCHAR(600) NOT NULL,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "farm_resources_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "farm_cases_grower_id_activity_at_idx" ON "farm_cases"("grower_id", "activity_at");
CREATE INDEX "farm_cases_researcher_id_shared_at_activity_at_idx" ON "farm_cases"("researcher_id", "shared_at", "activity_at");
CREATE INDEX "farm_replies_case_id_created_at_idx" ON "farm_replies"("case_id", "created_at");
CREATE INDEX "farm_trials_author_id_created_at_idx" ON "farm_trials"("author_id", "created_at");
CREATE UNIQUE INDEX "farm_resources_url_key" ON "farm_resources"("url");

ALTER TABLE "farm_cases" ADD CONSTRAINT "farm_cases_grower_id_fkey" FOREIGN KEY ("grower_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "farm_cases" ADD CONSTRAINT "farm_cases_researcher_id_fkey" FOREIGN KEY ("researcher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "farm_replies" ADD CONSTRAINT "farm_replies_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "farm_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "farm_replies" ADD CONSTRAINT "farm_replies_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "farm_trials" ADD CONSTRAINT "farm_trials_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "farm_resources" ADD CONSTRAINT "farm_resources_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
