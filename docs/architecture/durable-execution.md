# Durable Execution Architecture

> **Status:** Canonical
>
> **Related documents**
>
> - Messaging: [`./pgque-messaging.md`](./pgque-messaging.md)
> - Stateful runtime: [`./runtime-architecture.md`](./runtime-architecture.md)
> - State and consistency: [`./state-and-consistency.md`](./state-and-consistency.md)
> - Financial ledger: [`./financial-ledger.md`](./financial-ledger.md)
> - Process Studio semantics: [`./process-studio.md`](./process-studio.md)
> - Capability release and runtime governance:
>   [`../decisions/0020-adopt-capability-release-and-runtime-governance.md`](../decisions/0020-adopt-capability-release-and-runtime-governance.md)
> - Active runtime: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - Async ADR:
>   [`../decisions/0004-separate-events-jobs-and-workflows.md`](../decisions/0004-separate-events-jobs-and-workflows.md)

## Decision

EclipseERP uses different primitives for different semantics:

```text
Direct PostgreSQL transaction
-> synchronous business invariants

PgQue
-> durable event stream and fan-out

Job table
-> leased, scheduled, prioritized work

pg_durable
-> checkpointed multi-step workflow
```

Effect fibers are not durable. A Stateful Entity Runtime owns selected active entity state and
serialization; it does not replace checkpointed multi-step workflow execution or durable
accepted-work semantics. TigerBeetle-backed financial operations use the financial-ledger protocol:
PostgreSQL intent, deterministic submission, engine outcome, projection, and reconciliation. They
must not be disguised as one direct PostgreSQL transaction.

## Compatibility Gate

`pg_durable` may become the workflow engine only after it:

- supports PostgreSQL 19;
- passes load and crash-recovery tests;
- provides observable workflow state;
- demonstrates safe migration and upgrade behavior.

Until then, a compatibility job layer remains available. The first bounded implementation uses the
`packages/process` coordination owner and its PostgreSQL workflow-run and job tables, plus the
Messaging-owned transactional event outbox and consumer receipts. It does not claim that a worker or
`pg_durable` is authoritative. PgQue activation additionally requires the installer, ticker, grants,
upgrade, and adapter gate defined by
[ADR-0033](../decisions/0033-extend-order-lifecycle-and-gate-pgque.md).

## Direct Transaction Examples

- post an invoice on the PostgreSQL profile;
- reserve stock;
- allocate a payment on its decided owner/profile;
- close a fiscal period;
- assign a critical role.

TigerBeetle-backed financial posting is a durable accepted-work protocol rather than a direct
PostgreSQL transaction; its exact scope is owned by [`financial-ledger.md`](./financial-ledger.md).

These operations must complete atomically before success is returned.

## Durable Workflow Examples

- tenant provisioning;
- month-end closing;
- bulk import;
- payment settlement;
- approval with timers;
- multi-step external integration.

## Workflow Requirements

Each workflow must define:

- idempotency key;
- step boundaries;
- retry policy;
- timeout policy;
- compensating action when applicable;
- observable progress;
- cancellation semantics;
- audit correlation.

A workflow must not replace a local transaction invariant.

The runtime must persist step state, execution context, idempotency keys, retry state, unknown
external outcomes, compensation progress, and manual-recovery state. Detailed Process Studio
release, promotion, authority, and observability semantics are governed by
[`../decisions/0020-adopt-capability-release-and-runtime-governance.md`](../decisions/0020-adopt-capability-release-and-runtime-governance.md).

Typed action/event catalogs, Process IR, definition versioning, static validation, and compensation
semantics are owned by [`process-studio.md`](./process-studio.md). The durable engine must preserve
those semantics without becoming their source of truth.
