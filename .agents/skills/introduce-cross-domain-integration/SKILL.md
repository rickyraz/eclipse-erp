---
name: introduce-cross-domain-integration
description: "Use when one EclipseERP domain must consume another domain’s data or behavior, such as letting accounting consume finalized sales invoices, or when an implementation would otherwise import another package’s src files or tables."
---

# Purpose

Connect domains through explicit public contracts while preserving semantic ownership, transaction rules, and an acyclic package graph.

# Use This Skill When

- one package needs a fact or operation owned by another;
- a request says “let A use/consume/read B”;
- code is about to import another package’s `src/`, repository, or schema;
- a composite process coordinates several capabilities.

# Do Not Use This Skill When

- the behavior belongs entirely inside one owner;
- asynchronous fan-out is requested but no event/job paved road exists yet;
- a shared utility with no domain ownership is the actual need.

# Required Context

Inspect both packages’ `mod.ts` files, service contracts, current dependency paths, schema ownership, and the composite-process transaction requirement. Run the dependency checker before designing a new edge.

# Architecture Rules

- The owning domain remains the only mutation authority for its invariant.
- Consumers use the owner’s public typed service or a committed event—not its tables.
- Sharing a PostgreSQL transaction does not transfer ownership.
- Process coordinators may hold coordination state but must not become a super-domain.
- Package dependencies remain acyclic.
- Internal module calls stay local; do not add loopback HTTP.

# Workflow

## 1. Inspect

Identify the authoritative owner and whether the consumer needs a command, query, committed event, or derived projection. Trace existing package edges and callers.

## 2. Decide

Choose semantics first:

- synchronous invariant before success: public service in an explicit transaction;
- committed fact with fan-out: PgQue event;
- leased/scheduled single-consumer work: job table;
- checkpointed multi-step process: approved durable workflow.

Do not treat an Effect fiber as durable.

## 3. Implement

If the owner lacks the required operation, compose with `expose-public-contract`. Import only the owner’s `mod.ts`. Keep translation at the consumer boundary and preserve the owner’s tagged failures when callers can act on them.

For cross-domain atomic work, use an existing transaction-aware service contract. The repository does not yet expose a general reusable cross-domain transaction context; do not compensate by importing tables. Report the missing paved road if the task requires it.

## 4. Validate

Run the package-entrypoint and cycle checker, then contract and transaction tests. Verify rollback across all participating operations when atomicity is implemented.

# Deterministic Tools

```sh
deno task boundary:lint
deno task boundary:test
deno task test:contract
deno task check
```

`boundary:lint` rejects cross-package private imports and dependency cycles.

# Required Checks

- consumer imports only the owner’s public entry point;
- no direct cross-schema write exists;
- no dependency cycle is introduced;
- synchronous failures roll back all participating state;
- event/job/workflow consumers are idempotent when those paved roads exist;
- ownership remains documented at the canonical source.

# Failure Conditions

Stop when ownership is ambiguous, the only proposed path is a direct table import/write, a cycle cannot be removed through a stable contract or inversion, or required transaction/event infrastructure does not exist.

# Completion Criteria

The consumer receives only the behavior or fact it needs through an approved boundary; the owner remains authoritative; package and transaction checks pass.

# Related Skills

- [`expose-public-contract`](../expose-public-contract/SKILL.md)
- [`implement-transactional-workflow`](../implement-transactional-workflow/SKILL.md)
- [`create-domain-module`](../create-domain-module/SKILL.md)

# References

- [Composite process and transaction contracts](../../../docs/architecture/architecture-spec-v4.md)
- [Architecture enforcement](../../../docs/architecture/architecture-enforcement.md)
- [ADR-0015: one semantic owner](../../../docs/decisions/0015-one-semantic-owner-per-invariant.md)
- [Messaging architecture](../../../docs/architecture/pgque-messaging.md)
- [Durable execution](../../../docs/architecture/durable-execution.md)
