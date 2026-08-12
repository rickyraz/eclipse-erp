-- owners: process, messaging
-- reviewed: 2026-08-12
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom

DO $$
BEGIN
  LOCK TABLE "process"."event_outbox" IN ACCESS EXCLUSIVE MODE;

  IF EXISTS (SELECT 1 FROM "process"."event_outbox") THEN
    RAISE EXCEPTION
      'process.event_outbox contains legacy rows; operator migration/review is required before retirement'
      USING ERRCODE = '55000';
  END IF;

  DROP TABLE "process"."event_outbox";
END;
$$;
