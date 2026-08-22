-- owner: procurement
-- reviewed: 2026-08-22
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: add the canonical Procurement terminal PurchaseOrder cancellation state

ALTER TYPE "procurement"."purchase_order_status" ADD VALUE 'cancelled';
