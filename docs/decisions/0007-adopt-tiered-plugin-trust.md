# ADR-0007: Adopt Tiered Plugin Trust

- Status: Accepted
- Date: 2026-08-01
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)

## Context

ERP requires localization and customization without granting every extension
unrestricted database, network, native, and transaction access.

## Decision

Use four extension classes: core, trusted server, sandboxed, and declarative.
Version 1 prioritizes trusted compiled plugins and declarative tenant
extensions.

## Consequences

Plugin capabilities are explicit and tied to trust level. Tenant administrators
cannot elevate trust.

## Validation

Verify capability enforcement, schema ownership, migration isolation, and
upgrade compatibility.
