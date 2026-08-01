# ADR-0002: Use Effect, Deno, and Drizzle

- Status: Accepted
- Date: 2026-08-01
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)

## Context

The application needs typed failures, lifecycle management, concurrency,
dependency injection, schema validation, and typed PostgreSQL access.

## Decision

Use TypeScript strict with Effect on Deno. Use `@effect/platform` for HTTP,
Effect Schema for contracts, Drizzle ORM for typed schema and queries, and
`postgres.js` for connectivity.

## Consequences

Effect is not a durable workflow engine. Drizzle is not the domain model and
must not hide PostgreSQL-specific capabilities.

## Validation

Public services expose typed environment and failure channels. Reviewed SQL is
used when PostgreSQL capability exceeds Drizzle's model.
