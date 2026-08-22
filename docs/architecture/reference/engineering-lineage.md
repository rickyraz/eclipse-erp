# RITSEI Engineering Lineage

> **Status:** Reference
>
> This document records comparative engineering influences and useful reading. It is not an adoption
> statement, implementation specification, or new architectural decision. RITSEI's source of
> truth remains its accepted ADRs and canonical architecture documents.
>
> **Related documents**
>
> - Documentation boundaries:
>   [`../../documentation-boundaries.md`](../../documentation-boundaries.md)
> - Runtime architecture: [`../runtime-architecture.md`](../runtime-architecture.md)
> - Durable execution: [`../durable-execution.md`](../durable-execution.md)
> - Messaging: [`../pgque-messaging.md`](../pgque-messaging.md)
> - Accidental duplication: [`./accidental-duplication.md`](./accidental-duplication.md)
> - Stateful Entity Runtime:
>   [`../../decisions/0025-introduce-stateful-entity-runtime.md`](../../decisions/0025-introduce-stateful-entity-runtime.md)
> - `celld` adapter evaluation:
>   [`../../decisions/0026-evaluate-celld-runtime-adapter.md`](../../decisions/0026-evaluate-celld-runtime-adapter.md)

## Why this document exists

RITSEI does not claim to follow one external book, company architecture, or framework. Its
architecture is a synthesis of several engineering traditions, constrained by RITSEI's own
ownership, PostgreSQL, transaction, authorization, and recovery decisions.

The references below answer:

- which established ideas make a design choice recognizable;
- which external systems are useful comparisons;
- where the comparison stops; and
- which rule is actually binding in this repository.

A resemblance is not an adoption. The accepted ADR or canonical architecture document is always the
binding source for RITSEI behavior.

## Comparative lineage

| RITSEI concern                                                      | Closest engineering lineage                       | RITSEI interpretation                                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Semantic ownership, bounded domains, aggregate boundaries               | Domain-Driven Design                              | One semantic owner per invariant; domains expose public contracts and do not write another domain's tables.                              |
| PostgreSQL as canonical transactional truth                             | Data-intensive systems design                     | Transactions, constraints, idempotency, reconciliation, and explicit consistency trade-offs remain central.                              |
| Commands, events, correlation, durable subscribers, competing consumers | Enterprise Integration Patterns                   | Commands request work; events describe committed facts; delivery is at-least-once and consumers are idempotent.                          |
| `messaging.event_outbox`                                                | Transactional Outbox pattern                      | Event intent commits with the owning mutation before a delivery adapter accepts it.                                                      |
| `process.jobs`                                                          | Leased work, competing consumers, scheduled retry | Process-owned imperative work has one worker-oriented lifecycle and does not become a general event bus.                                 |
| `workflow_runs`                                                         | Durable orchestration and workflow engines        | Process state and result are durable, but RITSEI keeps workflow state, leased work, events, and delivery separate.                   |
| Stateful Entity Runtime                                                 | Virtual actors / addressed active objects         | Stable entity address, active ownership, serialized turns, activation, fencing, and recovery are optional runtime semantics.             |
| Fencing, ownership loss, recovery, operational gates                    | Distributed-systems reliability and SRE           | Runtime ownership never removes PostgreSQL correctness; failure injection, telemetry, reconciliation, and measured benefit are required. |
| WorkloadCell and resource isolation                                     | Bulkheads and failure-domain isolation            | Deployment/resource containment is separate from entity ownership, authorization, and business state.                                    |

## Primary references

### Domain-Driven Design

Eric Evans's _Domain-Driven Design: Tackling Complexity in the Heart of Software_ is the closest
lineage for RITSEI's bounded-domain vocabulary and semantic ownership. Fowler's overview of
bounded contexts is a concise supporting reference:

- Eric Evans, _Domain-Driven Design: Tackling Complexity in the Heart of Software_, Addison-Wesley,
  2003.
- [Martin Fowler — Bounded Context](https://www.martinfowler.com/bliki/BoundedContext.html)

In RITSEI, this lineage is narrowed into explicit repository rules:

```text
Sales       owns order invariants
Inventory   owns stock and reservation invariants
Accounting  owns journal and revenue invariants
Process     owns workflow coordination and internal work
Messaging   owns event envelope and delivery mechanics
```

DDD is a conceptual lineage here, not permission for a domain to import another domain's tables or
repositories.

### Data-intensive systems

Martin Kleppmann's _Designing Data-Intensive Applications_ is the closest general reference for
reasoning about consistency, transactions, replication, failure, ordering, idempotency, and the
trade-offs between storage and messaging mechanisms:

- [Martin Kleppmann — Designing Data-Intensive Applications](https://martin.kleppmann.com/2017/03/27/designing-data-intensive-applications.html)

RITSEI applies that lens without treating the book as a blueprint. PostgreSQL remains the
canonical business-fact store; runtime, queue, projection, and delivery state must not silently
replace it.

### PostgreSQL property graphs

PostgreSQL 19's property-graph documentation is relevant to the proposed job-dependency query layer:

- [Property Graphs](https://www.postgresql.org/docs/19/ddl-property-graphs.html)
- [CREATE PROPERTY GRAPH](https://www.postgresql.org/docs/19/sql-create-property-graph.html)
- [Graph Queries](https://www.postgresql.org/docs/19/queries-graph.html)
- [PGConf.dev 2026 Graph Database Developer Meeting](https://wiki.postgresql.org/wiki/PGConf.dev_2026_Graph_Database_Developer_Meeting)

This is a query/representation lineage, not a second canonical graph store. If job dependencies are
introduced, relational `process.jobs` and dependency tables remain authoritative; graph queries are
an optional inspection and analysis surface, while scheduler acquisition stays a bounded
transactional relational query.

### Enterprise Integration Patterns

Hohpe and Woolf provide the vocabulary closest to RITSEI's command/event and delivery model:

- [Message](https://www.enterpriseintegrationpatterns.com/patterns/messaging/Message.html)
- [Durable Subscriber](https://www.enterpriseintegrationpatterns.com/patterns/messaging/DurableSubscription.html)
- [Transactional Outbox](https://microservices.io/patterns/data/transactional-outbox.html)

Relevant concepts include command messages, event messages, correlation identifiers, publish/
subscribe, competing consumers, durable subscribers, guaranteed delivery, and idempotent receivers.
RITSEI adapts these ideas to a PostgreSQL transaction-aware outbox and public Effect service
contracts; it does not claim exactly-once external delivery.

### Google SRE and reliability engineering

Google's SRE material is a useful lineage for failure-oriented design, operational simplicity,
ownership/fencing concerns, observability, and proving recovery rather than assuming it:

- [Managing Critical State](https://sre.google/sre-book/managing-critical-state/)
- [Operational Simplicity](https://sre.google/sre-book/simplicity/)

The comparison is about engineering method, not infrastructure imitation. RITSEI's runtime
maturity gates, failure injection, reconciliation, pressure/fallback behavior, and performance
thresholds remain RITSEI-specific.

### Virtual actors and the Stateful Entity Runtime

The Stateful Entity Runtime is closest in shape to the virtual-actor family, especially Orleans:

- [Microsoft Orleans overview](https://learn.microsoft.com/en-us/dotnet/orleans/overview)

The shared ideas are:

```text
stable logical identity
one logical active execution owner
serialized entity-local turns
activation/deactivation or hibernation
recovery and reactivation
```

RITSEI deliberately changes the authority model:

```text
PostgreSQL              = canonical business facts
Stateful Entity Runtime = active ownership and serialization
```

Runtime-local state is not automatically business authority. The runtime is optional globally and
required only for an approved entity category whose execution contract says so.

### `celld`

`celld` is the currently evaluated distributed adapter for the RITSEI-owned runtime contract:

- [`celld` repository](https://github.com/denoland/celld)
- [`celld` fencing documentation](https://github.com/denoland/celld/blob/main/docs/fencing.md)
- [`celld` limitations](https://github.com/denoland/celld/blob/main/docs/limitations.md)
- [`celld` security documentation](https://github.com/denoland/celld/blob/main/docs/security.md)

The repository's binding position is in
[ADR-0026](../../decisions/0026-evaluate-celld-runtime-adapter.md): `celld` remains
proposed/experimental, domain packages must not import its APIs, and a local/direct adapter must
remain possible. Under the current architecture, PostgreSQL remains canonical for control-plane and
non-ledger facts while ADR-0040 governs the activated financial authority.

The dependency direction is:

```text
RITSEI domain
        |
        v
RITSEI StatefulEntityRuntime contract
        |
        +--> local/direct-compatible adapter
        |
        +--> celld adapter
```

It is not:

```text
RITSEI domain -> celld
```

## Comparative systems, not architectural parents

### Netflix Conductor

Netflix Conductor is a useful comparison for durable workflow orchestration and task scheduling:

- [Netflix Conductor repository](https://github.com/netflix/conductor)

The comparison applies primarily to `workflow_runs` and durable process execution. RITSEI does
not adopt Conductor as its architecture and does not collapse workflow state, internal jobs, event
outbox, and event fan-out into one generic orchestration engine.

### Why no single reference is sufficient

The resulting lineage is a synthesis:

```text
DDD
  -> semantic ownership and bounded domains

Data-intensive systems design
  -> transactions, consistency, failure, reconciliation

Enterprise Integration Patterns
  -> command/event and durable delivery vocabulary

SRE
  -> operational evidence, fencing, recovery, observability

Virtual actors
  -> optional active entity ownership and serialized execution
```

The repository's distinctive combination is:

```text
DDD ownership
+ PostgreSQL-first canonical truth
+ integration-pattern event delivery
+ separate workflow/work primitives
+ optional virtual-actor-style entity execution
+ evidence-based operational gates
```

That combination is a synthesis, not a claim that RITSEI follows one external blueprint.

## What these references do not authorize

These references must not be used to justify any of the following without an accepted RITSEI
decision:

- making `celld` mandatory;
- making every ERP aggregate a stateful entity;
- replacing PostgreSQL business truth with actor, cell, cache, or broker state;
- turning `process.jobs` into a general event bus;
- turning PgQue into the Process workflow executor;
- bypassing domain authorization or public contracts;
- claiming exactly-once external delivery;
- importing vendor runtime types into domain packages; or
- adding a second source of truth for workflow, job, event, or business state.

When an external analogy and an RITSEI ADR disagree, the RITSEI ADR wins.
