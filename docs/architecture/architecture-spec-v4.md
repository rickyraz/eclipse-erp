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
> - Frontend SPA decision:
>   [`../decisions/0010-use-vite-solidjs-spa.md`](../decisions/0010-use-vite-solidjs-spa.md)
> - Architecture enforcement: [`./architecture-enforcement.md`](./architecture-enforcement.md)
> - Testing strategy: [`../development/testing.md`](../development/testing.md)
> - Database roles: [`../operations/database-roles.md`](../operations/database-roles.md)
> - External-standard adapters:
>   [`../decisions/0013-version-external-standard-adapters.md`](../decisions/0013-version-external-standard-adapters.md)
> - Internal and external identity:
>   [`../decisions/0014-separate-internal-and-external-identifiers.md`](../decisions/0014-separate-internal-and-external-identifiers.md)
> - Semantic invariant ownership:
>   [`../decisions/0015-one-semantic-owner-per-invariant.md`](../decisions/0015-one-semantic-owner-per-invariant.md)
> - Jurisdiction localization:
>   [`../decisions/0016-isolate-jurisdiction-localization.md`](../decisions/0016-isolate-jurisdiction-localization.md)
> - ADR index: [`../decisions/README.md`](../decisions/README.md)

## Decision

EclipseERP remains a modular monolith. This specification changes the application runtime, not the
domain, ledger, audit, or transactional-integrity principles.

| Area              | Decision                                                                |
| ----------------- | ----------------------------------------------------------------------- |
| Language          | TypeScript strict                                                       |
| Application model | Effect                                                                  |
| Runtime           | Deno                                                                    |
| HTTP              | Effect v4 `HttpApi` / `HttpRouter` with `@effect/platform-node` adapter |
| Database          | PostgreSQL 19+                                                          |
| Query layer       | Drizzle ORM with `postgres.js`                                          |
| Migrations        | Pinned Drizzle Kit graph with reviewed SQL                              |
| Native compute    | Optional Zig through `Deno.dlopen`                                      |
| Frontend          | Vite-based SolidJS 2.0 SPA with a separate backend                      |
| Contracts         | Effect Schema                                                           |

Effect owns typed failures, lifecycle, concurrency, retry, telemetry, and dependency injection.
Drizzle owns typed schema and query construction. PostgreSQL owns constraints and transactions.

Deno remains the runtime and primary toolchain. npm ecosystem dependencies are canonical in the root
`package.json`; Deno uses `nodeModulesDir: "auto"` so package peers resolve through the conventional
local `node_modules` topology. Vendored Effect and Drizzle trees are references, not application
dependencies.

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
│   ├── auth/
│   ├── authorization/
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
├── package.json
└── drizzle.config.ts
```

The executables share domain packages. Internal module calls must not use loopback HTTP.

## Module Contract

A module may publicly expose:

- command and query functions;
- Effect service interfaces;
- tagged domain errors;
- Effect Schema DTOs;
- production and test layers.

Table definitions and repository implementations remain internal.

Dependencies must be visible in the Effect environment type. Business errors must remain tagged and
exhaustively handled.

Every business invariant has one owning domain capability. The owner defines its authoritative
command path, validation, mutation rules, public contract, domain errors, and persistence
constraints. Other domains may consume the contract and maintain derived projections, but must not
become competing mutation authorities or independently redefine the invariant. Detailed rationale is
owned by [ADR-0015](../decisions/0015-one-semantic-owner-per-invariant.md).

## Database Contract

Drizzle is used for typed tables, indexes, queries, parameter binding, and transactions. It must not
conceal PostgreSQL-specific behavior such as:

- RLS;
- isolation levels;
- advisory and row locks;
- deferred constraints;
- partitioning;
- `ltree`;
- SQL/PGQ;
- custom operators.

Reviewed SQL is the escape hatch and remains a first-class artifact.

The kernel owns the `postgres.js` client, Drizzle database lifecycle, typed transaction callbacks,
and stable infrastructure failures. Domain implementations build type-safe queries only against
their owned tables. Public domain contracts do not expose Drizzle or PostgreSQL types.

The authoritative migration graph is generated by pinned Drizzle Kit `1.0.0-rc.4` from
`db/schema/index.ts`. Every migration has `migration.sql` and `snapshot.json`; unsupported
PostgreSQL features use Drizzle custom migrations. All SQL remains reviewed before application.
Detailed rationale and HTTP rules are owned by
[ADR-0012](../decisions/0012-use-drizzle-schema-flow-and-effect-http.md).

Financial ledger engine selection is an infrastructure decision owned by
[ADR-0011](../decisions/0011-financial-ledger-engine.md), not by the orthogonal ledger domain
primitives. PostgreSQL remains the initial authoritative ledger store.

## Transaction Contract

A transaction context is explicit. Cross-domain operations that require atomic consistency
participate in the same PostgreSQL transaction through typed services.

No module may mutate another module's tables directly. Sharing a transaction does not transfer
semantic ownership; every invariant-sensitive mutation still passes through the owning domain's
public typed service.

## Composite Process Contract

Composite business processes such as Order-to-Cash and Procure-to-Pay coordinate public typed
services from their participating domain capabilities.

A process coordinator may sequence operations, carry the explicit transaction context for
synchronous atomic work, and define durable steps or compensation for asynchronous work. It must not
directly mutate participating domains' tables, duplicate their authoritative facts, redefine their
invariants, or become a super-domain that absorbs their ownership.

Process-specific state is permitted only when it represents coordination state that no participating
domain owns, such as durable progress, retry, or compensation status.

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

## HTTP Contract

HTTP routing is Effect-native. `HttpApi` owns endpoint schemas, errors, and OpenAPI metadata;
`HttpApiBuilder` and `HttpRouter` own server routing. `node:http` is used only through the
`@effect/platform-node` server adapter. `Deno.serve` and third-party routing frameworks are
forbidden.

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

The router owns navigation and validated URL state. It must not own business policy or backend
transaction behavior.

TanStack Query owns remote server state. Local Solid primitives own local view state. Shared Effect
Schema contracts validate route and API boundaries.

SolidStart and SSR are not enabled by default. Their adoption requires an explicit requirement and a
new or superseding ADR.

See [`./frontend.md`](./frontend.md) for detailed frontend rules.

## External Standards Contract

External standards such as UBL, ISO 20022, EPCIS, XBRL, and jurisdiction-specific reporting formats
must enter and leave through versioned adapters in `packages/integrations`.

An adapter must identify its standard, version, and profile or message type. It maps external
representations to public domain contracts and must not make external generated types part of a
domain's public API or use an external document schema as the internal persistence model.

Domain modules may adopt standard semantics, identifiers, and code lists. The domain that owns the
business fact remains authoritative. Detailed rationale is owned by
[ADR-0013](../decisions/0013-version-external-standard-adapters.md).

## External Identity Contract

Domain entities use internal identities that remain independent of identifiers assigned by tenants,
standards bodies, governments, suppliers, customers, or other external systems.

An external identifier must declare its scheme and uniqueness scope. Where relevant, its scope may
include issuer, tenant, jurisdiction, trading relationship, and validity period. It must not be used
as an internal primary key, and global uniqueness must not be assumed unless guaranteed by the
governing standard.

The domain that owns the identified entity owns identifier attachment, lifecycle policy, and
conflict translation. Detailed rationale is owned by
[ADR-0014](../decisions/0014-separate-internal-and-external-identifiers.md).

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
