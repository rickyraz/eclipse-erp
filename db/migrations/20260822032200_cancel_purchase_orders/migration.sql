-- owner: procurement
-- reviewed: 2026-08-22
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: preserve confirmation metadata for cancelled PurchaseOrders

ALTER TABLE "procurement"."purchase_orders" DROP CONSTRAINT "purchase_orders_confirmation_metadata_check", ADD CONSTRAINT "purchase_orders_confirmation_metadata_check" CHECK (("status" = 'draft' and
        "confirmation_idempotency_key" is null and "confirmed_at" is null) or
      ("status" in ('confirmed', 'cancelled') and
        "confirmation_idempotency_key" is not null and
        "confirmation_idempotency_key" ~ '[^[:space:]]' and
        "confirmed_at" is not null));
