# PostgreSQL 19 Architecture

> **Status:** Canonical
>
> **Related documents**
>
> - Active runtime: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - Workload isolation: [`./workload-isolation.md`](./workload-isolation.md)
> - Search architecture: [`./search-architecture.md`](./search-architecture.md)
> - Hierarchy and graph selection:
>   [`./hierarchy-and-graph-selection.md`](./hierarchy-and-graph-selection.md)
> - Financial ledger architecture: [`./financial-ledger.md`](./financial-ledger.md)
> - Financial ledger ADR:
>   [`../decisions/0040-adopt-tigerbeetle-financial-ledger.md`](../decisions/0040-adopt-tigerbeetle-financial-ledger.md)
> - Historical transactional-truth ADR:
>   [`../decisions/0003-postgresql-is-transactional-truth.md`](../decisions/0003-postgresql-is-transactional-truth.md)
> - Replica read-your-writes ADR:
>   [`../decisions/0039-select-postgresql-wait-for-for-replica-read-your-writes.md`](../decisions/0039-select-postgresql-wait-for-for-replica-read-your-writes.md)
> - Database roles: [`../operations/database-roles.md`](../operations/database-roles.md)
> - Architecture enforcement: [`./architecture-enforcement.md`](./architecture-enforcement.md)

## Position

PostgreSQL 19 is the development floor and the transactional core for the control plane and
non-ledger domain state. The project may track beta and release-candidate builds during development
but must move to PostgreSQL 19 GA before production deployment. The kernel rejects connections whose
`server_version_num` is below `190000` before running application work. The financial ledger profile
uses TigerBeetle for accepted transfers and balances through the boundary in
[`financial-ledger.md`](./financial-ledger.md).

## Application Shape

EclipseERP is a modular monolith with multiple executables:

```text
eclipse-api
eclipse-worker
eclipse-migrate
eclipse-event-relay
```

They share domain packages and one PostgreSQL ownership model.

Workload-isolated deployments may run separate command, query, and async composition roots with
distinct credentials, pools, and hard resource budgets. This is resource topology inside one
application family, not domain microservices. Query workers that claim hard projection isolation do
not possess a PostgreSQL-primary credential. A separate bounded read-only authorization path may
serve sensitive projection queries. Async lifecycle roles remain narrow; async-triggered business
commands re-enter the command role and transaction path.

## Domain Ownership

The implemented schema registry is:

```text
system.*         -> kernel
identity.*       -> identity
party.*          -> party
auth.*           -> auth
authorization.*  -> authorization
sales.*          -> sales
procurement.*    -> procurement
inventory.*      -> inventory
accounting.*     -> accounting
process.*        -> process
billing.*        -> billing
integration.*    -> integrations
messaging.*      -> messaging
```

`packages/catalog` is contract-only and owns no PostgreSQL schema. Planned domains do not receive a
schema until a concrete invariant requires one and the ownership registry is updated. A module must
not perform arbitrary mutations against another module's schema; it must call the owner through a
typed public contract.

## Transactional Truth

PostgreSQL stores the ERP control-plane and non-ledger state that determines business truth,
including:

- parties and legal entities;
- orders and commitments;
- reservations and stock movements;
- invoices and payments;
- account meaning, fiscal periods, and posting policy;
- permissions and workflow state;
- audit events;
- integration outbox entries;
- durable jobs;
- journal/document metadata and rebuildable financial projections.

For an activated financial ledger profile, TigerBeetle is authoritative for accepted financial
transfers, balances, balance constraints, and immutable transfer history. PostgreSQL stores the
operation intent, deterministic identity mapping, audit references, and projection state; those
records do not become a competing financial authority.

Redis, ClickHouse, search indexes, and caches are not authoritative.

## Integrity Rules

- Prefer composite tenant-aware keys where appropriate.
- Use foreign keys and checks for structural invariants.
- Use unique constraints for identity rules.
- Use explicit transaction isolation for concurrency-sensitive operations.
- Use row or advisory locks only with documented lock ordering.
- Keep PostgreSQL-owned financial metadata and projections append-oriented.
- Record corrections through reversal or compensating entries; accepted TigerBeetle transfers are
  never edited or deleted.
- Warehouse transfers are transactional inventory operations: confirmation
  deducts source availability, while completion credits the destination.
- Do not treat a TigerBeetle call as part of a PostgreSQL transaction; use the durable financial-ledger
  protocol and reconcile cross-store outcomes.

## Migration Integrity

Migration discovery is deterministic by timestamped directory name. Names, versions, checksums, and
snapshot ancestry must form one valid ordered catalog.

Applied named migrations are immutable. Before applying pending migrations, the kernel compares the
local catalog with `system.schema_migrations` and rejects missing, modified, duplicated, reordered,
or retroactively inserted migration identities. A semantic change to an applied migration requires a
new migration rather than rewriting history.

Clean-database migration tests apply the complete discovered catalog and verify idempotent re-entry.
Domain-specific database tests verify observable constraints and trigger behavior instead of
matching historical SQL text.

## Projections

Create projections only when measured read requirements justify them. Projections must be
rebuildable from authoritative facts or have an explicit reconciliation process.

Dashboard, search, and reporting routes may use a separate projection store to prevent degradable
reads from consuming command resources. A hard-isolated projection route must not silently fall back
to the primary when its projection path is stale, unavailable, or saturated.

PostgreSQL 19 `WAIT FOR` is selected by ADR-0039 as the deferred mechanism for route-scoped
replica-backed read-your-writes. It is not active merely because a replica exists and does not mean
the replica equals the primary's latest state. Raw WAL and LSN details remain inside PostgreSQL
infrastructure behind an opaque consistency context. Production activation requires PostgreSQL 19
GA and the route, timeout, timeline, authorization, no-fallback, load, and failover gates owned by
[`state-and-consistency.md`](./state-and-consistency.md).

Search indexes over canonical tables are physical access paths, not new business facts. Cross-domain
search documents and embeddings are rebuildable projections governed by
[`search-architecture.md`](./search-architecture.md). A PostgreSQL search extension must support the
project's PostgreSQL 19 floor and pass installation, migration, recovery, replication, workload, and
exit gates before production use.

## Guarantee Boundary

PostgreSQL participates in three distinct guarantee levels:

```text
transaction integrity
-> transactions, constraints, isolation, and locks

connection and privilege containment
-> roles, credentials, connection-admission reserve, pools, and timeouts

physical workload non-interference
-> runtime admission plus compute, memory, storage, and network isolation
```

The first two levels can be enforced partly by PostgreSQL. The third requires the workload-isolation
fabric and deployment proof defined by [`workload-isolation.md`](./workload-isolation.md). A shared
primary with separate roles and pools must not be described as physical CPU, memory, I/O, WAL,
storage, or failover isolation. Detailed role grants and the PostgreSQL server reserve are owned by
[`../operations/database-roles.md`](../operations/database-roles.md).

## Operational Requirements

Production readiness requires:

- backup and point-in-time recovery;
- migration rehearsal;
- connection-pool limits and a reviewed total connection budget;
- a non-zero command connection reserve where overload isolation is claimed;
- distinct roles, credentials, and network paths for isolated command, query, and async planes;
- proof that adaptive admission cannot exceed physical pool and executor ceilings;
- observability for lock waits and slow queries;
- invariant checks;
- workload replay and adversarial overload tests for risky changes;
- when the financial ledger profile is enabled, corresponding TigerBeetle backup, restore, upgrade,
  outage, reconciliation, and adapter-exit rehearsals.
