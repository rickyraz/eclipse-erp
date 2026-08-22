-- owner: procurement
-- reviewed: 2026-08-22
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: add the internal confirmed PurchaseOrder state selected by ADR-0045

ALTER TYPE "procurement"."purchase_order_status" ADD VALUE 'confirmed';