# ADR-0005: Use ltree and SQL/PGQ Selectively

- Status: Accepted
- Date: 2026-08-01
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)

## Context

ERP contains both strict trees and richer networks. Treating every relationship
as either a recursive adjacency list or a generic graph obscures constraints.

## Decision

Use relational tables for authoritative state, `ltree` for strict hierarchies,
and SQL/PGQ for read-oriented multi-edge graph traversal.

## Consequences

Graph capability improves selected queries without replacing relational
transactions or constraints.

## Validation

Benchmark representative hierarchy and graph queries and verify projection
rebuildability.
