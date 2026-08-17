-- owner: messaging
-- reviewed: 2026-08-17
-- generated-by: drizzle-kit 1.0.0-rc.4

ALTER TABLE "messaging"."consumer_receipts"
  ADD COLUMN "event_type" text,
  ADD COLUMN "event_version" integer,
  ADD COLUMN "idempotency_key" text;

UPDATE "messaging"."consumer_receipts" AS receipts
SET
  "event_type" = events."event_type",
  "event_version" = events."event_version",
  "idempotency_key" = events."idempotency_key"
FROM "messaging"."event_outbox" AS events
WHERE events."tenant_id" = receipts."tenant_id"
  AND events."id" = receipts."event_id";

ALTER TABLE "messaging"."consumer_receipts"
  ALTER COLUMN "event_type" SET NOT NULL,
  ALTER COLUMN "event_version" SET NOT NULL,
  ALTER COLUMN "idempotency_key" SET NOT NULL;

ALTER TABLE "messaging"."consumer_receipts"
  ADD CONSTRAINT "consumer_receipts_event_type_check"
    CHECK ("event_type" ~ '[^[:space:]]'),
  ADD CONSTRAINT "consumer_receipts_event_version_check"
    CHECK ("event_version" > 0),
  ADD CONSTRAINT "consumer_receipts_idempotency_key_check"
    CHECK ("idempotency_key" ~ '[^[:space:]]');
