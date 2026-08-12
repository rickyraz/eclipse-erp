# PgQue Messaging and Job Architecture

> **Status:** Canonical
>
> **Related documents**
>
> - Durable execution: [`./durable-execution.md`](./durable-execution.md)
> - Stateful runtime: [`./runtime-architecture.md`](./runtime-architecture.md)
> - Search architecture: [`./search-architecture.md`](./search-architecture.md)
> - State and consistency: [`./state-and-consistency.md`](./state-and-consistency.md)
> - Process Studio event catalog: [`./process-studio.md`](./process-studio.md)
> - External integration surface: [`./integration-architecture.md`](./integration-architecture.md)
> - Async ADR: [`../decisions/0004-separate-events-jobs-and-workflows.md`](../decisions/0004-separate-events-jobs-and-workflows.md)
> - Messaging ownership ADR: [`../decisions/0038-move-internal-event-delivery-to-messaging.md`](../decisions/0038-move-internal-event-delivery-to-messaging.md)
> - PostgreSQL architecture: [`./postgresql-19-architecture.md`](./postgresql-19-architecture.md)

## Position

The current internal event path is the transaction-aware `MessagingService`,
`messaging.event_outbox`, and completed consumer receipts. It persists committed delivery intent and
supports duplicate-safe PostgreSQL-local consumers without claiming that a broker or external
provider completed delivery.

PgQue is the selected future PostgreSQL fan-out adapter for:

- domain-event fan-out;
- integration-event delivery;
- notifications;
- audit export;
- analytics ingestion;
- search indexing;
- cache invalidation hints;
- communication with extracted services.

PgQue is not active until ADR-0033's installer, PostgreSQL 19, ticker, grant, upgrade, and adapter
gates pass. Neither Messaging nor PgQue is the source of truth for business state, an active entity
owner, or the only background work primitive.

## Event Versus Job

```text
Event
-> a committed fact
-> transactionally appended through Messaging
-> may have many consumers
-> current outbox; future gated PgQue fan-out

Job
-> work that one worker must perform
-> has priority, schedule, lease, and lifecycle
-> job table
```

## Atomic Publication

The owning domain constructs its event and invokes the public transaction-aware Messaging contract
inside the same PostgreSQL transaction as the domain mutation. A failed append rolls back the
mutation, and a failed transaction publishes no event. A coordinator may publish only its own
Process-namespaced lifecycle facts; it must not impersonate another domain's event owner.

## Event Envelope

Every event includes:

```text
event_id
event_type
event_version
tenant_id
aggregate_type
aggregate_id
command_id
correlation_id
causation_id
idempotency_key
actor_principal_id
occurred_at
payload
```

Event names use past tense. Exact contract identity is `(event_type, event_version)`; the version is
not duplicated in the event name. Command, correlation, causation, and idempotency identities remain
distinct.

Cross-domain search and embedding consumers may build tenant-scoped, rebuildable projections from
these committed events. They must preserve source and event versions, tolerate replay, and never use
projection delivery as the authorization or invariant boundary. Detailed rules are owned by
[`search-architecture.md`](./search-architecture.md).

Process triggers and waits discover versioned event schemas through the Typed Event Catalog defined
by [`process-studio.md`](./process-studio.md). External CloudEvents are authenticated and normalized
by the connector boundary before entering internal event delivery. The current outbox and future
PgQue adapter remain delivery mechanisms; the catalog and external envelope do not replace durable
event or consumer rules. See [`integration-architecture.md`](./integration-architecture.md).

## Consumer Rules

Consumers must:

- be idempotent;
- commit a PostgreSQL-local effect and completed consumer receipt in one transaction;
- treat a receipt as complete only after the effect commits;
- advance cursors only after durable completion;
- use bounded retries;
- route poison events to a dead-letter path;
- expose lag and failure metrics;
- preserve correlation metadata.

Consumer receipts retain event identity, consumer identity, completion state, and timestamps for at
least the replay horizon. They do not provide exactly-once external delivery; external effects still
require provider idempotency and accepted/committed/unknown/reconciled operation state.

## Publication and External Delivery

Outbox insertion means durable delivery intent. `published_at` means durable acceptance by the
configured internal publication adapter, eventually PgQue; it does not mean every consumer or an
external provider completed an effect.

Use integration-owned operation state when delivery leaves PostgreSQL and has an independent
provider lifecycle. Do not perform unsafe dual-writes.
