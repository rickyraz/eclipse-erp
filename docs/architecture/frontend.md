# Frontend Architecture

> **Status:** Canonical and active
>
> **Owns:** Frontend runtime shape, framework selection, routing boundaries,
> server-state handling, data-heavy UI primitives, contract validation, and
> presentation-layer constraints.
>
> **Related documents**
>
> - Active architecture: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - SolidJS decision: [`../decisions/0009-use-solidjs-2.md`](../decisions/0009-use-solidjs-2.md)
> - SPA architecture decision: [`../decisions/0010-use-vite-solidjs-spa.md`](../decisions/0010-use-vite-solidjs-spa.md)
> - Authorization architecture: [`./authorization.md`](./authorization.md)
> - Architecture enforcement: [`./architecture-enforcement.md`](./architecture-enforcement.md)
> - Testing strategy: [`../development/testing.md`](../development/testing.md)
> - Documentation ownership: [`../documentation-boundaries.md`](../documentation-boundaries.md)

## Decision

EclipseERP uses an API-first frontend with a separately deployed backend:

```text
Vite
└── SolidJS 2.0 SPA
    ├── Router
    ├── TanStack Solid Query
    ├── TanStack Solid Table
    ├── TanStack Solid Virtual
    ├── TanStack Solid Form
    ├── Effect Schema
    └── Kobalte and the internal UI system
```

SolidStart is not the default application foundation.

It may be introduced only when server rendering, a frontend-owned BFF,
server-session management, server functions, or unified full-stack deployment
becomes an explicit requirement.

## Why an SPA Fits EclipseERP

EclipseERP is an authenticated, long-lived, interaction-heavy application.

Its primary screens include:

```text
/accounting/journals
/inventory/stock-movements
/sales/invoices
/procurement/purchase-orders
/settings/users
```

These screens depend more on:

- persistent application state;
- complex forms;
- tables and virtualization;
- permission-aware actions;
- URL-driven filters;
- interactive dashboards;
- a separate transactional backend;

than on SEO or public first-page rendering.

The browser therefore behaves more like an application shell than a public
content website.

```text
Browser
  |
  |-- application shell
  |-- router and URL state
  |-- server-state cache
  |-- table and virtualization state
  |-- form state
  `-- session state
  |
  v
EclipseERP Backend API
  |
  v
PostgreSQL
```

## Stack

| Concern | Decision |
|---|---|
| UI framework | SolidJS 2.0 |
| Build tool | Vite |
| Application shape | Client-side SPA |
| Router | Solid Router by default, or TanStack Solid Router behind an adapter |
| Server state | TanStack Solid Query |
| Tables | TanStack Solid Table |
| Virtualization | TanStack Solid Virtual |
| Forms | TanStack Solid Form |
| Runtime validation | Effect Schema |
| Accessible UI primitives | Kobalte |
| Backend | Separate Effect-on-Deno API |
| Transactional database | PostgreSQL |

The frontend must not introduce its own business backend through route loaders,
server functions, or hidden server handlers.

## Deployment Boundary

The frontend is a separate application:

```text
apps/web/
```

It communicates with the backend through an explicit public transport contract,
such as HTTPS with JSON or another approved RPC encoding.

```text
SolidJS ERP SPA
  |
  | HTTPS / JSON / approved RPC
  v
EclipseERP API
  |
  | authentication
  | authorization
  | accounting
  | inventory
  | procurement
  | sales
  | transactions
  | audit
  | idempotency
  v
PostgreSQL
```

The browser must not connect directly to PostgreSQL, PgQue, internal workers, or
private backend module endpoints.

## Dependency Direction

Allowed:

```text
apps/web
  -> shared public contracts
  -> frontend feature packages
  -> frontend infrastructure
  -> public backend API
```

Forbidden:

```text
apps/web
  -X-> backend repositories
  -X-> Drizzle table definitions
  -X-> PostgreSQL transaction services
  -X-> backend-only Effect Layers
  -X-> internal worker or relay code
```

Shared public contracts must remain independent of SolidJS, Drizzle, and backend
implementation details.

## Router Decision

### Default: Solid Router

Prefer Solid Router when the application benefits from:

- the most direct Solid integration;
- standard web primitives such as links and forms;
- a smaller framework-specific surface;
- alignment with SolidJS core primitives;
- optional future server capabilities without making them foundational.

### Alternative: TanStack Solid Router

TanStack Solid Router may be selected when typed URL state is a dominant
requirement, especially for screens with complex filtering and navigation.

Example:

```text
/invoices
  ?companyId=12
  &branchId=8
  &status=OVERDUE
  &dateFrom=2026-01-01
  &dateTo=2026-07-31
  &sort=dueDate.desc
  &page=4
```

If TanStack Solid Router is used, domain and query code must not depend directly
on router-specific types throughout the codebase.

## Router Abstraction

Feature modules own typed search models independently from the router.

```ts
export type InvoiceListSearch = {
  readonly companyId?: string
  readonly branchId?: string
  readonly status?: "DRAFT" | "POSTED" | "PAID" | "OVERDUE"
  readonly dateFrom?: string
  readonly dateTo?: string
  readonly sort?: string
  readonly page: number
  readonly pageSize: number
}
```

Search input must be decoded through a schema before it reaches feature queries.

The route layer should only:

```text
parse route and search input
-> invoke feature query or command
-> render feature UI
```

It must not own:

```text
business validation
authorization policy
query construction details
mutation semantics
accounting rules
inventory invariants
```

## Server-State Ownership

TanStack Solid Query owns remote server state.

Use it for:

- loading;
- caching;
- invalidation;
- background refresh;
- pagination;
- optimistic coordination where safe;
- mutation lifecycle;
- stale-state policy.

Do not copy query results into unrelated signals or global stores merely to make
them reactive.

A feature should expose reusable query options rather than constructing ad hoc
request behavior inside route components.

```ts
export const invoiceQueries = {
  list: (input: InvoiceListInput) => ({
    queryKey: ["invoices", input] as const,
    queryFn: () => invoiceApi.list(input),
  }),

  detail: (invoiceId: string) => ({
    queryKey: ["invoices", invoiceId] as const,
    queryFn: () => invoiceApi.getById(invoiceId),
  }),
}
```

Query keys must be:

- deterministic;
- tenant-aware where required;
- scope-aware where required;
- based on validated input;
- stable across components.

## Local Reactive State

Use Solid primitives according to ownership:

- signals for small local mutable state;
- memos for derived state;
- stores for structured local state that benefits from granular updates;
- context for stable dependency distribution;
- TanStack Query for remote server state;
- URL search parameters for shareable list and filter state.

Context must not become a global mutable service locator.

## Table Architecture

TanStack Solid Table owns table behavior, not domain policy.

Table definitions may contain:

- column descriptions;
- display formatting;
- sorting metadata;
- filtering metadata;
- row selection behavior;
- presentation actions.

They must not contain:

- permission decisions that are not enforced by the backend;
- accounting calculations;
- inventory mutations;
- raw API calls hidden in cell renderers;
- direct persistence-model dependencies.

For large datasets, use server-side pagination, filtering, and sorting.
Client-side processing is limited to bounded datasets.

## Virtualization

Use TanStack Solid Virtual when row or column rendering becomes expensive.

Virtualization must preserve:

- keyboard navigation;
- focus behavior;
- accessible labels;
- selection state;
- stable row identity;
- scroll restoration where required.

Do not virtualize small tables without measurement.

## Forms

TanStack Solid Form manages client form state and interaction.

Effect Schema remains the contract and decoding boundary.

A form layer may provide:

- field state;
- touched and dirty tracking;
- client-side feedback;
- submission coordination;
- mapping of typed backend failures.

The backend remains authoritative for:

- business validation;
- authorization;
- uniqueness;
- concurrency;
- transaction invariants.

Client validation improves feedback but never replaces server validation.

## Contract Validation

All data entering the frontend from an API, browser storage, plugin boundary,
file import, or third-party integration is untrusted.

Use shared Effect Schema contracts to:

- decode request and response payloads;
- reject invalid data;
- version public contracts;
- preserve tagged business failures;
- normalize transport-specific representations;
- decode typed route search input.

Frontend code must not reuse backend implementation types when a public contract
should exist.

## Feature Structure

Organize the frontend by business capability rather than generic technical type.

```text
apps/web/src/
├── app/
│   ├── providers/
│   ├── router/
│   └── shell/
├── routes/
├── features/
│   ├── accounting/
│   │   ├── api/
│   │   ├── contracts/
│   │   ├── forms/
│   │   ├── queries/
│   │   ├── tables/
│   │   └── ui/
│   ├── inventory/
│   ├── procurement/
│   ├── sales/
│   └── authorization/
└── shared/
    ├── contracts/
    ├── infrastructure/
    ├── routing/
    └── ui/
```

Avoid global directories where unrelated behavior accumulates inside generic
hooks, services, stores, or utility files.

## Domain Logic

Presentation components may:

- render state;
- collect user input;
- invoke feature-level commands;
- display typed failures;
- coordinate view behavior.

Presentation components must not own:

- accounting policy;
- authorization policy;
- transaction semantics;
- inventory invariants;
- pricing policy;
- workflow durability;
- idempotency rules.

These belong to the backend domain or explicit shared contracts.

## Authorization UX

The frontend may hide or disable controls based on capabilities returned by the
backend.

This behavior is only UX.

The backend must enforce every protected command and query. Hidden controls,
route guards, and disabled buttons are not security boundaries.

## Error Model

The UI must distinguish:

```text
validation failure
authorization denial
business conflict
concurrency conflict
not found
network or transport failure
unexpected defect
```

Do not reduce all failures to a generic toast.

Feature modules should map public tagged errors to specific recovery actions and
user-facing messages.

## SolidStart Exception Gate

SolidStart may be adopted only if several of these requirements become central:

- frontend and backend move into one runtime and deployment unit;
- frontend-owned server sessions are required;
- a BFF becomes a primary boundary;
- SSR materially benefits authenticated workflows;
- server functions become a primary application interface;
- server-side file handling or report generation belongs to the frontend app;
- the team explicitly chooses convention over a manually assembled Vite stack.

Even then, backend domain ownership must remain separate from UI routing.

SolidStart is a packaging and integration choice, not the owner of ERP business
logic.

## SSR Policy

SSR is not required by default.

A proposal to add SSR must identify:

- the route or workflow;
- the measurable user benefit;
- authentication and cache behavior;
- deployment cost;
- operational ownership;
- why client rendering is insufficient.

Do not enable SSR globally for speculative performance or SEO benefits that do
not apply to authenticated ERP screens.

## Accessibility

Core workflows must support:

- semantic HTML;
- keyboard navigation;
- visible focus;
- meaningful labels;
- accessible validation feedback;
- reduced-motion preferences where relevant;
- screen-reader-compatible tables and forms.

Kobalte may provide accessible primitives, but feature composition must still be
tested.

## Performance

Optimize from measurements.

Prioritize:

1. stable query keys and bounded cache policy;
2. server-side filtering and pagination;
3. SolidJS fine-grained reactivity;
4. memoized derived state;
5. table virtualization when measured;
6. code splitting by route or feature;
7. payload and contract-size control.

Do not introduce broad global stores, speculative prefetching, or duplicated
client projections without evidence.

## Testing

Frontend changes should use the smallest useful combination of:

- unit tests for pure transformations;
- schema tests for route and API decoding;
- component tests for interaction;
- query tests for cache and invalidation behavior;
- accessibility tests;
- integration tests for feature flows;
- end-to-end tests for critical ERP workflows.

Tests should assert user-visible behavior and public contracts rather than
internal signal or memo implementation details.

## Completion Criteria

The frontend architecture is correctly implemented when:

- `apps/web/` builds as a Vite-based SolidJS 2.0 SPA;
- the backend remains separately deployable;
- no frontend code imports backend internals;
- remote state uses TanStack Solid Query;
- complex table and form behavior uses explicit feature abstractions;
- route search input is typed and validated;
- router-specific types do not leak into domain contracts;
- authorization remains enforced by the backend;
- SolidStart and SSR are absent unless an approved requirement activates them.
