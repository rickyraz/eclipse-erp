# RITSEI

## Run your business. Design how it runs.

RITSEI is an open-source enterprise business platform for running company
operations while designing how business processes work.

It combines:

- enterprise business applications;
- visual business-process design;
- workflow orchestration;
- plugin architecture;
- integrations;
- explicit business rules and invariants;
- event-driven automation; and
- extensible domain capabilities.

RITSEI is not only an ERP and not only a workflow builder. It gives companies
complete business capabilities while letting them decide how those
capabilities operate together.

> **Businesses should not be forced to follow the limitations of their
> software. Software should represent how a business actually works.**

## Order, by Design.

RITSEI is a coined name inspired by the concepts of governing principles and
structured order. It is not claimed to be a literal Japanese word or compound.
Its product meaning is simple:

> **Order governed by correctness.**

Business complexity is unavoidable. Accidental complexity is not. RITSEI makes
state, ownership, transitions, rules, authorization, and process behavior
explicit, structured, verifiable, and controllable.

## Three pillars

### Business applications

Finance, accounting, sales, procurement, inventory, manufacturing, CRM,
projects, commerce, and operations provide a batteries-included enterprise
foundation.

### Process Studio

RITSEI Process Studio lets teams model approvals, conditions, human tasks,
timers, events, integrations, subprocesses, compensation, and automation as
governed executable processes—not merely diagrams.

### Platform and plugins

Stable contracts form the core. Plugins, APIs, events, integrations, custom
modules, permissions, and industry capabilities extend the edges without
turning the core into an unmaintainable fork.

Customization may extend behavior, but it must not invalidate business truth:

- accounting journals remain balanced;
- inventory workflows preserve stock invariants; and
- extensions remain inside authorization boundaries.

## Engineering principles

- explicit state and ownership;
- explicit invariants;
- deterministic transitions;
- server-side authority;
- auditability;
- composable capabilities;
- open integration standards; and
- durable business processes.

## Developer setup

Install dependencies through Deno:

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

`deno task db:generate`, `deno task db:check`, and `deno task migrate` use the
pinned Drizzle migration workflow and require `DATABASE_URL`, either directly
or through `.env` / `.env.local`.

PostgreSQL integration tests are skipped only when `DATABASE_URL` is unset. If
it is configured but the database is unreachable or invalid, the tests fail.

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
