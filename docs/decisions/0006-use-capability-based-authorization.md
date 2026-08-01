# ADR-0006: Use Capability-Based, Scoped Authorization

- Status: Accepted
- Date: 2026-08-01
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)

## Context

ERP actions carry different business risk and often apply only inside a company,
branch, warehouse, project, or other scope.

## Decision

Use deny-by-default authorization combining RBAC, scoped grants, constrained
ABAC, relationship context, and Separation of Duties. Permissions represent
business actions rather than generic CRUD alone.

## Consequences

Application authorization remains primary for business policy. PostgreSQL RLS
provides tenant isolation and defense in depth.

## Validation

Test allow, deny, scope, SoD, and explanation behavior for high-risk actions.
