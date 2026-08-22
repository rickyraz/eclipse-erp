# RITSEI Architecture

RITSEI is an orthogonal modular monolith built around explicit domain ownership, PostgreSQL-enforced
integrity, Effect-based application services, and independently deployable frontend infrastructure.

## Canonical Specification

The authoritative architecture specification is:

[`docs/architecture/architecture-spec-v4.md`](./docs/architecture/architecture-spec-v4.md)

## Core Architecture

- Runtime: Deno
- Language: TypeScript strict
- Application model: Effect
- Database: PostgreSQL 19+
- Query layer: Drizzle ORM + postgres.js
- Frontend: Vite + SolidJS 2.0
- Contracts: Effect Schema
- Stateful ownership: optional vendor-neutral Stateful Entity Runtime
- Overload isolation: workload planes, reserved command capacity, and topology-private WorkloadCells
- Analytics: domain-owned facts, versioned metrics, rebuildable projections, and no primary fallback
- Search: PostgreSQL-first, rebuildable, and provider-replaceable
- Native compute: optional Zig through `Deno.dlopen`
- Process composition target: typed catalogs, deterministic Process IR, and a governed Process
  Studio

Stateful ownership, routing, recovery, and consistency are defined in
[`docs/architecture/runtime-architecture.md`](./docs/architecture/runtime-architecture.md) and
[`docs/architecture/state-and-consistency.md`](./docs/architecture/state-and-consistency.md). The
canonical Process Studio target and staged 0.8–1.0 roadmap are defined in
[`docs/architecture/process-studio.md`](./docs/architecture/process-studio.md). The external
connector profile is defined in
[`docs/architecture/integration-architecture.md`](./docs/architecture/integration-architecture.md).
Workload planes, resource admission, WorkloadCells, shuffle sharding, and non-interference proofs
are defined in
[`docs/architecture/workload-isolation.md`](./docs/architecture/workload-isolation.md). Analytic
facts, metrics, freshness, semantic queries, and provider gates are defined in
[`docs/architecture/analytics-architecture.md`](./docs/architecture/analytics-architecture.md).
Search authority, projections, provider gates, and search-specific workload safety are defined in
[`docs/architecture/search-architecture.md`](./docs/architecture/search-architecture.md).

## Dependency Ownership

```text
             ┌─────────────────────┐
             │    package.json     │
             │                     │
             │ npm dependencies    │
             │ JSR dependencies    │
             │ dev dependencies    │
             └──────────┬──────────┘
                        │
                        ▼
                  deno install
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
         node_modules         deno.lock


             ┌─────────────────────┐
             │      deno.json      │
             │                     │
             │ runtime             │
             │ permissions         │
             │ compiler            │
             │ fmt / lint          │
             │ tasks               │
             └─────────────────────┘
```
