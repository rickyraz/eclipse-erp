# ADR-0013: Isolate External Standards Behind Versioned Adapters

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

EclipseERP must interoperate with external standards such as UBL, ISO 20022, EPCIS, XBRL, and
jurisdiction-specific reporting formats. These contracts have independent versions, profiles, broad
optional schemas, and cross-organization semantics that do not necessarily match EclipseERP domain
models.

Using an external schema directly as a domain entity or persistence model would couple internal
invariants and storage to that standard's representation and release cycle.

## Decision

External standards enter and leave EclipseERP only through versioned adapters in
`packages/integrations`.

Each adapter contract must identify the applicable standard, version, and profile or message type.
Adapters map between external representations and public domain contracts. They must not expose
external generated types through domain package APIs or make an external document schema the
internal persistence schema.

Domain modules may use standard semantics, identifiers, and code lists where they accurately express
the business concept. The domain that owns the business fact remains authoritative.

## Alternatives Considered

### Use external schemas as the canonical domain model

Rejected because exchange documents group information for interoperability rather than internal
ownership and transaction boundaries.

### Copy external schemas into PostgreSQL tables

Rejected because this creates direct coupling to standard versions, deeply nested persistence
models, and large optional surfaces unrelated to internal invariants.

### Let each domain implement its own external mapping

Rejected because it mixes interoperability concerns with business ownership and makes adapter
versioning inconsistent.

## Consequences

### Positive

- Domain semantics and invariants remain independent of external representation changes.
- Multiple versions and profiles can coexist explicitly.
- External generated types stay outside public domain contracts.
- Integration compatibility can be tested at one boundary.

### Negative

- Every supported standard requires explicit mapping code.
- Lossless round trips may require preserving external metadata outside the domain model.

### Risks

- An adapter can silently discard meaningful external fields unless compatibility tests cover the
  supported profile.
- `packages/integrations` can become a generic dumping ground unless adapters depend only on public
  domain contracts.

## Validation

- Add contract tests for each supported standard, version, and profile.
- Add boundary enforcement before generated external types are introduced.
- Verify that domain public entry points do not export external message or schema types.
