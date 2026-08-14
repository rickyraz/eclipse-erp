# Deployment Notes

> **Status:** Reference operational note
>
> This document summarizes deployment posture. Canonical runtime semantics remain owned by the
> linked architecture documents.
>
> **Related documents**
>
> - Canonical architecture:
>   [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - PostgreSQL architecture:
>   [`../architecture/postgresql-19-architecture.md`](../architecture/postgresql-19-architecture.md)
> - Search architecture:
>   [`../architecture/search-architecture.md`](../architecture/search-architecture.md)
> - Workload isolation:
>   [`../architecture/workload-isolation.md`](../architecture/workload-isolation.md)
> - Stateful runtime:
>   [`../architecture/runtime-architecture.md`](../architecture/runtime-architecture.md)
> - State and consistency:
>   [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
> - Messaging: [`../architecture/pgque-messaging.md`](../architecture/pgque-messaging.md)
> - Durable execution:
>   [`../architecture/durable-execution.md`](../architecture/durable-execution.md)
> - External integrations:
>   [`../architecture/integration-architecture.md`](../architecture/integration-architecture.md)
> - Frontend: [`../architecture/frontend.md`](../architecture/frontend.md)

## Topology Posture

EclipseERP does not lock operators into one deployment topology. A small installation may colocate
logical roles and use PostgreSQL directly. A larger installation may replicate, partition, shard, or
independently scale approved runtime components.

The architecture standardizes the minimum semantics needed to preserve correctness, not a mandatory
vendor product, process count, node count, region layout, or scaling strategy. Infrastructure may be
replaced or omitted when its required semantics remain satisfied.

Domain contracts, entity addresses, events, persistence schemas, and Process IR must not expose
node, region, WorkloadCell, shuffle shard, executor, pool, PostgreSQL shard, cache product, runtime
adapter, fleet, bucket, or deployment topology.

A colocated deployment may use logical workload classes and bounded semaphores, but it must not claim
physical non-interference. A hard-isolation claim requires named disjoint resources, bounded shared
dependencies, separate credentials and paths where applicable, and executable overload evidence.

## Layer Responsibilities

| Layer                      | Minimum architectural requirement                                                                                                    | Deployment freedom                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Frontend and static assets | Typed API boundary; no ownership of authorization or business invariants                                                             | Local static server, CDN, or independently scaled asset hosting                          |
| Thin workload router       | Topology-only placement and bounded ingress; no business mutation, PostgreSQL transaction, or primary credential                     | Colocated edge role or independently scaled router with protected command ingress        |
| API and domain services    | Stateless by default; typed commands; authorization and tenant scope enforced before mutation                                        | One process or many replicas behind a load balancer                                      |
| PostgreSQL                 | Canonical business facts, transactions, constraints, history, and audit                                                              | Direct connection, pooling, replicas, partitioning, or sharding hidden behind the kernel |
| Read replicas              | Staleness must be explicit; read-your-writes requires the deferred ADR-0039 consistency-token and activation gates; never validate an invariant from replica state | Optional and independently scaled per read workload |
| Projection query plane     | Bounded, authorized, rebuildable reads; hard-isolated routes have no primary credential or primary fallback                         | Colocated logical role, separate process, replica, or independent projection store       |
| Stateful Entity Runtime    | Optional active ownership and entity-local serialization; never canonical authority by itself                                        | Local adapter, `celld`, another adapter, or disabled per entity category                 |
| PgQue                      | Committed-event stream and fan-out; publication remains atomic with the canonical mutation                                           | Consumers may be colocated or independently scaled                                       |
| Job workers                | Leased, scheduled, prioritized single-consumer work with retries and observable lifecycle                                            | Colocated workers or separate worker pools                                               |
| Durable workflow           | Persisted checkpoints, retries, compensation, recovery, and audit correlation                                                        | Compatibility job layer or `pg_durable` after its production gates pass                  |
| Cache                      | Disposable or rebuildable acceleration only; never the sole correctness, authorization, lock, balance, stock, or idempotency barrier | No cache, in-process cache, distributed cache, CDN cache, or browser query cache         |
| Search index               | Exact and structured PostgreSQL first; ranked, vector, and external projections remain rebuildable and non-authoritative             | Primary, stale-tolerant replica, PostgreSQL extension, or external engine after gates    |
| Analytics store            | Rebuildable projection of committed facts; no direct write-back into domain tables                                                   | PostgreSQL reporting, replicas, ClickHouse, warehouse, or another analytics engine       |
| External connectors        | Typed, authenticated, idempotent boundary with timeout, retry, provider status, and recovery                                         | Colocated adapters or separately deployed connector workers                              |
| Observability              | Correlation, metrics, logs, traces, and alerts without becoming business authority                                                   | Any approved telemetry backend or local tooling                                          |

## Cache Rules

A cache is an optimization layer, not an ERP authority.

- Cache loss, eviction, duplication, or temporary unavailability must not corrupt canonical state.
- Cache keys and invalidation must preserve tenant scope and contract or projection versions.
- Critical idempotency outcomes remain stored by the owning domain; a cache may only accelerate
  their retrieval.
- Authorization decisions, balances, available stock, fiscal locks, and uniqueness checks must be
  revalidated at their authoritative boundary when correctness depends on current state.
- Committed events may provide cache invalidation hints, but consumers remain idempotent and
  tolerate delayed or repeated invalidation.
- Every cache-backed read needs a safe source-of-truth fallback or an explicit availability failure;
  stale data must not silently authorize or commit a transition.
- Frontend server-state caching improves responsiveness but never replaces API validation,
  authorization, or transaction checks.

Redis or another distributed cache is therefore optional. It should be introduced only when a
measured latency, throughput, or fan-out problem cannot be solved acceptably with bounded in-process
caching, PostgreSQL indexes, or query improvements.

## Search Deployment

Search begins on PostgreSQL with exact indexes, structured filters, and built-in text search. A
PostgreSQL-native BM25 or vector extension remains optional and must support PostgreSQL 19, the
selected hosting profiles, safe migration and recovery, and bounded OLTP impact before production
use.

Search may move to a stale-tolerant PostgreSQL replica or external engine when measured isolation,
scale, or feature requirements justify it. The query contract does not expose that move. Global
search and embeddings remain rebuildable projections; current authorization and business actions
return through the owning domain.

Search connection pools, workers, replicas, and external nodes share explicit capacity and freshness
budgets. They may fail or degrade without changing canonical facts or starving invariant-sensitive
transactions. Hard-isolated routes do not fall back to the primary. Detailed search rules are owned
by [`../architecture/search-architecture.md`](../architecture/search-architecture.md); global
non-interference rules are owned by
[`../architecture/workload-isolation.md`](../architecture/workload-isolation.md).

## Database Scaling

PostgreSQL optimization remains independent from Stateful Entity Runtime routing:

```text
logical entity address
-> optional active-owner routing
-> kernel database routing
-> owning domain transaction and constraints
-> committed event and projection updates
```

Entity addresses never contain a PostgreSQL shard. Moving a tenant or aggregate between partitions
or shards must not change its public identity or domain contract.

Read replicas may serve explicitly stale-tolerant queries. ADR-0039 also selects a deferred,
route-scoped PostgreSQL 19 `WAIT FOR` path for read-your-writes after its consistency-token,
timeout, timeline, authorization, no-fallback, load, and failover gates pass. Until activation,
required read-after-write behavior remains on the authoritative path. Invariant-sensitive reads and
writes remain on a transactionally appropriate primary or shard. Every currently accepted atomic workflow
must remain transactionally colocated. Changing an accepted invariant from one PostgreSQL
transaction to a durable process, event, or compensation requires a superseding consistency ADR;
operators must not make that semantic change through shard placement. New cross-shard work must stay
explicit, and infrastructure must not pretend several shards form one local transaction.

## Deployment Profiles

### Minimal

A small installation may use:

- static frontend hosting;
- one API deployment;
- one PostgreSQL deployment;
- PgQue consumers and job workers colocated with application processes;
- PostgreSQL-backed search and reporting;
- no distributed cache;
- no Stateful Entity Runtime;
- the compatibility job layer instead of `pg_durable`.

Logical boundaries still apply even when processes are colocated.

### Workload-isolated

A deployment seeking query-to-command non-interference separates:

- command, query, and async ingress and execution budgets;
- command primary credentials, query projection credentials, optional bounded read-only query-
  authorization credentials, and narrow async lifecycle credentials;
- command, query-authorization, query-projection, and async connection pools;
- projection-safe dashboard reads from PostgreSQL-primary execution;
- hard physical ceilings from adaptive safe ceilings.

Projection failure returns declared stale, `429`, or `503` behavior and does not open a primary
fallback. Async-triggered business commands use existing job or workflow durability to reach a
command-capable worker composition root, then re-enter command admission and credentials without
loopback HTTP. The deployment publishes the exact protected resources, shared dependencies,
excluded failure modes, and overload-test results.

When PostgreSQL 19 `reserved_connections` implements the command connection reserve, deployment
validation must prove:

- only the command login inherits `pg_use_reserved_connections`;
- query, reporting, and async credentials cannot use reserved or superuser slots;
- total pool maxima, administrative headroom, and server reserves fit `max_connections`;
- saturating ordinary slots rejects query and async connection attempts while a bounded command
  connection still succeeds;
- query and async saturation does not exceed the reviewed command latency and success objectives;
- projection failure or saturation never changes routing to the primary.

### Scaled or WorkloadCell-isolated

A larger installation may independently add or scale:

- CDN, a thin workload router, and multiple API replicas;
- bounded tenant-group WorkloadCells with staggered deployment and evacuation;
- tenant-aware recursive shuffle sharding inside selected workload planes;
- connection pooling, PostgreSQL replicas, partitioning, or shards;
- dedicated PgQue consumer and job-worker pools;
- selected stateful entity categories through `celld` or another adapter;
- distributed caches;
- rebuildable search and analytics stores;
- `pg_durable` after compatibility and production approval;
- separately deployed connectors and observability infrastructure.

Scaling one layer must not require domain contracts to know its topology.

## Operator Freedom and Limits

Deployment operators may optimize each layer independently, provided that authorization, tenant
isolation, idempotency, transactions, database constraints, recovery, audit, and canonical ownership
remain intact.

Self-hosted operators may choose infrastructure appropriate to their workload. In a managed service,
the platform operator owns topology decisions. Plugins and business users cannot bypass
architectural boundaries or select arbitrary infrastructure through domain inputs.

Products such as `celld`, PgQue, `pg_durable`, Redis, ClickHouse, a pooler, or a search engine are not
granted business authority merely because they are deployed. EclipseERP depends on the minimum
architectural semantics assigned to each layer and keeps product-specific topology behind
infrastructure adapters or composition roots.

WorkloadCell placement and ResourceLease acquisition likewise do not grant tenant visibility,
capabilities, durability, or canonical ownership.
