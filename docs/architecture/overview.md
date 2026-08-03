# Architecture Overview

> **Status:** Canonical summary
>
> **Related documents**
>
> - Full specification: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - PostgreSQL design: [`./postgresql-19-architecture.md`](./postgresql-19-architecture.md)
> - Frontend architecture: [`./frontend.md`](./frontend.md)
> - Process Studio architecture: [`./process-studio.md`](./process-studio.md)
> - External integration surface: [`./integration-architecture.md`](./integration-architecture.md)
- Architecture enforcement: [`./architecture-enforcement.md`](./architecture-enforcement.md)
- Database roles: [`../operations/database-roles.md`](../operations/database-roles.md)
- ADR index: [`../decisions/README.md`](../decisions/README.md)

## System Shape

```text
Users
  |
Edge proxy
  |
API / Worker / Event Relay / Migrator
  |
PgBouncer
  |
PostgreSQL 19
  |-- transactional domain state
  |-- immutable accounting and inventory facts
  |-- authorization and audit
  |-- PgQue
  |-- durable jobs and workflows
  `-- hierarchy and graph projections
```

The API, worker, event relay, and migrator are separate processes in one
application family. They share domain packages and PostgreSQL transaction
boundaries. They are not independent microservices.

## Runtime

```text
TypeScript strict
+ Effect
+ Deno
+ @effect/platform
+ Drizzle ORM
+ postgres.js

Frontend SPA:

```text
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
```

Effect handles typed failures, dependency injection, lifecycle, concurrency,
retry, streams, and telemetry. Drizzle handles typed schema and queries.
PostgreSQL remains responsible for transactions and business invariants.

## Boundaries

Each domain owns its PostgreSQL schema and internal implementation. Cross-domain
interaction occurs through typed Effect services, commands, queries, and events.

A Sales operation may call `InventoryService.reserveStock` in the same
transaction, but Sales must not import or mutate Inventory tables directly.

## Consistency

- Direct transaction: invariant required before request success.
- PgQue: committed fact and fan-out.
- Job table: single-consumer work with lease and lifecycle.
- `pg_durable`: checkpointed multi-step workflow after compatibility approval.
- ClickHouse, search indexes, and caches: rebuildable projections.

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
