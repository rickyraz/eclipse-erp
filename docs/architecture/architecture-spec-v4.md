# EclipseERP Architecture Specification v4

> **Status:** Canonical and active
>
> **Supersedes:** Earlier backend-runtime decisions.
>
> **Related documents**
>
> - Summary: [`./overview.md`](./overview.md)
> - PostgreSQL architecture: [`./postgresql-19-architecture.md`](./postgresql-19-architecture.md)
> - Authorization: [`./authorization.md`](./authorization.md)
> - Messaging: [`./pgque-messaging.md`](./pgque-messaging.md)
> - Durable execution: [`./durable-execution.md`](./durable-execution.md)
> - Plugin architecture: [`./plugin-architecture.md`](./plugin-architecture.md)
> - Frontend architecture: [`./frontend.md`](./frontend.md)
> - Frontend SPA decision: [`../decisions/0010-use-vite-solidjs-spa.md`](../decisions/0010-use-vite-solidjs-spa.md)
> - Architecture enforcement: [`./architecture-enforcement.md`](./architecture-enforcement.md)
> - Testing strategy: [`../development/testing.md`](../development/testing.md)
> - Database roles: [`../operations/database-roles.md`](../operations/database-roles.md)
> - ADR index: [`../decisions/README.md`](../decisions/README.md)

## Decision

EclipseERP remains a modular monolith. This specification changes the
application runtime, not the domain, ledger, audit, or transactional-integrity
principles.

| Area | Decision |
|---|---|
| Language | TypeScript strict |
| Application model | Effect |
| Runtime | Deno |
| HTTP | `@effect/platform` with a Deno adapter |
| Database | PostgreSQL |
| Query layer | Drizzle ORM with `postgres.js` |
| Migrations | Reviewed, versioned SQL |
| Native compute | Optional Zig through `Deno.dlopen` |
| Frontend | Vite-based SolidJS 2.0 SPA with a separate backend |
| Contracts | Effect Schema |

Effect owns typed failures, lifecycle, concurrency, retry, telemetry, and
dependency injection. Drizzle owns typed schema and query construction.
PostgreSQL owns constraints and transactions.

## Repository Shape

```text
eclipse-erp/
├── apps/
│   ├── api/
│   ├── worker/
│   ├── event-relay/
│   ├── migrate/
│   └── web/                 # Vite + SolidJS 2.0 SPA
├── packages/
│   ├── kernel/
│   ├── identity/
│   ├── sales/
│   ├── procurement/
│   ├── inventory/
│   ├── accounting/
│   ├── billing/
│   └── integrations/
├── native/eclipse-calc/
├── db/
│   ├── schema/
│   ├── migrations/
│   ├── policies/
│   └── seeds/
├── deno.json
└── drizzle.config.ts
```

The executables share domain packages. Internal module calls must not use
loopback HTTP.

## Module Contract

A module may publicly expose:

- command and query functions;
- Effect service interfaces;
- tagged domain errors;
- Effect Schema DTOs;
- production and test layers.

Table definitions and repository implementations remain internal.

Dependencies must be visible in the Effect environment type. Business errors
must remain tagged and exhaustively handled.

## Database Contract

Drizzle is used for typed tables, indexes, queries, parameter binding, and
transactions. It must not conceal PostgreSQL-specific behavior such as:

- RLS;
- isolation levels;
- advisory and row locks;
- deferred constraints;
- partitioning;
- `ltree`;
- SQL/PGQ;
- custom operators.

Reviewed SQL is the escape hatch and remains a first-class artifact.

## Transaction Contract

A transaction context is explicit. Cross-domain operations that require atomic
consistency participate in the same PostgreSQL transaction through typed
services.

No module may mutate another module's tables directly.

## Asynchronous Contract

Effect fibers are not durable. Use:

```text
PostgreSQL transaction
-> synchronous invariant

PgQue
-> committed event and fan-out

Job table
-> scheduled or leased single-consumer work

pg_durable
-> checkpointed workflow after production approval
```

## Frontend Contract

The frontend is a separately deployed Vite-based SolidJS 2.0 SPA.

Its default stack is:

```text
Solid Router
+ TanStack Solid Query
+ TanStack Solid Table
+ TanStack Solid Virtual
+ TanStack Solid Form
+ Effect Schema
+ Kobalte
```

The router owns navigation and validated URL state. It must not own business
policy or backend transaction behavior.

TanStack Query owns remote server state. Local Solid primitives own local view
state. Shared Effect Schema contracts validate route and API boundaries.

SolidStart and SSR are not enabled by default. Their adoption requires an
explicit requirement and a new or superseding ADR.

See [`./frontend.md`](./frontend.md) for detailed frontend rules.

## Zig FFI Boundary

Zig is optional and limited to bounded compute. The adapter must define:

- ABI version;
- input and output schema;
- memory ownership;
- maximum input size;
- error mapping;
- timeout behavior;
- benchmark threshold;
- TypeScript fallback.

Zig must not open database transactions or perform hidden I/O.
