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
10. Accounting financial-operation event mapping versions stay within the PostgreSQL integer range.
11. Accounting financial-operation command schemas keep persisted mapping versions within the PostgreSQL integer range.
12. Accounting verification evidence versions stay within the PostgreSQL smallint range used by artifact persistence.
13. Accounting verification evidence counts stay within the PostgreSQL integer range used by artifact persistence.
14. Accounting cutover control unresolved-operation counts preserve the PostgreSQL non-negative integer invariant.
15. Accounting financial-operation attempt counts preserve the PostgreSQL non-negative integer invariant.
16. Accounting reconciliation checkpoint counts preserve the PostgreSQL non-negative integer invariant at the public boundary.
17. Accounting reconciliation checkpoint timestamps preserve the persisted timezone-qualified instant contract at the public boundary.
18. Accounting financial-operation timestamps preserve the persisted timezone-qualified instant contract at the public boundary.
19. Financial verification evidence preserves timezone-qualified timestamps and the completed-at-after-start invariant at the public boundary.
20. Accounting public journal entries preserve the persisted reversal-state invariant.
21. Accounting public journal lines preserve the persisted single-sided positive-amount invariant.
22. Accounting public periods preserve the persisted start-before-end date invariant.
23. Accounting public revenue-posting profiles preserve distinct receivable and revenue account identities.
24. Accounting public financial-operation schemas preserve the operation-type/source-journal relationship enforced by PostgreSQL.
25. Accounting public financial-operation schemas preserve the status/terminal-metadata relationship enforced by PostgreSQL.

## Current status
- The bounded P3 implementation gates above are present in the current tree.
- ADR-0038 makes `messaging.event_outbox` the active internal delivery owner; the historical Process wording remains history.
- Inventory, Sales, and Accounting provide the selected PUBLIC Level 3 slices; Accounting revenue derives its amount from the confirmed Sales fact.
- ADR-0040 selects TigerBeetle for the future financial execution boundary, but its production and cross-domain migration gates remain intentionally open.
- The latest committed tree also includes the public financial-operation catalog slice, so benchmark assertions must not require the older single-entry Accounting catalog shape.
- The financial-operation event path is the next hardening target: ADR-0038/0040 require distinct envelope identities, including for reconciliation and projection rebuild replay.
- Financial operation persistence requires positive mapping versions, so the PUBLIC reconciled event must reject impossible versions before catalog consumers see them.
- The persisted mapping version is PostgreSQL `integer`; the public event must reject values above `2_147_483_647` as well as non-positive values.
- The financial-operation command schemas share the same persisted integer boundary, so overflow must be rejected before intent persistence.
- Verification artifacts persist schema and mapping versions as PostgreSQL `smallint`, so the public evidence contract must reject values above `32_767` before artifact writes.
- Verification artifact counts persist as PostgreSQL `integer`, so public evidence must reject counts above `2_147_483_647` before artifact writes.
- Cutover controls persist unresolved accepted-operation counts as non-negative PostgreSQL `integer` values, so the public control schema must reject negative and overflowing counts.
- Financial operations persist retry attempts as non-negative PostgreSQL `integer` values, so the public operation schema must reject negative and overflowing attempts.
- Reconciliation checkpoints persist mismatch and orphan counts as non-negative PostgreSQL `integer` values, so the public checkpoint schema must reject negative and overflowing counts.
- Reconciliation checkpoints persist `checkedAt` as PostgreSQL `timestamptz`, so the public checkpoint schema must reject date-only and malformed timestamp strings.
- Financial operations persist scheduled, submitted, and reconciled timestamps as PostgreSQL `timestamptz`, so the public operation schema must reject date-only and malformed timestamp strings.
- Financial verification artifacts persist `startedAt` and `completedAt` as PostgreSQL `timestamptz` with `completedAt >= startedAt`, so the public evidence schema must preserve both the instant shape and ordering invariant.
- Accounting journal persistence requires posted entries without reversal IDs and reversed entries with a reversal ID, so the public JournalEntry schema must reject contradictory state metadata.
- Accounting journal-line persistence requires exactly one positive debit or credit amount, so the public JournalLine schema must reject zero-sided and double-sided lines.
- Accounting periods persist `startsOn <= endsOn`, so both public period output and open-period input schemas must reject reversed dates.
- Accounting revenue-posting profiles persist distinct receivable and revenue account IDs, so both configuration input and public profile schemas must reject equal IDs.
- Financial operations persist `journal_reverse` only with a source journal and `journal_post`/`revenue_post` only without one, so public operation and journal-intent schemas must reject mismatched type/source metadata.
- Financial operations persist status-specific acceptance, rejection, recovery, and reconciliation metadata, so the public operation schema must reject contradictory terminal-state fields.
