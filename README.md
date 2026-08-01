# EclipseERP

EclipseERP is a modular-monolith ERP architecture centered on PostgreSQL as the
transactional source of truth and TypeScript with Effect on Deno as the
application runtime.

> **Related documents**
>
> - Repository rules: [`./AGENTS.md`](./AGENTS.md)
> - Documentation index: [`./docs/README.md`](./docs/README.md)
> - Architecture overview: [`./docs/architecture/overview.md`](./docs/architecture/overview.md)
> - Active architecture specification: [`./docs/architecture/architecture-spec-v4.md`](./docs/architecture/architecture-spec-v4.md)
> - Architecture decisions: [`./docs/decisions/README.md`](./docs/decisions/README.md)
> - Documentation ownership: [`./docs/documentation-boundaries.md`](./docs/documentation-boundaries.md)

## Status

The project is in the architecture and early implementation phase. Documents
marked **canonical** define the current design. Reference documents explain
alternatives and reasoning but do not automatically define implementation.

## Active Stack

- TypeScript in strict mode
- Effect
- Deno
- `@effect/platform`
- Drizzle ORM and `postgres.js`
- PostgreSQL 19 as the development floor
- Vite with SolidJS 2.0 for the frontend SPA
- TanStack Solid Query, Table, Virtual, and Form
- Effect Schema for shared contracts and Kobalte for accessible UI primitives
- Optional Zig through `Deno.dlopen`, enabled only after benchmarking

## Core Principles

- Start with a modular monolith.
- Keep domain ownership explicit.
- Preserve core invariants inside PostgreSQL transactions.
- Use typed contracts between modules.
- Represent business failures as tagged errors.
- Choose asynchronous primitives by semantics.
- Require evidence before adding projections, distribution, or native code.
- Record significant architecture decisions as ADRs.
