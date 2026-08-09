# ADR-0032: Atomic Sales Order Confirmation Across Sales, Inventory, and Accounting

- Status: Superseded
- Date: 2026-08-09
- Supersedes: None
- Superseded by: ADR-0033

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture:
>   [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - Transactional consistency:
>   [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
> - Messaging: [`../architecture/pgque-messaging.md`](../architecture/pgque-messaging.md)
> - Durable execution:
>   [`../architecture/durable-execution.md`](../architecture/durable-execution.md)
> - Process Studio: [`../architecture/process-studio.md`](../architecture/process-studio.md)
> - Capability naming:
>   [`./0031-capability-naming-and-business-verb-conventions.md`](./0031-capability-naming-and-business-verb-conventions.md)

## Context

The repository has separate public contracts for Sales, Inventory, and Accounting, but their
existing service methods each open their own database transaction. Direct composition through the
API layer therefore cannot provide all-or-nothing behavior.

The first bounded cross-domain workflow is order confirmation:

```text
confirm SalesOrder
  -> reserve Inventory stock
  -> post Accounting journal
  -> record committed event and post-commit job
```

The workflow must preserve the owning domains, tenant scope, authorization, retries, and PostgreSQL
as the source of truth.

## Decision

Add a dedicated `packages/process` coordination owner. It owns only workflow coordination state:
workflow runs, event-outbox records, and jobs. It does not own Sales orders, Inventory balances or
reservations, or Accounting journals.

The workflow calls only public contracts:

- `SalesService.confirmOrder`;
- `InventoryService.reserveStock`;
- `AccountingService.postJournal`.

The kernel exposes an ambient, typed transaction context through `Database.withTransaction`. Nested
domain transactions join the active PostgreSQL transaction; they do not create independent
transactions. No Drizzle transaction type crosses the process package's public contract.

### Command contract

`OrderConfirmationPayload` requires:

- Sales order ID;
- warehouse ID and item ID;
- positive quantity;
- balanced journal lines;
- one non-empty idempotency key.

The same idempotency key identifies the process run and Inventory reservation. The journal reference
is deterministically derived from the order ID and key. A retry with different business input is a
`WorkflowIdempotencyConflict`.

### Domain transitions

```text
SalesOrder draft -> confirmed
Inventory reservation absent -> active
Accounting journal absent -> posted
```

Each transition remains authorized by its owning domain capability. Invalid state, insufficient
stock, missing accounts, and scope violations fail the shared transaction.

### Recovery and compensation

The synchronous core has no partial committed state, so rollback compensation is not used for a
successful PostgreSQL transaction. The process owner provides:

- idempotent `recoverOrder` replay for lost responses or retryable outcomes;
- `markManualRecovery` for operator fencing when a run requires investigation;
- `WorkflowManualRecoveryRequired` when automatic replay is not allowed;
- `WorkflowOutcomeUnknown` when the database outcome cannot be safely classified, directing callers
  to the recovery command rather than retrying an unkeyed mutation.

Any later asynchronous or external step requires its own idempotent compensating command or explicit
manual-recovery policy. It must not pretend to roll back committed domain facts.

### Events and jobs

The process owner records, in the same PostgreSQL transaction:

- a versioned `sales.order.confirmed` event envelope in `process.event_outbox`;
- a pending `process.order_confirmation.post_commit` job in `process.jobs`.

The outbox and job records are durable contracts for later PgQue delivery and job leasing. No worker
or external side effect is assumed to be complete merely because the record was inserted.

## Consequences

### Positive

- Cross-domain atomicity is explicit and tested with PostgreSQL.
- Domain ownership remains local to Sales, Inventory, and Accounting.
- Retries return prior results instead of duplicating stock or journals.
- Event and job intent survives a process crash after database commit.
- Manual recovery is explicit and authorized.

### Negative

- The kernel transaction service runs an Effect program inside the PostgreSQL callback and must
  preserve typed failures while forcing rollback.
- Process coordination state adds a schema and package boundary.
- The first workflow requires all three domain capability grants.
- Event/job delivery remains a later infrastructure concern; pending records are not delivery proof.

## Out of scope

- Sales order lines and product catalog ownership;
- valuation, tax, fiscal-period policy, invoicing, payment settlement, and external providers;
- a general Process IR runtime or visual designer;
- PgQue consumer implementation and job worker execution;
- asynchronous compensation for the synchronous atomic core;
- frontend workflow screens.

## Validation

The implementation proves:

- domain-local transition and idempotency behavior;
- Sales PostgreSQL scope and order confirmation;
- atomic rollback across all three domains;
- duplicate and concurrent workflow retries;
- durable event/job records;
- explicit manual-recovery state;
- public event/job schemas;
- package, schema ownership, capability, call-graph, API/OpenAPI, type, and migration checks.
