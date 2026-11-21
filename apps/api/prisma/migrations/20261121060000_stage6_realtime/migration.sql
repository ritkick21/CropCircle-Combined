ALTER TABLE "group_posts" ADD COLUMN "client_id" UUID;
CREATE UNIQUE INDEX "group_posts_group_id_author_id_client_id_key" ON "group_posts" ("group_id", "author_id", "client_id");

ALTER TABLE "marketplace_requests" ADD COLUMN "client_id" UUID, ADD COLUMN "mode" "ListingMode";
UPDATE "marketplace_requests" r SET "mode" = l."mode" FROM "crop_listings" l WHERE l."id" = r."listing_id";
ALTER TABLE "marketplace_requests" ALTER COLUMN "mode" SET NOT NULL;
CREATE UNIQUE INDEX "marketplace_requests_listing_id_requester_id_client_id_key" ON "marketplace_requests" ("listing_id", "requester_id", "client_id");

CREATE TABLE "realtime_outbox" (
  "id" UUID PRIMARY KEY,
  "event" JSONB NOT NULL,
  "scopes" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMPTZ
);
CREATE INDEX "realtime_outbox_published_at_created_at_id_idx" ON "realtime_outbox" ("published_at", "created_at", "id");

CREATE TABLE "realtime_notifications" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "organization_ids" UUID[] DEFAULT ARRAY[]::UUID[],
  "group_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "read_at" TIMESTAMPTZ
);
CREATE INDEX "realtime_notifications_user_id_created_at_id_idx" ON "realtime_notifications" ("user_id", "created_at", "id");

CREATE TABLE "farmer_conversations" (
  "id" UUID PRIMARY KEY,
  "participant_a_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "participant_b_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "farmer_conversation_order" CHECK ("participant_a_id" < "participant_b_id")
);
CREATE UNIQUE INDEX "farmer_conversations_participant_a_id_participant_b_id_key" ON "farmer_conversations" ("participant_a_id", "participant_b_id");
CREATE INDEX "farmer_conversations_participant_b_id_idx" ON "farmer_conversations" ("participant_b_id");

CREATE TABLE "farmer_messages" (
  "id" UUID PRIMARY KEY,
  "conversation_id" UUID NOT NULL REFERENCES "farmer_conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sender_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "client_id" UUID NOT NULL,
  "body" VARCHAR(3000) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "farmer_messages_conversation_id_sender_id_client_id_key" ON "farmer_messages" ("conversation_id", "sender_id", "client_id");
CREATE INDEX "farmer_messages_conversation_id_created_at_id_idx" ON "farmer_messages" ("conversation_id", "created_at", "id");
