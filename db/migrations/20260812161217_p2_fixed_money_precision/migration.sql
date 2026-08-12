-- owner: accounting
-- reviewed: 2026-08-12
-- generated-by: drizzle-kit 1.0.0-rc.4

ALTER TABLE "accounting"."legal_entity_accounting_configurations" DROP CONSTRAINT "legal_entity_accounting_configurations_precision_check", ADD CONSTRAINT "legal_entity_accounting_configurations_precision_check" CHECK ("decimal_precision" = 2);