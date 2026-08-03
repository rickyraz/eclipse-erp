# EclipseERP

**Orthogonal open-source ERP for dependable operations and predictable change.**

EclipseERP is an early-stage ERP platform built as a modular monolith with explicitly owned domain
modules. It aims to keep business change local, testable, and free from hidden side effects without
sacrificing transactional integrity, accounting correctness, auditability, extensibility, or
multi-tenant security.

> [!IMPORTANT]
> EclipseERP is in the architecture and early implementation phase. It is not production-ready.
> Canonical documents define the intended system while the application executables and frontend are
> still being built.

## Why EclipseERP

- **Local change:** domains interact through typed contracts instead of a global mutable model
  graph.
- **Dependable operations:** critical business invariants remain protected by explicit transactions
  and database constraints.
- **Predictable failures:** validation, business failures, and infrastructure failures remain typed
  and owned by the correct boundary.
- **Deliberate growth:** modules, projections, plugins, workflows, and native code are introduced
  only when their requirements justify the complexity.

## Architecture at a Glance

EclipseERP uses orthogonal domain modules inside one application family. The API, workers, event
relay, and migrator share domain packages and transaction boundaries rather than communicating
through premature internal microservices.

Core stack:

- TypeScript in strict mode with Effect on Deno;
- Drizzle ORM and pinned Drizzle Kit with PostgreSQL 19+;
- Vite and SolidJS 2.0 for the frontend SPA;
- Effect Schema for validated contracts;
- `@effect/vitest` for TypeScript tests;
- optional Zig kernels only after benchmark evidence.

## Developer Setup

Install npm dependencies through Deno:

```sh
deno install
```

Run the primary validation workflow:

```sh
deno task check
deno task skills:check
DATABASE_URL=postgres://... deno task db:check
deno task migrate
deno task test
deno task boundary:test
deno task boundary:lint
deno task test:contract
```

`deno task db:generate`, `db:check`, and `migrate` use the pinned Drizzle migration flow and
require `DATABASE_URL` (directly or through `.env` / `.env.local`). The PostgreSQL integration test
uses the same variable and is skipped when it is unavailable. Boundary tasks
also require the `ast-grep` CLI described in
[`tooling/boundary-linter/README.md`](./tooling/boundary-linter/README.md).

## Documentation

- [Documentation index](./docs/README.md)
- [Product vision](./docs/product/vision.md)
- [Architecture overview](./docs/architecture/overview.md)
- [Active architecture specification](./docs/architecture/architecture-spec-v4.md)
- [Architecture decisions](./docs/decisions/README.md)
- [Contributing](./CONTRIBUTING.md)
- [Repository rules](./AGENTS.md)

## License

Licensed under the [Apache License 2.0](./LICENSE).
