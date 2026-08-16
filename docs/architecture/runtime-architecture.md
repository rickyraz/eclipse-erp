# Stateful Runtime Architecture

> **Status:** Canonical
>
> **Owns:** Active state ownership, entity routing, runtime lifecycle, aggregate-selection rules,
> recovery posture, and stateful-runtime observability.
>
> **Related documents**
>
> - Canonical architecture: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - State and consistency: [`./state-and-consistency.md`](./state-and-consistency.md)
> - PostgreSQL architecture: [`./postgresql-19-architecture.md`](./postgresql-19-architecture.md)
> - Workload isolation: [`./workload-isolation.md`](./workload-isolation.md)
> - Messaging: [`./pgque-messaging.md`](./pgque-messaging.md)
> - Durable execution: [`./durable-execution.md`](./durable-execution.md)
> - Process Studio: [`./process-studio.md`](./process-studio.md)
> - Stateful runtime ADR:
>   [`../decisions/0025-introduce-stateful-entity-runtime.md`](../decisions/0025-introduce-stateful-entity-runtime.md)
> - Experimental `celld` adapter:
>   [`../decisions/0026-evaluate-celld-runtime-adapter.md`](../decisions/0026-evaluate-celld-runtime-adapter.md)

## Position

EclipseERP separates durable business truth from active business-state ownership.

```text
PostgreSQL
-> what is durably true

Stateful Entity Runtime
-> who owns selected active state and evaluates its next transition

Durable Queue / Workflow Engine
-> what accepted asynchronous work must eventually execute
```

The Stateful Entity Runtime is optional. Stateless Effect services and direct PostgreSQL
transactions remain the default. A domain adopts runtime ownership only for an approved aggregate
category with evidence that identity-local serialization, hot state, or object-local coordination is
required.

Three independent boundaries use similar language and must not be conflated:

```text
StatefulEntity
-> EclipseERP aggregate-level serialization and active-state boundary

celld cell
-> one adapter-owned named Durable Object with one active owner and private SQLite state

WorkloadCell
-> deployment resource and fault-containment boundary for a tenant group and workload planes
```

A `WorkloadCell` is governed by [`workload-isolation.md`](./workload-isolation.md). It is not a
stateful entity, aggregate boundary, or authorization grant. A `celld` cell is an adapter
implementation term, not an AWS-style workload cell. `celld` bucket durability does not make its
SQLite state canonical for EclipseERP; runtime fields still follow the state classification and
PostgreSQL anchor required by [`state-and-consistency.md`](./state-and-consistency.md). Runtime
entity addressing, WorkloadCell placement, and PostgreSQL placement remain separate concerns.

## System Shape

```text
┌──────────────────────────────────────────────────────┐
│ API / Worker / Process Runtime                       │
└────────────────────────┬─────────────────────────────┘
                         │ authenticated command
                         v
┌──────────────────────────────────────────────────────┐
│ Public Domain Contract                               │
│ decode · authorize · scope · tagged failures         │
└────────────────────────┬─────────────────────────────┘
                         │ domain entity address
                         v
┌──────────────────────────────────────────────────────┐
│ Stateful Entity Runtime                              │
│ route · activate · own · serialize · project         │
└────────────────────────┬─────────────────────────────┘
                         │ validated transition
                ┌────────┴────────┐
                │                 │
                v                 v
┌──────────────────────────┐  ┌─────────────────────────┐
│ PostgreSQL               │  │ PgQue / Jobs / Workflow│
│ canonical facts          │  │ delivery and eventual  │
│ transactions             │  │ work                   │
│ constraints and audit    │  │                        │
└──────────────────────────┘  └─────────────────────────┘
```

The domain contract owns business behavior. The runtime owns execution routing and entity lifecycle.
PostgreSQL owns the committed facts. Async primitives own delivery and durable progress according to
their existing semantics.

## Runtime Contract

The eventual EclipseERP-owned contract should remain minimal. Required concepts are:

```text
EntityType
EntityAddress
EntityCommandId
EntityVersion
EntityRef
EntityRuntime
EntityContext
```

These names describe architectural roles, not a commitment to exact TypeScript APIs. Do not add a
package or abstraction until an experimental workload needs it.

A runtime implementation must support:

- deterministic lookup by entity address;
- one logical active owner at a time;
- stale-owner fencing;
- serialized command admission for one entity;
- bounded activation and recovery;
- runtime-state version inspection;
- adapter-independent errors;
- tracing and metrics;
- a local test implementation;
- category-level disablement or fallback.

The runtime does not grant business permission. Domain authorization still runs for every command,
including commands initiated by Process Studio or plugins.

## Entity Selection

A stateful entity represents a meaningful consistency or activity boundary, not one normalized
database row.

A candidate must have:

1. a stable domain identity;
2. one owning domain capability;
3. a command surface through the owner's public contract;
4. a meaningful serialization boundary;
5. a documented canonical PostgreSQL representation;
6. a recovery and reconciliation strategy;
7. measurable or necessary runtime benefit.

Good candidates may include:

```text
InventoryPosition(tenantId, warehouseId, itemId)
WorkflowInstance(tenantId, instanceId)
ReservationBucket(tenantId, resourceType, resourceId)
ReconciliationSession(tenantId, sessionId)
FiscalCloseProcess(tenantId, legalEntityId, fiscalPeriodId)
```

These are examples, not approved implementations.

Poor candidates include static reference rows, arbitrary join-table records, general reporting
queries, full-text search documents, and values that only need a short-lived cache.

## Addressing

Entity addresses are deterministic, tenant-aware, version-stable, and defined by the owning domain.

Conceptual form:

```text
{entityType}/{tenantId}/{domainIdentity...}
```

Example:

```text
inventory-position/{tenantId}/{warehouseId}/{itemId}
```

Rules:

- use opaque internal identifiers, not mutable names or external identifiers;
- include every scope component required to prevent accidental collisions;
- encode and validate components canonically;
- never include node, region, bucket, PostgreSQL shard, or adapter topology;
- do not treat the address as authorization evidence;
- preserve the logical address across adapter replacement.

## Command Routing

```text
request
  |
  v
authenticate principal
  |
  v
decode public command
  |
  v
authorize tenant-aware capability
  |
  v
derive entity address in owning domain
  |
  v
resolve EntityRef
  |
  v
route to current owner
  |
  v
serialize and evaluate command
  |
  v
commit canonical PostgreSQL transaction
  |
  +--> publish transactional event/outbox
  |
  v
advance or invalidate runtime projection
  |
  v
return typed result
```

The application must not expose adapter stubs as public domain contracts. Internal calls remain
typed service calls; they do not use loopback HTTP merely because a distributed adapter exists.

## Category Execution Contract

Runtime adoption is optional for EclipseERP as a whole. An approved entity category may nevertheless
declare entity-serialized execution as required for its consistency boundary. Once it does, runtime
semantics are mandatory for that category even though the adapter remains replaceable:

- every command that can mutate the same serialized invariant must enter the `StatefulEntityRuntime`
  contract;
- a local or direct-PostgreSQL adapter is a valid fallback only if it preserves the category's
  address, active-owner, fencing, serialization, recovery, and observability semantics;
- a command must not use the runtime for one transition and silently bypass it with a direct domain
  write for another transition on the same invariant;
- the public domain contract, authorization, idempotency, PostgreSQL transaction, and constraints
  remain in force on every adapter path.

Therefore:

```text
runtime adoption:       optional globally
category declaration:   may require runtime semantics
adapter selection:      replaceable
celld:                   experimental candidate, not mandatory
```

Disabling or changing a category's runtime requirement is a reviewed category-level change. It must
not be introduced as an incidental fallback after an adapter failure.

## Entity Lifecycle

### 1. Resolve

The owning domain derives the deterministic address. The runtime resolves the current owner or
begins ownership acquisition.

### 2. Activate

The owner loads runtime state. Rebuildable state may load a checkpoint and then catch up from
PostgreSQL. Runtime-durable state may restore through the adapter, but it must still verify its
canonical version where business facts are involved.

### 3. Reconcile

Before accepting an invariant-sensitive command, the entity verifies that its runtime version is
compatible with PostgreSQL. A stale entity catches up, rebuilds, or fails closed; it never
overwrites a newer canonical version.

### 4. Execute

Commands for one address enter the entity's serialization boundary. Domain logic validates the
transition. Canonical effects execute through the owning public domain service and PostgreSQL
transaction.

### 5. Commit and project

PostgreSQL commit establishes canonical success. The runtime then advances its projection or marks
it for catch-up. Transactional events and outbox records are written with the canonical mutation.

### 6. Idle and hibernate

An inactive entity may release memory or durable ownership according to the adapter. Important
in-memory data must already exist in runtime-durable storage or be rebuildable.

### 7. Reactivate or move

A new owner restores or rebuilds state, validates fencing and versions, and only then resumes
command processing.

## Ownership and Serialization

One logical owner means one current serialization authority for an entity address. It does not mean:

- one global runtime owner;
- one owner for an entire tenant;
- one database transaction across several entities;
- automatic ordering across different addresses;
- permission to remove PostgreSQL constraints;
- permission to trust an unfenced runtime owner after lease loss.

Independent addresses should execute concurrently. Entity granularity must be small enough to avoid
tenant-wide bottlenecks and large enough to preserve a real domain invariant.

## Cross-Entity Work

Synchronous entity-to-entity call chains must remain short and explicit. Do not create a remotely
traversable object graph.

Choose the existing semantic primitive:

```text
one local invariant
-> one entity command and one domain transaction

cross-domain invariant that must commit together
-> explicit shared PostgreSQL transaction context when supported

committed fact and fan-out
-> PgQue event

leased or scheduled work
-> job table

checkpointed multi-step process
-> approved durable workflow / Process Studio runtime
```

Stateful entities simplify local ownership; they do not create distributed transactions.

## Runtime State

Runtime state may contain:

- current active state machine position;
- a rebuildable hot projection;
- the last reconciled canonical version;
- recent idempotency outcomes within a bounded window;
- object-local timer intent;
- active connection metadata;
- non-canonical coordination state.

It must not silently become the only copy of canonical journal, payment, inventory movement, legal
document, authorization, or audit facts.

Detailed consistency rules are owned by [`state-and-consistency.md`](./state-and-consistency.md).

## Recovery

Every entity category declares one recovery mode:

| Mode            | Recovery                                                       |
| --------------- | -------------------------------------------------------------- |
| Rebuildable     | Recompute from PostgreSQL facts and optional checkpoint        |
| Runtime-durable | Restore adapter state, then verify/catch up against PostgreSQL |
| Ephemeral       | Discard and recreate without business loss                     |
| Canonical       | Forbidden by default; requires a separate ownership ADR        |

Recovery must be bounded and observable. If rebuilding one entity requires an unbounded global scan,
the entity design or canonical projection is incomplete.

## Security

- Entity addresses are untrusted routing inputs and must be decoded and scoped.
- Authentication and authorization remain outside adapter ownership.
- Runtime infrastructure is not a tenant-security boundary.
- Plugins invoke public domain contracts, never runtime or adapter internals.
- Runtime snapshots, traces, and diagnostics follow the same tenant and sensitive data handling
  rules as canonical services.
- Adapter credentials and topology remain infrastructure secrets.

## Observability

The runtime must expose technical and domain-correlated telemetry.

Required technical dimensions:

```text
entity_type
hashed_or_redacted_entity_address
adapter
owner_node
ownership_epoch_or_fence
activation_reason
runtime_version
canonical_version
command_type
command_id
correlation_id
causation_id
tenant_id where policy permits
```

Required metrics include:

- command queue depth and wait time per entity type;
- command latency and failure rate;
- activation, restoration, and reconciliation latency;
- ownership acquisition, loss, movement, and fencing failures;
- resident, idle, hibernated, rebuilding, and failed entities;
- runtime/canonical version divergence;
- duplicate command rate and idempotency hits;
- PostgreSQL transactions, reads, retries, and lock waits for enabled workloads;
- adapter resource pressure and shedding;
- queue or outbox lag caused by entity commands.

Raw business identifiers and payloads must not be placed in high-cardinality metrics. Traces and
logs require redaction and retention policy.

## Adoption Workflow

For each proposed entity category:

1. document the invariant and current contention or coordination problem;
2. benchmark the existing direct-PostgreSQL path;
3. define the address, state class, version, command ID, and recovery path;
4. implement a local adapter and deterministic tests;
5. run failure-injection and reconciliation tests;
6. evaluate a distributed adapter behind the same contract;
7. compare correctness, latency, database load, and operating cost;
8. activate only through a category-specific reviewed configuration or ADR.

No category is enabled because another ERP object uses a similar name or because a table is large.
