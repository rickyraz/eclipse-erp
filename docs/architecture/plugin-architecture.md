# Plugin Architecture

> **Status:** Canonical design concern
>
> **Related documents**
>
> - Active architecture: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - Authorization: [`./authorization.md`](./authorization.md)
> - Plugin ADR: [`../decisions/0007-adopt-tiered-plugin-trust.md`](../decisions/0007-adopt-tiered-plugin-trust.md)

## Position

Extension boundaries must be designed before version 1, but a full marketplace
and arbitrary third-party runtime are post-version-1 concerns.

## Extension Classes

### Core Module

Compiled and released with EclipseERP. It may participate in core transactions
and owns a domain schema.

### Trusted Server Plugin

Installed by an operator, compiled into the deployment, and trusted as server
code. It owns its own schema and may register migrations, event consumers,
workflows, routes, and UI contributions within declared capabilities.

### Sandboxed Plugin

Runs without direct database or native access. It uses host capabilities with
strict CPU, memory, time, network, and I/O limits. This is a later-phase feature.

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

Trust level controls database access, network access, native FFI, migration
rights, permission registration, and workflow capabilities. A tenant
administrator cannot elevate trust.

## Ownership

A plugin may only write to its owned schema unless a core module exposes an
explicit contributor contract. Direct mutation of core accounting or inventory
tables is forbidden.

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

## Native Code

Only the core calculation-kernel boundary may use Zig. Plugins must not load
arbitrary native libraries.
