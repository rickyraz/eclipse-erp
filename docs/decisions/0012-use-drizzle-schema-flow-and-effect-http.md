# ADR-0012: Use the Drizzle schema flow and Effect-native HTTP

- Status: Accepted
- Date: 2026-08-01
- Supersedes: The migration and HTTP-adapter portions of ADR-0002
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Runtime architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - Architecture enforcement: [`../architecture/architecture-enforcement.md`](../architecture/architecture-enforcement.md)

## Context

The initial scaffold rendered Drizzle SQL manually and used `Deno.serve` with
hand-written request routing. Migrations could be recognized by Drizzle's
runtime migrator but were not required to belong to a Drizzle Kit snapshot
graph.

That left three avoidable gaps:

- query result types could drift from persistence schemas;
- HTTP contracts, routing, validation, OpenAPI, and handlers had separate
  definitions;
- manually added migration folders could bypass Drizzle Kit's graph metadata.

## Decision

### Persistence

Use `db/schema/index.ts` as the Drizzle Kit schema entry point. Shared schema
primitives live in `db/schema/common.ts`:

- PostgreSQL `uuidv7()` identifiers;
- `created_at` and `updated_at` timestamps;
- `numeric(14,2)` money values.

The kernel owns the `postgres.js` client, Drizzle database lifecycle,
transactions, and stable `DatabaseFailure` mapping. A domain implementation may
use Drizzle query builders only with its owned tables. Public domain contracts
must not expose Drizzle table or query types.

### Migrations

Every migration must be created by the pinned Drizzle Kit `1.0.0-rc.4` flow.
Each migration directory contains both `migration.sql` and `snapshot.json`.
Unsupported PostgreSQL objects such as deferred accounting triggers use
`drizzle-kit generate --custom` and remain reviewed SQL inside the same graph.

Migration SQL must include ownership, review-date, and generator headers. CI
runs `drizzle-kit check` and repository ownership validation.

### HTTP

HTTP contracts and routing use Effect v4 `HttpApi`, `HttpApiGroup`,
`HttpApiEndpoint`, and `HttpApiBuilder`. Authentication uses Effect HttpApi
security middleware. OpenAPI and Scalar documentation derive from the same API
contract.

`@effect/platform-node` adapts Effect's HTTP server to `node:http`. The Node
server is an adapter only; application routing must not use `node:http`,
`Deno.serve`, Hono, Express, Fastify, or NestJS.

Effect v4 error handling uses `Effect.catch`, `Effect.catchCause`, or
`Effect.mapError`; v3 `catchAll` names are forbidden.

## Consequences

- Query construction and selected result fields are checked against Drizzle
  table definitions.
- Schema changes and migration history become one reviewable graph.
- PostgreSQL-specific invariants remain possible through custom Drizzle
  migrations.
- API schemas drive request decoding, response encoding, generated OpenAPI, and
  server routing.
- Domain implementations depend on the kernel database capability and their own
  persistence tables, while public domain contracts remain engine-independent.
- Running Drizzle Kit requires `DATABASE_URL`, loaded from `.env`, `.env.local`,
  or the process environment.

## Validation

- `deno task db:check` validates the Drizzle migration graph.
- Ownership tooling rejects migrations without Drizzle snapshots and review
  headers.
- Architecture tests reject non-Effect HTTP routing.
- Type checking covers every schema, service, handler, and endpoint contract.
