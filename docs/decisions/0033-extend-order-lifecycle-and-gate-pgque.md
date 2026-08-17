# ADR-0033: Extend Order Lifecycle and Gate PgQue Activation

- Status: Accepted
- Date: 2026-08-09
- Supersedes: ADR-0032
- Superseded by: ADR-0038 (durable-delivery ownership only)

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Superseded workflow:
>   [`./0032-order-confirmation-cross-domain-workflow.md`](./0032-order-confirmation-cross-domain-workflow.md)
> - Canonical transaction rules:
>   [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
> - Messaging: [`../architecture/pgque-messaging.md`](../architecture/pgque-messaging.md)
> - Durable execution:
>   [`../architecture/durable-execution.md`](../architecture/durable-execution.md)
> - Integration boundary:
>   [`../architecture/integration-architecture.md`](../architecture/integration-architecture.md)

## Context

ADR-0032 established the first atomic order-confirmation workflow, but deliberately excluded order
lines, revenue derivation, fiscal periods, cancellation, fulfillment, and event delivery. Those
exclusions now prevent the workflow from owning a complete and auditable business lifecycle.

The current repository also has no reviewed, version-pinned PgQue installer or operational ticker
configuration. PgQue must not become a runtime dependency merely because event-outbox rows exist.

## Decision

### Order and inventory lifecycle

- Sales owns immutable order-line snapshots after confirmation: item identifier, positive quantity,
  and unit price. Order total is derived from those lines; callers do not supply an independent
  total. PostgreSQL protects confirmed/cancelled headers and lines and defers a total-versus-lines
  check to transaction commit.
- Order confirmation reserves the requested stock. Confirmation is the revenue-recognition point for
  this bounded workflow. The selected warehouse must belong to the selected legal entity; Inventory
  validates that relationship inside the reservation transaction.
- A confirmed order may be cancelled only while its reservation is active. Cancellation atomically:
  cancels the Sales order, releases the Inventory reservation, creates an Accounting reversal, and
  appends an outbox event plus a post-commit job.
- Fulfillment is a separate command that changes an active reservation to fulfilled and reduces both
  `on_hand` and `reserved`. A fulfilled order cannot use the cancellation workflow; returns and
  credit processing require a later dedicated decision.

### State transition ownership

There is no cross-domain universal status enum or transition table. Each owner enforces its bounded
state machine in its service contract and PostgreSQL boundary:

```text
Process workflow_runs: running -> succeeded | manual_recovery
Process jobs: pending -> leased -> completed | failed | manual_recovery
Sales orders: draft -> confirmed -> cancelled
Inventory reservations: active -> released | fulfilled
Inventory transfers: draft -> confirmed -> completed
Accounting periods: open -> closed
Accounting journals: draft -> posted | reversed
```

Terminal states cannot transition back. The new owner migrations add database triggers for initial
state and status transitions; they do not make `fulfilled` a Sales order status or imply a returns
workflow. Returns, credits, and any future cross-domain lifecycle remain separate capabilities and
require their owning decision.

### Accounting policy

- Accounting owns legal-entity revenue-posting profiles and fiscal periods.
- Revenue journals are derived server-side from the confirmed order total and the configured
  receivable/revenue accounts. Process and HTTP callers do not provide journal lines for this flow.
- Posting requires an enabled legal-entity accounting configuration and an open accounting period.
- Manual journals use the explicit `accounting.journal.post` capability; they are not a revenue-posting escape hatch.
- A journal can reach `posted` or `reversed` only with at least two balanced lines. A deferred PostgreSQL
  constraint trigger enforces `SUM(debit) = SUM(credit)` at transaction commit.
- Cancellation creates a new, linked reversing journal. Posted journals and their lines are protected
  by PostgreSQL triggers against updates, deletes, inserts into posted entries, and line reparenting.
  Official reversals use a new journal entry.

### Durable delivery

> This subsection is historical and is superseded by
> [ADR-0038](./0038-move-internal-event-delivery-to-messaging.md). The current outbox is
> `messaging.event_outbox`; the Process job decision below remains active.

- `process.event_outbox` remains the transactionally persisted source for committed events.
- `process.jobs` remains the leased work primitive. Workers claim with a lease owner and fencing
  token, and renew, complete, or fail only while both match the current lease. Stale workers are
  rejected; retries are bounded at three attempts before manual recovery. Execution remains
  at-least-once and business effects must be idempotent.
- PgQue is the selected fan-out destination, but activation is gated until the repository contains a
  reviewed, locally pinned installer artifact, supported PostgreSQL 19 operational procedure, ticker
  ownership, grants, upgrade path, and integration adapter tests.
- Before that gate passes, workers may lease and mark outbox delivery intent but must not claim that
  PgQue publication or external delivery occurred.

## Alternatives Considered

- **Continue accepting client journal lines:** rejected; it lets the transport boundary choose
  accounting facts.
- **Cancel fulfilled orders:** rejected; stock and revenue corrections require a return/credit
  lifecycle, not a destructive status change.
- **Publish directly after commit:** rejected; a crash can lose delivery intent.
- **Activate PgQue from an unpinned remote SQL file:** rejected; it bypasses dependency, migration,
  and operational review rules.

## Consequences

### Positive

- Sales totals and revenue postings have deterministic server-owned inputs.
- Cancellation preserves stock and journal audit trails.
- Period state and posting configuration become enforceable accounting policy.
- PgQue adoption has a concrete compatibility and operations gate.

### Negative

- The workflow requires Sales, Inventory, Accounting, and Process capability grants.
- Existing order-confirmation clients must move from one item plus journal lines to order lines and
  server-derived posting configuration.
- PgQue delivery remains unavailable until the explicit activation gate is completed.

### Risks

- Revenue recognition at order confirmation is a bounded business policy. Invoice- or fulfillment-
  based recognition requires a later superseding decision.
- Order item identifiers are snapshots; product-catalog ownership and valuation/cost of goods sold
  remain outside this decision.

## Validation

- PostgreSQL tests prove owner-specific transition guards, order-line total derivation and terminal
  snapshot protection, reservation release/fulfillment, journal reversal, open-period enforcement,
  atomic cancellation rollback, duplicate retries, stale-worker fencing, retry exhaustion, and
  competing leases.
- Boundary checks prove Process uses only public Sales, Inventory, and Accounting contracts.
- PgQue activation additionally requires installer checksum review, PostgreSQL 19 rehearsal, ticker
  health checks, upgrade rehearsal, and integration adapter delivery/retry tests.
