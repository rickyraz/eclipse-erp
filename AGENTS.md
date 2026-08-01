# AGENTS.md

This file defines how coding agents must work in the EclipseERP repository.

> **Related documents**
>
> - Project overview: [`./README.md`](./README.md)
> - Documentation index: [`./docs/README.md`](./docs/README.md)
> - Canonical architecture: [`./docs/architecture/architecture-spec-v4.md`](./docs/architecture/architecture-spec-v4.md)
> - Architecture decisions: [`./docs/decisions/README.md`](./docs/decisions/README.md)
> - Documentation workflow: [`./docs/development/documentation-workflow.md`](./docs/development/documentation-workflow.md)
> - Documentation ownership: [`./docs/documentation-boundaries.md`](./docs/documentation-boundaries.md)
> - Frontend architecture: [`./docs/architecture/frontend.md`](./docs/architecture/frontend.md)
> - Frontend SPA decision: [`./docs/decisions/0010-use-vite-solidjs-spa.md`](./docs/decisions/0010-use-vite-solidjs-spa.md)
> - Architecture enforcement: [`./docs/architecture/architecture-enforcement.md`](./docs/architecture/architecture-enforcement.md)
> - Testing strategy: [`./docs/development/testing.md`](./docs/development/testing.md)
> - Database roles: [`./docs/operations/database-roles.md`](./docs/operations/database-roles.md)

## Source-of-Truth Order

When documents conflict, use this order:

1. Accepted ADRs that explicitly supersede earlier decisions.
2. `docs/architecture/architecture-spec-v4.md`.
3. Other canonical architecture documents.
4. Reference and exploration documents.

Do not silently resolve contradictions. Report them and update the relevant
source of truth.

## Working Rules

- Inspect existing code and tests before introducing a new pattern.
- Make the smallest change that fully solves the task.
- Avoid unrelated refactoring.
- Preserve existing naming and directory conventions.
- Do not add dependencies without a documented reason.
- Do not weaken typing, validation, constraints, authorization, audit, or tests.
- Do not convert all failures into generic `Error` values.
- Do not assume an Effect fiber is durable.
- Do not treat Drizzle as the domain model.
- Do not activate Zig without benchmark evidence and a safe fallback.

## Documentation Boundaries

Before editing documentation, read `docs/documentation-boundaries.md`.
Do not duplicate canonical rules across several documents. Link to the owning
document and summarize only what is necessary for navigation or context.

## Frontend Rules

- Build `apps/web/` as a Vite-based SolidJS 2.0 SPA.
- Do not add SolidStart or SSR without an approved architectural decision.
- Use Solid Router by default.
- Keep router-specific types behind frontend routing abstractions.
- Use TanStack Solid Query for remote server state.
- Do not mirror query results into unrelated signals or global stores.
- Use TanStack Solid Table, Virtual, and Form for their specific concerns.
- Keep route loaders thin: parse input, invoke feature logic, and render.
- Validate API and route boundaries with Effect Schema.
- Do not import backend implementation modules, Drizzle tables, or repositories.
- Keep business policy and authorization enforcement in the backend.
- Preserve accessibility, keyboard navigation, and semantic HTML.

## Module Boundaries

A domain module may expose:

- commands and queries;
- Effect service interfaces;
- public tagged errors;
- DTOs through Effect Schema;
- production and test `Layer` values.

Table definitions, repositories, internal helpers, and implementation details
must remain private.

A module must not mutate another module's tables directly. Cross-module work must
use a typed service contract, including when both modules participate in the
same PostgreSQL transaction.

## Architecture Enforcement

- Import other domains only through their public package entry points.
- Never import another domain's table definitions or repositories.
- Keep the package dependency graph acyclic.
- Respect the schema ownership registry.
- Do not bypass a failing boundary check with an undocumented allowlist.
- Add public contract tests for exported module behavior.

## Database Rules

- PostgreSQL is the transactional source of truth.
- Critical invariants require transactions and database constraints.
- Migrations are versioned, reviewed SQL.
- Drizzle Kit may generate or check migrations but is not authoritative.
- Use reviewed SQL for RLS, locking, deferred constraints, partitioning,
  `ltree`, SQL/PGQ, and unsupported PostgreSQL features.
- Never rewrite an applied migration. Add a new migration.

## Asynchronous Rules

- Use a direct transaction for synchronous business invariants.
- Use PgQue for committed facts and fan-out.
- Use a job table for leased, scheduled, prioritized single-consumer work.
- Use `pg_durable` only after compatibility and production gates pass.
- Make consumers and workflow steps idempotent.
- Do not dual-write to PostgreSQL and an external broker.

## Authorization and Security

- Deny by default.
- Keep authentication separate from authorization.
- Model permissions as business capabilities, not only CRUD.
- Make scopes explicit and tenant-aware.
- Use PostgreSQL RLS as defense in depth, not as the only policy engine.
- Never commit secrets or log credentials and sensitive data.
- Never accept arbitrary tenant SQL or arbitrary policy scripts.

## Web Research

For discovering information on the public web, ALWAYS prefer the
provider-native web search capability when available.

Do NOT use `ax`, `curl`, `wget`, or shell commands to query search engines
such as Google, Bing, Brave Search, or DuckDuckGo.

Use `ax` only after an exact URL is already known.

Preferred workflow:

1. Use native web search to discover relevant sources.
2. Prefer primary and authoritative sources.
3. Once an exact URL is known, use `ax <url>` when the full page needs inspection.
4. Use local read/edit/bash tools only for repository work.

Examples:

Incorrect:

    ax 'https://search.brave.com/search?q=...'
    ax 'https://www.google.com/search?q=...'
    ax 'https://www.bing.com/search?q=...'

Correct:

    native web search
    → discover https://docs.example.com/foo
    → ax https://docs.example.com/foo

## Documentation Rules

Update documentation when changing:

- public contracts;
- module boundaries;
- data ownership;
- transaction or consistency models;
- asynchronous semantics;
- authorization;
- deployment or configuration;
- extension boundaries.

Create a new ADR for significant decisions. Do not rewrite the history of an
accepted ADR.

## Validation

Replace these placeholders after repository commands are finalized:

```sh
<format-command>
<lint-command>
<typecheck-command>
<test-command>
<build-command>
```

If a command cannot run, report the command, the reason, and what remains
unverified.

## Completion Report

Summarize:

1. what changed;
2. why it changed;
3. validation performed;
4. documentation or ADR changes;
5. remaining risks and assumptions.
