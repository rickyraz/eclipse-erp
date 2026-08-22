# Plugin Architecture

> **Status:** Canonical design concern
>
> **Related documents**
>
> - Active architecture: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - Authorization: [`./authorization.md`](./authorization.md)
> - Process Studio: [`./process-studio.md`](./process-studio.md)
> - External integration surface: [`./integration-architecture.md`](./integration-architecture.md)
> - Primitive and domain roadmap: [`../roadmap/README.md`](../roadmap/README.md)
> - Plugin ADR:
>   [`../decisions/0007-adopt-tiered-plugin-trust.md`](../decisions/0007-adopt-tiered-plugin-trust.md)
> - Capability-oriented contribution ADR:
>   [`../decisions/0023-adopt-capability-oriented-plugin-contribution.md`](../decisions/0023-adopt-capability-oriented-plugin-contribution.md)
> - Localization ADR:
>   [`../decisions/0016-isolate-jurisdiction-localization.md`](../decisions/0016-isolate-jurisdiction-localization.md)

## Position

Extension boundaries must be designed before version 1, but a full marketplace and arbitrary
third-party runtime are post-version-1 concerns.

## Contribution Model

RITSEI uses **extension by contribution**, not in-place extension of a core
model, table, repository, or domain implementation.

- **Public contracts** serve ordinary domain consumers through supported
  commands, queries, services, DTOs, errors, and events.
- **Contributor contracts** are separate, versioned extension points published
  deliberately by a core domain or platform capability.
- A contributor contract does not transfer ownership of the core invariant.
- Physical importability does not make an internal implementation an accessible
  dependency; only published public or contributor contracts are supported.

A plugin therefore participates in a domain through an explicit capability
surface rather than becoming another implementation of the domain's model.
Detailed rationale is owned by
[`../decisions/0023-adopt-capability-oriented-plugin-contribution.md`](../decisions/0023-adopt-capability-oriented-plugin-contribution.md).

Generated structural ergonomics is tooling, not a second ownership system. It may scaffold schemas,
DTOs, ordinary queries, form metadata, CRUD helpers, API documentation inputs, and test skeletons
from owner-reviewed metadata. It must not generate or claim protected transitions, authorization,
transaction boundaries, cross-domain consequences, fact authority, or persistence ownership.
Generated artifacts remain subject to the same public-contract, package-boundary, capability, and
compatibility checks as handwritten code.

## Extension Classes

### Core Module

Compiled and released with RITSEI. It may participate in core transactions and owns a domain
schema.

### Trusted Server Plugin

Installed by an operator, compiled into the deployment, and trusted as server code. It owns its own
schema and may register migrations, event consumers, workflows, routes, and UI contributions within
declared capabilities.

### Sandboxed Plugin

Runs without direct database or native access. It uses host capabilities with strict CPU, memory,
time, network, and I/O limits. This is a later-phase feature.

### Declarative Tenant Extension

Uses metadata or a typed DSL for:

- custom fields;
- layouts;
- approval policies;
- reports;
- notifications;
- webhooks;
- safe automations.

It cannot execute arbitrary code or modify core invariants.

## Trust Levels

```text
CORE
TRUSTED_SERVER
SANDBOXED
DECLARATIVE
```

Trust level controls database access, network access, native FFI, migration rights, permission
registration, and workflow capabilities. A tenant administrator cannot elevate trust.

## Ownership

A plugin may only write to its owned schema unless a core module exposes an explicit contributor
contract. Direct mutation of core accounting or inventory tables is forbidden.

A plugin manifest declares its identity, versions, trust level, execution/deployment topology,
dependencies, entry point, owned schemas, requested capabilities, and declared contributions. The
effective authority is the intersection of declared capabilities, trust policy, installation policy,
and tenant policy; declaration is not a grant.

Trust level and deployment topology are separate dimensions. Local execution is not automatically
trusted, and remote execution is not automatically untrusted.

Core modules and trusted server plugins may contribute versioned Typed Action
Catalog and Typed Event Catalog entries through approved contributor contracts.
Trusted plugins may also contribute connector adapters, but connector protocols,
credentials, provider retries, and external failures remain behind the
integration boundary and cannot become domain invariants.
A plugin contribution is Process Studio-ready only after it satisfies the
primitive and Level 3 domain-provider gates in
[`../roadmap/domain-maturity.md`](../roadmap/domain-maturity.md).
A plugin-local workflow is implementation or domain-local coordination owned by
the plugin; it is not a Process Studio definition. Process Studio owns
cross-domain process definitions, Process IR, release/deployment, and runtime
orchestration, and may invoke plugin behavior only through released catalog
contracts.
Declarative tenant extensions may compose and configure approved entries but
cannot register arbitrary executable code, forge catalog metadata, or elevate
their trust. Detailed process contribution rules are owned by
[`process-studio.md`](./process-studio.md).

## Lifecycle

A plugin manifest must define:

- stable identifier;
- semantic version;
- plugin API version;
- trust level;
- compatible RITSEI range;
- dependencies;
- entry point;
- owned schema;
- declared capabilities;
- execution/deployment topology;
- declared action, event, workflow, route, connector, and UI contributions.

Installation does not make a contribution Process Studio-ready. It must pass the relevant public
contract, schema, capability, compatibility, idempotency, recovery, observability, and maturity
gates before production orchestration may use it.

The plugin loader, manifest registry, sandbox runtime, and marketplace are not part of the current
implementation; they remain design and roadmap work.

## Localization Boundaries

Shared primitive cores remain jurisdiction-neutral. Jurisdiction-specific policy, identifiers,
codes, evidence formats, reporting formats, and authority integrations belong to explicit
localization boundaries.

A localization may be a core module released with RITSEI or a trusted server plugin installed by
an operator. Both use public domain contracts or explicit contributor contracts and must not mutate
another module's tables, redefine its invariants, or patch jurisdiction-specific behavior into
shared primitives.

A localization contract declares its jurisdiction and version. External authority protocols and
formats additionally use versioned integration adapters. Detailed rationale is owned by
[ADR-0016](../decisions/0016-isolate-jurisdiction-localization.md).

## Native Code

Only the core calculation-kernel boundary may use Zig. Plugins must not load arbitrary native
libraries.
