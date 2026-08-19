-- owner: accounting
-- reviewed: 2026-08-19
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: enforce the TigerBeetle-compatible U128 upper bound at the PostgreSQL minor-amount persistence boundary

ALTER TABLE "accounting"."financial_operation_transfers" ADD CONSTRAINT "financial_operation_transfers_amount_u128_check" CHECK ("amount_minor" <= 340282366920938463463374607431768211455);