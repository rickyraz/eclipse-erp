# ADR-0023: Adopt capability-oriented plugin contribution

- Status: Accepted
- Date: 2026-08-04
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Plugin architecture: [`../architecture/plugin-architecture.md`](../architecture/plugin-architecture.md)
> - Process Studio: [`../architecture/process-studio.md`](../architecture/process-studio.md)
> - Tiered plugin trust: [`./0007-adopt-tiered-plugin-trust.md`](./0007-adopt-tiered-plugin-trust.md)
> - Semantic invariant ownership: [`./0015-one-semantic-owner-per-invariant.md`](./0015-one-semantic-owner-per-invariant.md)

## Context

EclipseERP needs extension without recreating an Odoo-style shared model
composition system in which extensions modify a core model, repository, or
lifecycle through internal reachability. The existing tiered trust decision
controls extension authority, but the contribution boundary also needs an
explicit contract model.

The design must preserve domain ownership while allowing trusted plugins,
localizations, connectors, and declarative tenant extensions to add useful
capabilities.

## Decision

EclipseERP uses **extension by contribution**, not extension by in-place model
modification.

### Contracts

- **Public contracts** are the supported commands, queries, services, DTOs,
  errors, and events used by ordinary domain consumers.
- **Contributor contracts** are separate, versioned extension points explicitly
  published by a core domain or platform capability. They allow a plugin to
  participate without receiving access to internal tables, repositories, or
  domain models.
- Physical importability does not imply architectural accessibility. Only
  published public or contributor contracts are supported dependencies.
- Contributor contracts do not transfer ownership of the core invariant. The
  owning domain remains the sole authority for validation and mutation.

### Plugin authority

A plugin manifest declares at least:

- stable identifier and semantic version;
- plugin API version and compatible EclipseERP range;
- trust level and execution/deployment topology;
- dependencies and entry point;
- owned schema namespaces and migrations;
- requested capabilities;
- declared action, event, workflow, route, connector, and UI contributions.

Effective authority is the intersection of declared capabilities, trust policy,
installation policy, and tenant policy. A declaration is not a grant.

Trust level and deployment topology are separate dimensions. Local execution is
not automatically trusted, and remote execution is not automatically untrusted.

### Contribution and readiness

Core modules and trusted plugins may register versioned Typed Action Catalog and
Typed Event Catalog entries through contributor contracts. Declarative
extensions may configure approved entries but may not register arbitrary code,
mutate core tables, redefine invariants, or elevate trust.

Installation is not Process Studio readiness. A contribution must satisfy the
relevant public-contract, schema, capability, compatibility, idempotency,
recovery, observability, and maturity gates before it can participate in
production process orchestration.

## Alternatives Considered

### In-place core model extension

Rejected because it creates hidden coupling, makes effective behavior depend on
installed extension order, and weakens local reasoning about ownership and
invariants.

### Direct plugin access to core repositories or tables

Rejected because technical reachability would become an unsupported authority
path and would bypass domain validation, authorization, audit, and correction
semantics.

### One trust enum that also describes deployment

Rejected because authority and execution location are different concerns. They
must be evaluated independently.

### Arbitrary sandboxed code in the first implementation

Deferred. Sandboxed execution requires a separate resource, capability, secret,
network, and escape-resistance design. Trusted server and declarative
extensions are the initial priorities.

## Consequences

### Positive

- Core domains retain schema and invariant ownership.
- Plugin APIs become discoverable, versioned, and testable.
- Process Studio can compose plugin capabilities without importing plugin internals.
- Connector and localization extensions can own state without becoming domain owners.

### Negative

- Core domains must deliberately publish contributor contracts.
- Plugin authors cannot rely on convenient internal access.
- Compatibility and maturity metadata add release work.

### Risks

- A contributor contract can become a disguised repository API if it exposes
  persistence details.
- An oversized catalog can become a second mutable model graph.
- Trusted server code still requires deployment review and database privilege
  enforcement.

## Validation

- Boundary checks reject plugin imports of private domain implementations and
  direct core-table mutation.
- Contract tests verify manifest, capability, contributor, and catalog schemas.
- Compatibility tests verify contributor versions and declared capability
  requirements.
- Process readiness tests verify idempotency, authorization, retries,
  unknown-outcome handling, compensation/manual recovery, and observability.
- PostgreSQL roles enforce plugin schema ownership where plugin runtime is
  implemented.

## Related Documents

- [`../architecture/plugin-architecture.md`](../architecture/plugin-architecture.md)
- [`../roadmap/domain-maturity.md`](../roadmap/domain-maturity.md)
- [`../roadmap/erp-primitives.md`](../roadmap/erp-primitives.md)
