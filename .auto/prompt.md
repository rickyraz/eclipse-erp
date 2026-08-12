# Autoresearch: Close EclipseERP P3 and ADR-0033 runtime gaps

## Objective
After completing the initial P0-P3 decision portfolio, finish the remaining executable gaps before calling P3 and the bounded ADR-0033 order lifecycle ready: owner-controlled transaction-aware event publication, distinct command/correlation/idempotency metadata, durable duplicate-safe consumer completion, and cancellation/fulfillment coordination.

## Metrics
- **Primary**: `p3_ready_gates` (unitless, higher is better).
- **Secondary**: `remaining_gates`.

## How to Run
`./.auto/measure.sh`; correctness checks run automatically from `.auto/checks.sh`.

## Files in Scope
- `packages/{messaging,catalog,inventory,accounting,sales,process,kernel}/`
- `db/schema/`, `db/migrations/`, `db/ownership.toml`
- affected apps/tests and canonical docs/ADRs/roadmaps
- `.auto/`

## Off Limits
- PgQue activation, external connectors, Process IR/runtime/designer, production deployment, secrets.
- Rewriting applied migrations or accepted ADR history.
- Claiming exactly-once external delivery.

## Constraints
- Domains publish only their own event declarations through a transaction-aware public messaging port.
- Messaging owns envelope/delivery/receipt infrastructure, not business meaning.
- PostgreSQL-local consumer effect and completed receipt share one transaction.
- Event identity is `(eventType,eventVersion)`; command ID, correlation ID, causation ID, and idempotency key remain distinct.
- Preserve public Effect Schema, authorization, tenant scope, idempotency, rollback, and package acyclicity.
- No direct cross-domain table imports/writes; no raw SQL in domain implementations.
- Do not weaken tests or gates to improve metrics.

## Readiness Gates
1. Messaging package/schema owns the current outbox contract and transaction-aware append service.
2. Process lifecycle event is Process-owned and carries distinct command/correlation/causation/idempotency metadata through Messaging.
3. Inventory stock-corrected event is PUBLIC and atomically emitted by `adjustStock`.
4. Accounting revenue-posted event is PUBLIC and atomically emitted by `postRevenueForOrder`.
5. Durable completed consumer receipts suppress duplicate PostgreSQL-local effects and roll back with failed effects.
6. ADR-0033 cancellation and fulfillment commands coordinate Sales, Inventory, Accounting, events, jobs, idempotency, and invalid states.
7. P3/domain maturity/roadmap evidence is reconciled and the full repository validation portfolio passes.

## What's Been Tried
- Initial P0-P3 portfolio reached 10/10 acceptance gates.
- ADR-0037 and catalog contracts exist, but Inventory and Accounting events remain EXPERIMENTAL because owner publication is absent.
- The old coordinator event was renamed `process.order_confirmation.completed`; it still uses the legacy Process-owned outbox and conflates correlation with idempotency.
- ADR-0033 confirmation is implemented, but cancellation and fulfillment remain missing.
