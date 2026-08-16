-- owner: sales
-- reviewed: 2026-08-16
-- generated-by: drizzle-kit 1.0.0-rc.4

ALTER TABLE "sales"."orders" ADD CONSTRAINT "orders_confirmation_metadata_check" CHECK (("status" = 'draft' and "confirmation_idempotency_key" is null) or
      ("status" in ('confirmed', 'cancelled') and
        "confirmation_idempotency_key" is not null and
        "confirmation_idempotency_key" ~ '[^[:space:]]' and
        "confirmed_at" is not null));