# EclipseERP

**Orthogonal open-source ERP for predictable change and extensible operations.**

EclipseERP is an early-stage ERP platform built as an orthogonal modular monolith with explicitly owned domain boundaries.

It is designed to keep business change local, testable, and predictable without sacrificing transactional integrity, accounting correctness, auditability, extensibility, or multi-tenant security.

> [!IMPORTANT]
> EclipseERP is currently in the architecture and early implementation phase. It is not production-ready.
>
> Canonical architecture documents define the intended system while application runtimes, frontend infrastructure, plugin execution, and higher-level orchestration capabilities are still being implemented.

## Why EclipseERP

* **Local change:** domains interact through typed public contracts instead of sharing a shared mutable model graph.
* **Explicit ownership:** each domain owns its state, invariants, persistence rules, and internal implementation.
* **Dependable operations:** critical business invariants are protected through explicit transactions, constraints, and domain-owned mutation paths.
* **Predictable failures:** validation, business, authorization, and infrastructure failures remain typed and owned by the appropriate boundary.
* **Controlled extensibility:** plugins and integrations are designed to contribute capabilities through explicit contracts rather than redefining core domain models.
* **Composable processes:** released actions and events are designed to support cross-domain orchestration without moving business invariants into the workflow layer.
* **Deliberate complexity:** projections, plugins, workflows, distributed components, and native code are introduced only when concrete requirements justify them.

## Architecture at a Glance

EclipseERP organizes business capabilities as orthogonal domain modules within a single application family.

The API, workers, event relay, and migrator share domain packages and transactional boundaries rather than communicating through premature internal microservices.

```text
Domain ownership
      ↓
Public commands / queries / events
      ↓
Typed contracts
      ↓
Applications and integrations
      ↓
Process orchestration
```

Core domains retain ownership of their business invariants regardless of how they are invoked or composed.

### Core Stack

* Deno runtime;
* TypeScript in strict mode;
* Effect for application services and typed failures;
* PostgreSQL 19+ as the authoritative transactional store;
* Drizzle ORM with a pinned Drizzle Kit migration workflow;
* Effect Schema for validated contracts;
* Vite and SolidJS 2.0 for the frontend;
* `@effect/vitest` for TypeScript testing;
* optional Zig kernels only when benchmark evidence justifies native computation.

## Developer Setup

Install dependencies through Deno:

```sh
deno install
```

If Deno temporarily rejects newly published dependencies because of the minimum dependency age policy, use:

```sh
deno install --minimum-dependency-age=0
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

`deno task db:generate`, `deno task db:check`, and `deno task migrate` use the pinned Drizzle migration workflow and require `DATABASE_URL`, either directly or through `.env` / `.env.local`.

PostgreSQL integration tests are skipped only when `DATABASE_URL` is unset. If `DATABASE_URL` is configured but the database is unreachable or invalid, the tests fail.

Boundary validation also requires the `ast-grep` CLI documented in [`tooling/boundary-linter/README.md`](./tooling/boundary-linter/README.md).

## Documentation

* [Documentation index](./docs/README.md)
* [Product vision](./docs/product/vision.md)
* [Architecture overview](./docs/architecture/overview.md)
* [Active architecture specification](./docs/architecture/architecture-spec-v4.md)
* [Architecture decisions](./docs/decisions/README.md)
* [Contributing](./CONTRIBUTING.md)
* [Repository rules](./AGENTS.md)

## License

Licensed under the [Apache License 2.0](./LICENSE).
