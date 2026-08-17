-- owner: accounting
-- reviewed: 2026-08-17
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: distinguish revenue-post authorization during durable submission revalidation

ALTER TYPE "accounting"."financial_operation_type" ADD VALUE 'revenue_post';