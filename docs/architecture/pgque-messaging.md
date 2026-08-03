# PgQue Messaging and Job Architecture

> **Status:** Canonical
>
> **Related documents**
>
> - Durable execution: [`./durable-execution.md`](./durable-execution.md)
> - Process Studio event catalog: [`./process-studio.md`](./process-studio.md)
> - External integration surface: [`./integration-architecture.md`](./integration-architecture.md)
> - Async ADR: [`../decisions/0004-separate-events-jobs-and-workflows.md`](../decisions/0004-separate-events-jobs-and-workflows.md)
> - PostgreSQL architecture: [`./postgresql-19-architecture.md`](./postgresql-19-architecture.md)

## Position

PgQue is the first-class PostgreSQL event stream for:

- domain-event fan-out;
- integration-event delivery;
- notifications;
- audit export;
- analytics ingestion;
- search indexing;
- cache invalidation hints;
- communication with extracted services.

It is not the source of truth for business state and is not the only background
work primitive.

## Event Versus Job

```text
Event
-> a committed fact
-> may have many consumers
-> PgQue

Job
-> work that one worker must perform
-> has priority, schedule, lease, and lifecycle
-> job table
```

## Atomic Publication

Publish a domain event inside the same PostgreSQL transaction as the domain
mutation. A failed publication rolls back the transaction, and a failed
transaction publishes no event.

## Event Envelope

Every event should include:

```text
event_id
event_type
event_version
tenant_id
aggregate_type
aggregate_id
correlation_id
causation_id
actor_principal_id
occurred_at
payload
```

Event names use past tense and payload versions are explicit.

Process triggers and waits discover versioned event schemas through the Typed
Event Catalog defined by [`process-studio.md`](./process-studio.md). External
CloudEvents are authenticated and normalized by the connector boundary before
entering internal event delivery. PgQue remains the internal delivery mechanism;
the catalog and external envelope do not replace its durable event or consumer
rules. See [`integration-architecture.md`](./integration-architecture.md).

## Consumer Rules

Consumers must:

- be idempotent;
- advance cursors only after durable completion;
- use bounded retries;
- route poison events to a dead-letter path;
- expose lag and failure metrics;
- preserve correlation metadata.

## External Delivery

Use a transactional outbox when delivery leaves PostgreSQL and requires its own
delivery lifecycle. Do not perform unsafe dual-writes.
