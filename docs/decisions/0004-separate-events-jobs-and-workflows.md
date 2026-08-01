# ADR-0004: Separate Events, Jobs, and Workflows

- Status: Accepted
- Date: 2026-08-01
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)

## Context

Committed facts, single-consumer tasks, and checkpointed multi-step processes
have different semantics.

## Decision

Use PgQue for committed events, a job table for leased work, `pg_durable` for
checkpointed workflows after approval, and direct transactions for synchronous
business invariants.

## Consequences

The system avoids pretending that one queue primitive solves every background
task. Consumers and workflow steps must be idempotent.

## Validation

Test retries, duplicate delivery, crash recovery, timeout behavior, and
dead-letter handling.
