# Architecture Overview

> **Status:** Canonical summary
>
> **Related documents**
>
> - Full specification: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - PostgreSQL design: [`./postgresql-19-architecture.md`](./postgresql-19-architecture.md)
> - Workload isolation: [`./workload-isolation.md`](./workload-isolation.md)
> - Search architecture: [`./search-architecture.md`](./search-architecture.md)
> - Stateful runtime: [`./runtime-architecture.md`](./runtime-architecture.md)
> - State and consistency: [`./state-and-consistency.md`](./state-and-consistency.md)
> - Financial ledger: [`./financial-ledger.md`](./financial-ledger.md)
> - Frontend architecture: [`./frontend.md`](./frontend.md)
> - Process Studio architecture: [`./process-studio.md`](./process-studio.md)
> - External integration surface: [`./integration-architecture.md`](./integration-architecture.md)
> - Architecture enforcement: [`./architecture-enforcement.md`](./architecture-enforcement.md)
> - Database roles: [`../operations/database-roles.md`](../operations/database-roles.md)
> - ADR index: [`../decisions/README.md`](../decisions/README.md)

## System Shape

```text
Users
  |
Edge / thin workload router
  |
WorkloadCell placement (topology-private)
  |
  +--> Command plane --> command pool --> PostgreSQL control plane
  |         |
  |         +--> FinancialLedgerPort --> trusted TigerBeetle adapter --> TigerBeetle
  |         `--> optional Stateful Entity Runtime for approved aggregates
  |
  +--> Query plane --> query pool --> rebuildable projection store
  |
  `--> Async plane --> PgQue / jobs / workflows / integrations
                              |
                              `--> projection builders and financial reconciliation

PostgreSQL 19 remains canonical for non-ledger transactional domain state, metadata,
authorization, audit, outbox, and durable work. TigerBeetle is canonical for accepted
financial transfers, balances, and transfer history in the activated ledger profile.
```

The API, worker, event relay, and migrator remain separate processes in one application family. They
share domain packages. WorkloadCell placement must preserve every accepted cross-domain PostgreSQL
transaction boundary; splitting one requires a superseding consistency decision. The processes are
not independent microservices. Minimal deployments may colocate workload roles; hard-isolation
claims require actual reserved resources, credentials, pools, and tested failure boundaries.

## Runtime

```text
Backend:
TypeScript strict
+ Effect
+ Deno
+ @effect/platform
+ Drizzle ORM
+ postgres.js

Frontend SPA:
Vite
+ SolidJS 2.0
+ Solid Router or an adapted TanStack Solid Router
+ TanStack Solid Query
+ TanStack Solid Table
+ TanStack Solid Virtual
+ TanStack Solid Form
+ Effect Schema
+ Kobalte
```

Effect handles typed failures, dependency injection, lifecycle, concurrency,
retry, streams, and telemetry. Drizzle handles typed schema and queries.
PostgreSQL remains responsible for control-plane transactions and non-ledger
business invariants. The FinancialLedgerPort sends accepted financial movements
to TigerBeetle; the optional Stateful Entity Runtime may own active serialization
and hot state for explicitly approved aggregates, but it does not become financial
authority.

## Boundaries

Each domain owns its PostgreSQL schema and internal implementation. Cross-domain
interaction occurs through typed Effect services, commands, queries, and events.

A Sales operation may call `InventoryService.reserveStock` in the same
transaction, but Sales must not import or mutate Inventory tables directly.

## Consistency

- Direct PostgreSQL transaction: non-ledger invariant required before request success.
- Financial ledger protocol: durable PostgreSQL intent, TigerBeetle acceptance, projection, and reconciliation.
- Stateful Entity Runtime: optional active ownership and identity-local serialization.
- PgQue: committed fact and fan-out.
- Job table: single-consumer work with lease and lifecycle.
- `pg_durable`: checkpointed multi-step workflow after compatibility approval.
- ClickHouse, search indexes, and caches: rebuildable projections.

## Non-Interference

Commands, projection queries, and asynchronous work have separate workload metadata and bounded
admission. A deployment claiming hard query-to-command isolation reserves command ingress,
executors, and connection capacity that projection-query and async lifecycle work cannot acquire.
Projection-query executors hold no primary credential. Async infrastructure may use a separate,
narrow primary-backed lifecycle budget, but async-triggered business commands must re-enter the
command path. Projection failure degrades or rejects reads; it does not silently fall back to
reserved command resources.

WorkloadCells and optional tenant-aware shuffle sharding narrow deployment blast radius without
changing domain ownership, public identity, authorization, or PostgreSQL truth. See
[`./workload-isolation.md`](./workload-isolation.md).

## Search

Exact and structured PostgreSQL queries remain the default. Domain-local search reads only owned
data. Global search consumes published facts into a tenant-scoped, rebuildable projection and returns
candidate references that are revalidated through the owning domain before sensitive use or action.
PostgreSQL-native BM25 and vector search remain gated by PostgreSQL 19 compatibility and workload
evidence; external search remains a later deployment optimization.

See [`./search-architecture.md`](./search-architecture.md).

## External Integration Surface

External integrations use a typed connector boundary. HTTPS + JSON + OpenAPI is
the default action surface; CloudEvents over HTTPS and AsyncAPI describe external
events; OAuth 2.0 and stable Problem Details protect and normalize the surface.
Connector protocols such as Kafka, gRPC, SOAP, or OData remain adapters and do
not enter domain contracts or Process IR.

See [`./integration-architecture.md`](./integration-architecture.md).

## Process Composition

The planned Process Studio composes versioned typed actions and events through a
small deterministic Process IR. It is catalog-first and runtime-first: domain
capability metadata, compensation, idempotency, correlation, and durable
headless execution mature before the visual designer. Published definitions are
immutable, running instances remain version-pinned, and every command executes
through its owning public domain contract.

See [`./process-studio.md`](./process-studio.md) for the canonical target and
0.8–1.0 delivery gates.

## Extensions

Preferred order:

1. core module;
2. declarative tenant extension;
3. trusted compiled plugin;
4. sandboxed plugin after contracts stabilize.

## Native Code

Zig is limited to bounded calculation or reconciliation kernels backed by
benchmarks. Native code never owns PostgreSQL transactions or authoritative
state.
