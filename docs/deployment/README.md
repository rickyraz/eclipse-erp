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
node, region, PostgreSQL shard, cache product, runtime adapter, fleet, bucket, or deployment
topology.

## Layer Responsibilities

| Layer                      | Minimum architectural requirement                                                                                                    | Deployment freedom                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Frontend and static assets | Typed API boundary; no ownership of authorization or business invariants                                                             | Local static server, CDN, or independently scaled asset hosting                          |
| API and domain services    | Stateless by default; typed commands; authorization and tenant scope enforced before mutation                                        | One process or many replicas behind a load balancer                                      |
| PostgreSQL                 | Canonical business facts, transactions, constraints, history, and audit                                                              | Direct connection, pooling, replicas, partitioning, or sharding hidden behind the kernel |
| Read replicas              | Staleness must be explicit; never validate an invariant or satisfy required read-after-write behavior from stale data                | Optional and independently scaled per read workload                                      |
| Stateful Entity Runtime    | Optional active ownership and entity-local serialization; never canonical authority by itself                                        | Local adapter, `celld`, another adapter, or disabled per entity category                 |
| PgQue                      | Committed-event stream and fan-out; publication remains atomic with the canonical mutation                                           | Consumers may be colocated or independently scaled                                       |
| Job workers                | Leased, scheduled, prioritized single-consumer work with retries and observable lifecycle                                            | Colocated workers or separate worker pools                                               |
| Durable workflow           | Persisted checkpoints, retries, compensation, recovery, and audit correlation                                                        | Compatibility job layer or `pg_durable` after its production gates pass                  |
| Cache                      | Disposable or rebuildable acceleration only; never the sole correctness, authorization, lock, balance, stock, or idempotency barrier | No cache, in-process cache, distributed cache, CDN cache, or browser query cache         |
| Search index               | Rebuildable projection; never an authoritative mutation target                                                                       | PostgreSQL search initially or a separate search engine when measured need exists        |
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

Read replicas may serve explicitly stale-tolerant queries. Invariant-sensitive reads and writes
remain on a transactionally appropriate primary or shard. Cross-shard business work must stay
explicit as a transaction, durable process, event, or compensation; infrastructure must not pretend
several shards form one local transaction.

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

### Scaled

A larger installation may independently add or scale:

- CDN and multiple API replicas;
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

Products such as `celld`, PgQue, `pg_durable`, Redis, ClickHouse, or a search engine are not granted
business authority merely because they are deployed. EclipseERP depends on the minimum architectural
semantics assigned to each layer and keeps product-specific topology behind infrastructure adapters
or composition roots.
