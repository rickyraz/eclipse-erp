# ADR-0014: Separate Internal Identity from External Identifiers

- Status: Accepted
- Date: 2026-08-01
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture:
>   [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - ERP standards reference:
>   [`../architecture/reference/erp-standards.md`](../architecture/reference/erp-standards.md)

## Context

ERP records can carry identifiers assigned by tenants, suppliers, governments, standards bodies, and
other external systems. Examples include LEI, GLN, GTIN, tax identifiers, supplier SKUs, and
customer account references.

These identifiers have different issuers, scopes, jurisdictions, validity periods, and lifecycles.
Using one as the internal primary key would make domain identity depend on an external authority and
would fail for records that have no such identifier or have several identifiers.

## Decision

Every domain entity has an internal identity independent of external identifiers.

An external identifier must be modeled with enough context to interpret and constrain it, including
its scheme and declared scope. Where relevant, that context may include issuer, tenant,
jurisdiction, and validity period.

Uniqueness is enforced within the identifier's declared scheme and scope, not globally unless the
external standard guarantees global uniqueness.

External identifiers must not be used as internal primary keys. Domain contracts may locate an
entity by an external identifier, but must resolve it to the entity's internal identity.

The domain that owns the identified entity owns identifier attachment, lifecycle rules, and conflict
translation. Shared identifier vocabulary must not become a universal cross-domain entity model.

## Alternatives Considered

### Use the main external identifier as the primary key

Rejected because identifier availability and lifecycle are controlled outside EclipseERP, and many
entities have zero, one, or several external identifiers.

### Enforce every external identifier globally

Rejected because many identifiers are unique only within an issuer, tenant, jurisdiction, or trading
relationship.

### Create one universal identifier service for every domain

Rejected because ownership and lifecycle rules differ by the identified business entity. Shared
vocabulary does not require shared mutation ownership.

## Consequences

### Positive

- Internal references remain stable when external identifiers change.
- Multiple identifier schemes can coexist.
- Uniqueness rules can match the actual authority and scope.
- Domain ownership remains explicit.

### Negative

- External lookup requires an additional resolution step.
- Identifier tables and contracts must carry scope metadata.

### Risks

- An underspecified scope can reject valid identifiers or admit duplicates.
- Treating a locally unique identifier as globally unique can merge unrelated entities.

## Validation

- Add domain contract tests for attachment, replacement, expiry, and scoped duplicate rejection.
- Enforce identifier uniqueness with database constraints matching the declared scheme and scope.
- Add boundary checks if a shared identifier vocabulary is introduced.
