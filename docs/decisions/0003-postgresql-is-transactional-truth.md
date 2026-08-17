# ADR-0003: PostgreSQL Is the Transactional Source of Truth

- Status: Superseded
- Date: 2026-08-01
- Supersedes: None
- Superseded by: ADR-0040 (financial-ledger authority scope)

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)

## Context

ERP correctness depends on transactions, constraints, immutable facts, audit,
tenant isolation, and deterministic recovery.

## Decision

PostgreSQL stores every state element that determines business truth. Redis,
ClickHouse, search indexes, and caches remain ephemeral or rebuildable.

## Consequences

Core business success is never acknowledged before PostgreSQL commit. Database
constraints, locks, isolation, RLS, and reviewed migrations remain first-class.

## Validation

Run invariant checks, backup recovery tests, and projection reconciliation.
