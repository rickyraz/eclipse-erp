# ADR-0025: Introduce a Stateful Entity Runtime

- Status: Accepted
- Date: 2026-08-06
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Runtime architecture:
>   [`../architecture/runtime-architecture.md`](../architecture/runtime-architecture.md)
> - State and consistency:
>   [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
> - Canonical architecture:
>   [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - PostgreSQL truth:
>   [`./0003-postgresql-is-transactional-truth.md`](./0003-postgresql-is-transactional-truth.md)
> - Semantic ownership:
>   [`./0015-one-semantic-owner-per-invariant.md`](./0015-one-semantic-owner-per-invariant.md)
> - Events, jobs, and workflows:
>   [`./0004-separate-events-jobs-and-workflows.md`](./0004-separate-events-jobs-and-workflows.md)
> - `celld` evaluation:
>   [`./0026-evaluate-celld-runtime-adapter.md`](./0026-evaluate-celld-runtime-adapter.md)

## Context

EclipseERP already assigns each business invariant to one semantic owner and uses PostgreSQL as the
canonical transactional source of truth. Most commands should continue to execute through stateless
Effect services and PostgreSQL transactions.

Some business objects may eventually become both highly active and inherently sequential. Examples
include an inventory position, workflow instance, reservation bucket, reconciliation session, or
fiscal-close process. Routing many concurrent callers directly to the same database state can make
PostgreSQL serve as canonical store, transaction engine, lock manager, active owner, and
conflict-resolution point at once.

Database sharding changes where durable data is placed. A queue controls accepted work and delivery.
Neither primitive by itself defines who currently owns the right to evaluate the next transition for
one logical object.

EclipseERP needs an optional execution primitive for selected aggregates where explicit active
ownership is simpler or measurably better than repeatedly reconstructing ownership with row locks,
advisory locks, optimistic retries, or queue partition conventions.

## Decision

EclipseERP introduces a **Stateful Entity Runtime** as an optional, vendor-neutral execution
primitive.

The runtime provides, for approved entity categories:

```text
stable entity address
+ one logical active owner
+ entity-local command serialization
+ active or projected state
+ activation, hibernation, and recovery
+ domain-level runtime observability
```

The responsibility model is:

```text
PostgreSQL
-> canonical business truth, transactions, constraints, history, and audit

Stateful Entity Runtime
-> active ownership, identity-local serialization, hot state, and coordination

PgQue / job table / durable workflow engine
-> committed-event delivery, eventual work, and checkpointed process execution
```

The runtime is not a cache, database replacement, queue replacement, workflow engine, or
authorization system.

### Domain boundary

Domain packages depend only on EclipseERP-owned runtime contracts. They must not import `celld`,
Cloudflare Durable Object, or another vendor runtime API.

A public domain contract remains the only command boundary. Authentication, authorization, tenant
scope, invariants, persistence, and tagged failures remain owned by the existing domain services. A
runtime adapter routes an authorized domain command to the entity owner; it does not become a second
domain owner.

### Canonical authority

PostgreSQL remains authoritative for canonical financial, legal, inventory, document, authorization,
and audit facts. An acknowledged canonical transition must include a successful PostgreSQL commit.

Runtime-local durability does not imply business authority. Runtime state must be classified as
canonical, rebuildable, runtime-durable, or ephemeral, with a documented recovery rule. No critical
fact may exist only in runtime-local storage unless a later ADR explicitly changes its owner and
consistency model.

### Aggregate selection

A database row does not automatically become a stateful entity. A domain may select an entity only
when it has a stable identity and a meaningful need for at least one of:

- identity-local serialization;
- sustained contention on one logical aggregate;
- repeated access to expensive-to-reconstruct state;
- a non-trivial active state machine;
- object-local timers or connections;
- coordination state that no existing domain fact owns.

Each selected category must declare its address, owner, command boundary, canonical PostgreSQL
facts, state classification, versioning, idempotency, recovery, reconciliation, observability, and
fallback behavior.

### Consistency boundary

Single active ownership reduces contention but is not the final correctness barrier. Canonical
writes must still use domain transactions, database constraints, command idempotency, and
expected-version checks where stale or split ownership could otherwise commit an invalid transition.

Cross-entity and cross-domain operations remain explicit transactions, durable processes, events, or
compensations. The runtime must not disguise distributed operations as one local object transaction.

### Adoption boundary

The primitive is accepted, but no distributed implementation is mandatory. Development and tests may
use a local implementation. Production use requires a separate adapter decision and
category-specific evidence.

## Alternatives Considered

### Use PostgreSQL coordination for every aggregate

Retained as the default, but rejected as the only permitted architecture. PostgreSQL locks and
optimistic concurrency remain appropriate for ordinary loads; selected hot or stateful aggregates
may benefit from explicit active ownership.

### Use queue partitions as entity owners

Rejected as the general abstraction. A queue provides delivery and ordering semantics but does not
by itself define active state, addressed behavior, recovery, direct-command routing, or entity
lifecycle.

### Treat a distributed cache as the owner

Rejected. Cached values are ordinarily disposable and do not provide the full identity, execution,
serialization, recovery, and command semantics required by this decision.

### Make every domain entity stateful

Rejected. This would duplicate the relational model in another runtime, add operational cost, and
create a distributed monolith.

### Depend directly on one vendor runtime

Rejected. Runtime maturity and deployment topology must remain replaceable without rewriting domain
contracts.

## Consequences

### Positive

- Semantic ownership can become an explicit runtime boundary.
- Hot aggregates may serialize before reaching PostgreSQL contention points.
- Rebuildable hot projections can reduce repeated relational reconstruction.
- Domain and plugin callers continue through public typed contracts.
- PostgreSQL sharding remains compatible with logical entity routing.
- Runtime implementations remain replaceable.

### Negative

- EclipseERP gains another execution and observability model.
- Runtime-state schemas, activation, reconciliation, and failure recovery require explicit design.
- Multi-entity operations remain distributed-system problems.
- Poor entity granularity can create bottlenecks or a distributed object graph.

### Risks

- Runtime-local state could accidentally become a competing source of truth.
- Vendor APIs could leak into domain packages.
- Single-owner assumptions could weaken database correctness checks.
- Excessive synchronous entity calls could create a distributed monolith.
- Operational complexity may exceed measurable workload benefit.

## Validation

Before a production-critical entity category is enabled, prove:

- deterministic domain-defined addressing;
- one-owner and stale-owner fencing behavior;
- command idempotency and expected-version enforcement;
- PostgreSQL commit remains the acknowledgement boundary for canonical facts;
- outbox/event publication is atomic with canonical mutation;
- recovery from owner loss before and after PostgreSQL commit;
- reconciliation from stale or missing runtime state;
- adapter disablement or replacement without canonical data loss;
- tenant, authorization, plugin, and package boundaries remain enforced;
- measured improvement for the selected workload;
- operational dashboards and alerts cover ownership, latency, backlog, activation, recovery, and
  reconciliation.
