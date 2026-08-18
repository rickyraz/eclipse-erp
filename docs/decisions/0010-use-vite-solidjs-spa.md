# ADR-0010: Use a Vite-Based SolidJS SPA

- Status: Accepted
- Date: 2026-08-01
- Supersedes: The earlier assumption that SolidStart should be the default frontend foundation
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - SolidJS decision: [`./0009-use-solidjs-2.md`](./0009-use-solidjs-2.md)
> - Contract schema decision: [`./0024-adopt-effect-schema-as-canonical-contract-schema.md`](./0024-adopt-effect-schema-as-canonical-contract-schema.md)
> - Frontend architecture: [`../architecture/frontend.md`](../architecture/frontend.md)
> - Active architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)

## Context

RITSEI has a separate transactional backend and an authenticated,
interaction-heavy frontend. Its primary workflows use tables, forms, filters,
permissions, dashboards, and long-lived sessions.

Public SEO and content-first rendering are not core requirements.

Making SolidStart the default would introduce server functions, SSR conventions,
request handlers, deployment adapters, and full-stack primitives that overlap
with responsibilities already owned by the RITSEI backend.

SolidJS 2.0 also moves more capability into lower-level Solid, router, compiler,
and Vite primitives. The architecture should depend on those primitives rather
than making a meta-framework the center of the system.

## Decision

Use:

```text
Vite
+ SolidJS 2.0 SPA
+ router abstraction
+ TanStack Solid Query
+ TanStack Solid Table
+ TanStack Solid Virtual
+ TanStack Solid Form
+ Effect Schema
+ Kobalte
```

The backend remains a separate application and deployment unit.

### Schema boundary clarification

The frontend does not maintain a parallel canonical Valibot or Zod schema for
shared contracts. It imports shared Effect Schema contracts for API, route,
storage, import, plugin, and third-party boundaries, and adapts them to
TanStack Solid Form with the Effect v4 `Schema.toStandardSchemaV1` adapter.

TanStack Solid Form owns field state, validation timing, debouncing, submission,
and user-facing feedback. SolidJS 2.0 owns async reactivity and pending UI.
Schemas remain framework-independent and must not import Solid or router
internals. A UI-only validator is an exception for presentation-local rules
only; it must not duplicate domain or integration invariants and requires
measured bundle justification.

Solid Router is the default router. TanStack Solid Router may be selected when
typed URL and search-state requirements dominate, but router-specific APIs must
remain behind a thin frontend abstraction.

SolidStart and SSR are optional and require a separate approved architectural
change based on concrete BFF, server-session, SSR, or unified-deployment needs.

## Alternatives Considered

### SolidStart as the Default

Rejected as the default because RITSEI already has a separate backend and
does not currently require SSR, server functions, or frontend-owned server
routing.

### Framework-Agnostic SPA

Rejected because the repository needs concrete implementation rules and stable
agent guidance.

### TanStack Solid Router Everywhere

Not selected as a mandatory global dependency. It remains an option for
URL-intensive workflows, provided router types do not become domain contracts.

## Consequences

### Positive

- The frontend and backend remain independently deployable.
- ERP business logic stays in the backend domain.
- The application uses lower-level Solid and Vite primitives.
- Server state, tables, forms, and virtualization have explicit owners.
- Router replacement remains possible.

### Negative

- The team must assemble and maintain the Vite integration explicitly.
- Server-rendering features are not available by default.
- Router abstraction adds a small amount of frontend infrastructure.

### Risks

- Route loaders may accumulate business logic.
- TanStack libraries may become accidental domain frameworks.
- Query cache state may be duplicated into local stores.
- SolidStart may be introduced later without a clear requirement.

## Validation

- `apps/web/` builds as a Vite SPA.
- No default SolidStart dependency exists.
- No frontend route owns backend business policy.
- Server state uses TanStack Solid Query.
- Search parameters are decoded through shared Effect Schema contracts.
- Shared API and route boundaries do not use a parallel canonical validator.
- Router-specific types do not leak into public domain contracts.
- SSR or SolidStart adoption requires a new or superseding ADR.
