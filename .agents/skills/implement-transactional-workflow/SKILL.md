---
name: implement-transactional-workflow
description: "Use for invariant-sensitive writes such as stock reservations, journal posting, balance or quota changes, idempotent multi-write commands, or when deciding between a direct transaction, event, job, and durable workflow."
---

# Purpose

Implement business mutations with the smallest durability primitive that preserves atomicity, ownership, idempotency, and database invariants.

# Use This Skill When

- changing balances, stock, journal entries, fiscal state, quotas, or idempotency keys;
- several writes must commit or roll back together;
- coordinating more than one domain;
- deciding whether work belongs in a transaction, PgQue event, job table, or durable workflow.

# Do Not Use This Skill When

- the operation is a pure query or local deterministic calculation;
- a normal single-row write has no concurrency or invariant risk;
- using an Effect fiber is proposed as durable execution.

# Required Context

Inspect the owning service, tables and constraints, kernel transaction API, public failure model, authorization requirement, and existing invariant tests. Read the constraint-validation strategy before designing relational or concurrency-sensitive validation.

# Architecture Rules

- Direct PostgreSQL transaction: invariant required before success.
- PgQue: committed fact and fan-out.
- Job table: leased, scheduled, prioritized single-consumer work.
- `pg_durable`: checkpointed workflow only after compatibility and production gates.
- Every mutation still passes through its semantic owner.
- Database constraints are final correctness; application validation improves usability.
- Consumers and retries are idempotent; external delivery uses an outbox instead of unsafe dual-write.

# Workflow

## 1. Inspect

Trace all writes and callers. Identify the invariant owner, lock/ordering needs, database constraints, duplicate/retry behavior, side effects, and public failure expectations.

## 2. Decide

Choose the first primitive that satisfies the semantics:

1. one atomic transaction for synchronous invariants;
2. transactional event publication for committed facts;
3. job table for one durable worker;
4. approved checkpointed workflow for resumable multi-step work.

Within a transaction, prefer an atomic conditional update when “did not happen” is sufficient; use lock-then-validate when the caller needs a precise state-dependent failure.

## 3. Implement

Use `DatabaseService.transaction` for owner-local multi-write changes. Add constraints and map their specific names to tagged domain errors. Keep authorization before the protected mutation and event/outbox publication inside the same transaction when implemented.

For cross-domain atomicity, call transaction-aware public services. The general shared transaction context described by the architecture is not yet paved in this repository; never replace it with direct cross-domain table access.

## 4. Validate

Test success, rollback, constraint failure, duplicate/idempotent execution, and concurrency behavior. Add a real PostgreSQL test for guarantees that an in-memory layer cannot prove.

# Deterministic Tools

```sh
deno task test:contract
deno task test
deno task db:check
deno task boundary:lint
deno task check
```

When `DATABASE_URL` is available, run the focused PostgreSQL invariant test and clean-database migration test.

# Required Checks

- all invariant writes are inside one transaction;
- constraints protect the final state;
- known constraint failures map to stable domain errors;
- rollback is tested after an intermediate failure;
- duplicate/retry behavior is explicit;
- no side effect can be lost between commit and publication;
- no module writes another module’s tables.

# Failure Conditions

Stop when lock ordering is undefined, idempotency is missing for retryable work, cross-domain transaction infrastructure is absent, a worker/event implementation would be invented without a paved road, or an external dual-write is proposed.

# Completion Criteria

The selected durability primitive matches the business semantics; ownership and atomicity are preserved; failure and retry behavior are explicit; contract, database, boundary, and type checks pass.

# Related Skills

- [`change-owned-schema`](../change-owned-schema/SKILL.md)
- [`introduce-cross-domain-integration`](../introduce-cross-domain-integration/SKILL.md)
- [`add-authorization-capability`](../add-authorization-capability/SKILL.md)
- [`constraint-validation-strategy`](../constraint-validation-strategy/SKILL.md)

# References

- [Transaction and asynchronous contracts](../../../docs/architecture/architecture-spec-v4.md)
- [Durable execution](../../../docs/architecture/durable-execution.md)
- [PgQue messaging](../../../docs/architecture/pgque-messaging.md)
- [PostgreSQL architecture](../../../docs/architecture/postgresql-19-architecture.md)
- [Inventory atomic reservation example](../../../packages/inventory/src/service.ts)
- [Accounting invariant example](../../../packages/accounting/src/service.ts)
