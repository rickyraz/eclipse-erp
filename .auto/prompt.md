# Autoresearch: Harden RITSEI P3 against current ADRs

## Objective
Keep the bounded PostgreSQL-internal P3 and ADR-0033 order-lifecycle baseline truthful after the latest committed RITSEI changes. Reconcile executable evidence and canonical summaries with ADR-0037, ADR-0038, ADR-0033, and the newer ADR-0040 financial-ledger boundary without rewriting committed history or activating gated infrastructure.

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
- Migrating the existing PostgreSQL order workflow to TigerBeetle; ADR-0040 requires a separate consistency decision.

## Constraints
- Domains publish only their own event declarations through a transaction-aware public messaging port.
- Messaging owns envelope/delivery/receipt infrastructure, not business meaning.
- PostgreSQL-local consumer effect and completed receipt share one transaction.
- Event identity is `(eventType,eventVersion)`; command ID, correlation ID, causation ID, and idempotency key remain distinct.
- Preserve public Effect Schema, authorization, tenant scope, idempotency, rollback, and package acyclicity.
- No direct cross-domain table imports/writes; no raw SQL in domain implementations.
- Do not weaken tests or gates to improve metrics; update stale evidence checks only when the latest accepted contract changed.

## Readiness Gates
1. Messaging package/schema owns the current outbox contract and transaction-aware append service.
2. Process lifecycle events are Process-owned and carry distinct command/correlation/causation/idempotency metadata through Messaging.
3. Inventory stock-corrected event is PUBLIC and atomically emitted by `adjustStock`.
4. Accounting revenue-posted event is PUBLIC and atomically emitted by `postRevenueForOrder`.
5. Durable completed consumer receipts suppress duplicate PostgreSQL-local effects and roll back with failed effects.
6. ADR-0033 cancellation and fulfillment commands coordinate Sales, Inventory, Accounting, events, jobs, idempotency, and invalid states.
7. P3/domain maturity/roadmap evidence is reconciled with the latest accepted ADRs and the full repository validation portfolio passes.
8. Accounting financial-operation reconciliation events preserve distinct command, correlation, causation, and idempotency metadata through Messaging.
9. Accounting financial-operation event payloads preserve the positive mapping-version invariant at the public catalog boundary.

## Current status
- The bounded P3 implementation gates above are present in the current tree.
- ADR-0038 makes `messaging.event_outbox` the active internal delivery owner; the historical Process wording remains history.
- Inventory, Sales, and Accounting provide the selected PUBLIC Level 3 slices; Accounting revenue derives its amount from the confirmed Sales fact.
- ADR-0040 selects TigerBeetle for the future financial execution boundary, but its production and cross-domain migration gates remain intentionally open.
- The latest committed tree also includes the public financial-operation catalog slice, so benchmark assertions must not require the older single-entry Accounting catalog shape.
- The financial-operation event path is the next hardening target: ADR-0038/0040 require distinct envelope identities, including for reconciliation and projection rebuild replay.
- Financial operation persistence requires positive mapping versions, so the PUBLIC reconciled event must reject impossible versions before catalog consumers see them.
