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
> - Localization ADR:
>   [`../decisions/0016-isolate-jurisdiction-localization.md`](../decisions/0016-isolate-jurisdiction-localization.md)

## Position

Extension boundaries must be designed before version 1, but a full marketplace and arbitrary
third-party runtime are post-version-1 concerns.

## Extension Classes

### Core Module

Compiled and released with EclipseERP. It may participate in core transactions and owns a domain
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

Core modules and trusted server plugins may contribute versioned Typed Action
Catalog and Typed Event Catalog entries through approved contributor contracts.
Trusted plugins may also contribute connector adapters, but connector protocols,
credentials, provider retries, and external failures remain behind the
integration boundary and cannot become domain invariants.
A plugin contribution is Process Studio-ready only after it satisfies the
primitive and Level 3 domain-provider gates in
[`../roadmap/domain-maturity.md`](../roadmap/domain-maturity.md).
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
- compatible EclipseERP range;
- dependencies;
- entry point;
- owned schema;
- declared capabilities.

## Localization Boundaries

Shared primitive cores remain jurisdiction-neutral. Jurisdiction-specific policy, identifiers,
codes, evidence formats, reporting formats, and authority integrations belong to explicit
localization boundaries.

A localization may be a core module released with EclipseERP or a trusted server plugin installed by
an operator. Both use public domain contracts or explicit contributor contracts and must not mutate
another module's tables, redefine its invariants, or patch jurisdiction-specific behavior into
shared primitives.

A localization contract declares its jurisdiction and version. External authority protocols and
formats additionally use versioned integration adapters. Detailed rationale is owned by
[ADR-0016](../decisions/0016-isolate-jurisdiction-localization.md).

## Native Code

Only the core calculation-kernel boundary may use Zig. Plugins must not load arbitrary native
libraries.
