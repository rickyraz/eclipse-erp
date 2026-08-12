# ADR-0038: Move Internal Event Delivery Ownership to Messaging

- Status: Accepted
- Date: 2026-08-12
- Supersedes: ADR-0033 durable-delivery ownership only
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Order lifecycle and PgQue gate:
>   [`./0033-extend-order-lifecycle-and-gate-pgque.md`](./0033-extend-order-lifecycle-and-gate-pgque.md)
> - P3 audit/event boundary:
>   [`./0037-define-p3-audit-event-and-delivery-boundary.md`](./0037-define-p3-audit-event-and-delivery-boundary.md)
> - Messaging architecture:
>   [`../architecture/pgque-messaging.md`](../architecture/pgque-messaging.md)
> - Process Studio architecture:
>   [`../architecture/process-studio.md`](../architecture/process-studio.md)

## Context

ADR-0033 correctly kept event publication transactional and PgQue activation gated, but assigned the
shared event outbox to `process.event_outbox`. That table was sufficient for the first bounded order
coordinator, but it made a Process-owned schema the infrastructure path for Inventory and Accounting
events. Domain packages cannot import Process persistence without transferring event authority or
creating an invalid dependency center.

The implemented P3 baseline now has owner-controlled Inventory and Accounting event declarations, a
neutral catalog contract, transaction-aware event append behavior, and duplicate-safe
PostgreSQL-local consumer receipts. These are shared messaging concerns rather than Process
coordination facts.

## Decision

- `packages/messaging` owns the internal event envelope, transactional outbox append service, and
  completed consumer-receipt infrastructure.
- The current durable intent table is `messaging.event_outbox`. Retirement of `process.event_outbox`
  requires a separate fail-closed migration that refuses to drop a non-empty legacy table; operators
  must review and migrate legacy rows without inventing command, correlation, causation, or
  idempotency identity.
- Domains construct and publish only their own namespaced events through the public
  transaction-aware `MessagingService`. The bounded Process coordinator publishes only
  Process-namespaced lifecycle facts.
- Event identity is `(event_type, event_version)`. Event ID, command ID, correlation ID, causation
  ID, and idempotency key remain distinct envelope fields.
- PostgreSQL-local consumer effects and their completed receipts commit in one transaction. Delivery
  remains at-least-once; receipts do not claim exactly-once external effects.
- `published_at` means durable acceptance by the configured internal publication adapter. It does
  not mean every consumer or external provider completed an effect.
- `process.jobs` remains the Process-owned leased work primitive for the bounded order lifecycle.
- PgQue remains the selected future fan-out adapter, but it is inactive until ADR-0033's installer,
  PostgreSQL 19, ticker, grant, upgrade, and adapter gates pass.

The order confirmation, cancellation, fulfillment, revenue-recognition, reversal, and PgQue gating
decisions in ADR-0033 remain accepted and unchanged.

## Alternatives Considered

- **Keep the outbox in Process:** rejected because domain event publication would depend on a
  bounded application coordinator and confuse infrastructure ownership with business event meaning.
- **Give every domain a separate delivery table:** rejected for the current modular monolith because
  it duplicates envelope, delivery, and receipt mechanics without improving semantic ownership.
- **Publish directly to PgQue:** rejected because the activation and operations gates remain
  incomplete.
- **Automatically translate legacy rows:** rejected because required command and idempotency
  identity cannot be recovered safely from the old envelope.

## Consequences

### Positive

- Domain events remain owner-controlled while sharing one transaction-aware delivery port.
- Process no longer acts as the infrastructure owner for unrelated domain events.
- Consumer deduplication and rollback behavior have one tested implementation.
- PgQue status is represented truthfully as a gated target adapter.

### Negative

- Messaging becomes a shared infrastructure dependency for event-publishing domains.
- Existing deployments with legacy Process outbox rows require explicit operator migration.
- The old Process table cannot be removed automatically when historical identity is incomplete.

### Risks

- Messaging could become a semantic event owner; package and catalog boundaries must keep payload
  meaning with the publishing domain.
- Consumers may treat receipts as external exactly-once guarantees; connector contracts must retain
  provider idempotency and unknown-outcome reconciliation.
- A later PgQue adapter must not redefine the public envelope or mark rows published before durable
  acceptance.

## Validation

- Boundary checks prove domains import only `packages/messaging/mod.ts`, not messaging tables.
- PostgreSQL tests prove domain mutation and event append commit or roll back together.
- Consumer tests prove duplicate suppression and receipt rollback with failed local effects.
- Migration tests prove the legacy Process outbox retirement fails closed when rows exist.
- Catalog compatibility tests verify event identity, owner, version, delivery expectation, and
  minimized sensitivity metadata.
