# ADR-0001: Use a Modular Monolith

- Status: Accepted
- Date: 2026-08-01
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)

## Context

ERP operations require cross-domain transactional integrity. Splitting domains
into independently deployed services would add network round trips,
serialization, failure modes, and distributed transactions before independent
scaling is proven.

## Decision

EclipseERP will use orthogonal domain modules inside a modular monolith. API,
worker, relay, and migrator may run as separate processes but remain one
application family and share PostgreSQL transaction boundaries.

## Consequences

### Positive

- Local typed calls.
- One transaction for core invariants.
- Simpler deployment and debugging.
- Boundaries remain extractable later.

### Negative

- Domains cannot be deployed independently.
- Boundary discipline requires tooling and review.

## Validation

Use package-boundary linting and prohibit direct cross-module table mutation.
