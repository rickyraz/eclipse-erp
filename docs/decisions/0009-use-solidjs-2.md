# ADR-0009: Use SolidJS 2.0 for the Frontend

- Status: Accepted
- Date: 2026-08-01
- Supersedes: The earlier React frontend selection
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Frontend architecture: [`../architecture/frontend.md`](../architecture/frontend.md)
> - Canonical architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
- SPA application-shape decision: [`./0010-use-vite-solidjs-spa.md`](./0010-use-vite-solidjs-spa.md)

## Context

EclipseERP needs a typed frontend with predictable fine-grained reactivity,
clear feature boundaries, and low accidental recomputation. The previous
architecture summary selected React but did not establish a dedicated frontend
architecture.

## Decision

Use TypeScript strict with SolidJS 2.0 for the EclipseERP frontend. Shared public
contracts use Effect Schema. SolidJS-specific implementation rules are owned by
`../architecture/frontend.md`.

## Alternatives Considered

### React

React was the previous selection. It is no longer the active frontend framework
for EclipseERP.

### Framework-Agnostic Frontend

Rejected because the repository needs concrete implementation and agent rules.

## Consequences

### Positive

- Fine-grained reactivity is the default rendering model.
- Derived UI state can remain local and explicit.
- The selected framework now has one canonical architecture document.

### Negative

- The team must follow SolidJS-specific reactive ownership rules.
- React-specific libraries and patterns cannot be adopted without adaptation.

### Risks

- Treating Solid primitives as generic global state can still create coupling.
- Framework-specific code may leak into public contracts without discipline.

## Validation

- No active architecture document selects React.
- Frontend implementation lives under `apps/web/`.
- Shared contracts remain independent of SolidJS internals.
- Critical UI flows receive behavioral and contract tests.
