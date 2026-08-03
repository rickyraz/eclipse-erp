# PostgreSQL 19 Architecture

> **Status:** Canonical
>
> **Related documents**
>
> - Active runtime: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - Hierarchy and graph selection:
>   [`./hierarchy-and-graph-selection.md`](./hierarchy-and-graph-selection.md)
> - Transactional-truth ADR:
>   [`../decisions/0003-postgresql-is-transactional-truth.md`](../decisions/0003-postgresql-is-transactional-truth.md)

- Database roles: [`../operations/database-roles.md`](../operations/database-roles.md)
- Architecture enforcement: [`./architecture-enforcement.md`](./architecture-enforcement.md)

## Position

PostgreSQL 19 is the development floor and the transactional core. The project may track beta and
release-candidate builds during development but must move to PostgreSQL 19 GA before production
deployment. The kernel rejects connections whose `server_version_num` is below `190000` before
running application work.

## Application Shape

EclipseERP is a modular monolith with multiple executables:

```text
eclipse-api
eclipse-worker
eclipse-migrate
eclipse-event-relay
```

They share domain packages and one PostgreSQL ownership model.

## Domain Ownership

Each domain owns a PostgreSQL schema:

```text
identity.*
auth.*
authorization.*
crm.*
sales.*
procurement.*
inventory.*
accounting.*
billing.*
manufacturing.*
projects.*
hr.*
workflow.*
integration.*
audit.*
```

A module must not perform arbitrary mutations against another module's schema. It must call the
owning module through a typed contract.

## Transactional Truth

PostgreSQL stores all state that determines business truth, including:

- parties and legal entities;
- orders and commitments;
- reservations and stock movements;
- invoices and payments;
- journal entries and fiscal periods;
- permissions and workflow state;
- audit events;
- integration outbox entries;
- durable jobs.

Redis, ClickHouse, search indexes, and caches are not authoritative.

## Integrity Rules

- Prefer composite tenant-aware keys where appropriate.
- Use foreign keys and checks for structural invariants.
- Use unique constraints for identity rules.
- Use explicit transaction isolation for concurrency-sensitive operations.
- Use row or advisory locks only with documented lock ordering.
- Keep immutable financial facts append-oriented.
- Record corrections through reversal or compensating entries.
- Warehouse transfers are transactional inventory operations: confirmation
  deducts source availability, while completion credits the destination.

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

## Operational Requirements

Production readiness requires:

- backup and point-in-time recovery;
- migration rehearsal;
- connection-pool limits;
- observability for lock waits and slow queries;
- invariant checks;
- workload replay for risky changes.
