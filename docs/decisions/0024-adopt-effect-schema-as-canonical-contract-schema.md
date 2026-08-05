# ADR-0024: Adopt Effect Schema as the Canonical Contract Schema

- Status: Accepted
- Date: 2026-08-05
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Effect, Deno, and Drizzle:
>   [`./0002-use-effect-deno-and-drizzle.md`](./0002-use-effect-deno-and-drizzle.md)
> - SolidJS 2.0 frontend: [`./0009-use-solidjs-2.md`](./0009-use-solidjs-2.md)
> - Vite SPA: [`./0010-use-vite-solidjs-spa.md`](./0010-use-vite-solidjs-spa.md)
> - Drizzle schema flow and Effect HTTP:
>   [`./0012-use-drizzle-schema-flow-and-effect-http.md`](./0012-use-drizzle-schema-flow-and-effect-http.md)
> - External standards adapters:
>   [`./0013-version-external-standard-adapters.md`](./0013-version-external-standard-adapters.md)
> - External integration profile:
>   [`./0019-adopt-integration-surface-profile.md`](./0019-adopt-integration-surface-profile.md)
> - Plugin contribution:
>   [`./0023-adopt-capability-oriented-plugin-contribution.md`](./0023-adopt-capability-oriented-plugin-contribution.md)
> - Frontend architecture: [`../architecture/frontend.md`](../architecture/frontend.md)
> - Integration architecture:
>   [`../architecture/integration-architecture.md`](../architecture/integration-architecture.md)
> - Plugin architecture:
>   [`../architecture/plugin-architecture.md`](../architecture/plugin-architecture.md)
> - Process Studio: [`../architecture/process-studio.md`](../architecture/process-studio.md)

## Context

Odoo and SAP demonstrate a valid but different approach: the ERP framework owns a large data-model
system that is closely integrated with its ORM, persistence, views, and validation mechanisms.
EclipseERP is a TypeScript modular monolith with separate ownership for persistence, domain
semantics, HTTP, frontend, plugins, and external integrations. It must therefore make the
relationships between these schemas explicit instead of treating one ORM model as the whole ERP
contract.

The project needs runtime contracts for:

- domain commands, queries, DTOs, errors, and events;
- Effect-native HTTP endpoints and generated API descriptions;
- frontend API, route, browser-storage, file-import, and plugin boundaries;
- Process Studio action and event catalogs;
- plugin manifests and versioned contributor contracts;
- normalized external actions and events;
- external standards and provider payloads at connector boundaries.

Using only TypeScript types would not validate runtime data. Using Valibot or another second schema
system for shared frontend contracts would create a second source of truth and make API, plugin, and
integration evolution harder to reason about. Conversely, requiring every external developer or
sandboxed plugin to install Effect would expose an internal implementation choice at a
language-neutral boundary.

A schema describes shape, encoding, decoding, and transport representation. It does not become the
owner of business policy, authorization, transaction semantics, PostgreSQL constraints, or plugin
trust.

## Decision

Effect Schema is the canonical runtime schema language for **EclipseERP-owned contracts**.

### Contract ownership by layer

| Layer                  | Canonical owner                                          | Schema role                                                         |
| ---------------------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| PostgreSQL persistence | PostgreSQL and Drizzle                                   | Tables, constraints, indexes, transactions, and migrations          |
| Domain public contract | Owning domain with Effect Schema                         | Commands, queries, DTOs, errors, events, and decoded/encoded values |
| HTTP API               | Effect `HttpApi` with Effect Schema                      | Request, response, error, security, and OpenAPI contract            |
| Frontend boundary      | Shared Effect Schema contract                            | API, route search, storage, import, and third-party decoding        |
| Process Studio         | Versioned catalog contract                               | Typed action/event inputs, outputs, failures, and mappings          |
| Plugin boundary        | Public or contributor contract                           | Manifest, capability, catalog, and contribution schemas             |
| Connector boundary     | Integration adapter with Effect Schema                   | Normalized `ExternalAction` and `ExternalEvent` contracts           |
| External wire          | OpenAPI, JSON, CloudEvents, AsyncAPI, or provider format | Language-neutral transport representation                           |

Effect Schema is the single source of truth for an EclipseERP-owned contract. Its inferred
TypeScript types are compile-time views of that schema, not a replacement for runtime decoding.

### Frontend

The SolidJS 2.0 frontend imports shared Effect Schema contracts for API and route boundaries.
`TanStack Solid Form` owns field state, validation timing, debouncing, submission coordination, and
user-facing feedback. The v4 Standard Schema adapter is `Schema.toStandardSchemaV1`.

Solid 2.0 async reactivity owns loading, pending, refresh, and mutation behavior. Contract schemas
remain pure and must not import Solid signals, components, or router-specific types.

Valibot, Zod, or a custom validator is not a parallel implementation of a shared API, domain,
plugin, or integration contract. A feature may use a small UI-only validator, including Valibot,
only when the rule is presentation-local, does not duplicate a domain invariant, and measurement
shows that the additional dependency is justified.

### Internal application boundaries

Internal calls use public typed domain services and Effect Schema contracts. They must not use
loopback HTTP, Drizzle table types, repositories, or persistence models as public contracts. Effect
Schema validation does not move invariant ownership away from the domain or database owner.

### Plugins

Core modules and trusted server plugins may depend on released public and contributor contracts,
including their Effect Schema definitions. They may own separate schemas and migrations but may not
mutate another module's tables or import private implementations.

Sandboxed, declarative, and externally hosted plugins are not required to run Effect. They interact
through versioned, capability-scoped, language-neutral manifest and wire contracts. The host
validates those contracts with Effect Schema and enforces trust, authorization, resource, and
compatibility policy. Effect Schema runtime objects, ASTs, Drizzle types, credentials, and private
services are never part of an external plugin ABI.

### External integrations

External systems are not required to use Effect Schema. The public integration profile remains:

```text
Actions: HTTPS + JSON + OpenAPI
Events:  CloudEvents over HTTPS; AsyncAPI as a catalog
Errors:  RFC 9457 Problem Details
```

Versioned connector adapters validate and translate provider representations into normalized Effect
Schema contracts. Provider-generated types, raw OAuth tokens, transport details, and provider
persistence identifiers remain inside `packages/integrations`. External standards never become
internal persistence models or domain invariants.

### Evolution and compatibility

Every public, contributor, catalog, external, and plugin contract has an explicit stable identifier
and version. Compatibility is tested at the boundary. A schema change must not silently redefine a
running Process Studio instance, plugin contribution, external event interpretation, or domain
invariant.

## Alternatives Considered

### Odoo/SAP-style framework-owned universal model

Rejected. EclipseERP needs separate semantic owners for persistence, domains, external
representations, plugin capabilities, and Process Studio coordination. A universal model would blur
ownership and make extension order or provider representation affect core invariants.

### Effect Schema for every consumer and plugin

Rejected. External and sandboxed consumers need language-neutral contracts and must not be coupled
to EclipseERP's internal runtime or Effect release cycle.

### Effect Schema backend plus Valibot frontend with shared types only

Rejected for shared contracts. TypeScript types do not perform runtime validation, and duplicate
schemas would drift across API, plugin, and integration changes.

### A separate schema library per layer

Rejected as the default. Multiple canonical schema languages multiply mapping, error, versioning,
and contract-test surfaces without solving domain ownership.

### OpenAPI or JSON Schema as the internal canonical model

Rejected. They remain important wire and tooling formats, but they do not replace the
decoded/encoded TypeScript and Effect contract needed by domain services, typed failures,
transformations, and internal composition.

### No runtime schema; rely on PostgreSQL and backend checks

Rejected. Database constraints protect persistence invariants but cannot decode HTTP, frontend,
plugin, file, or external event boundaries before domain code consumes them.

## Consequences

### Positive

- One runtime schema vocabulary covers internal public contracts and normalized integration
  boundaries.
- API, frontend, plugin, catalog, and external contract drift is easier to test.
- Effect HTTP and OpenAPI can derive from the same endpoint definitions.
- Encode/decode transformations keep wire representations separate from domain values.
- Process Studio and plugin contributions can use versioned typed contracts without importing
  private implementations.
- UI composition can change without moving business validation into components.
- External developers remain free to use standard protocols and other languages.

### Negative

- Effect becomes a strategic dependency for EclipseERP-owned contract packages.
- Effect Schema can add browser bundle weight compared with a frontend-only validator.
- Teams must learn the distinction between schema validation and domain, database, authorization,
  and reliability invariants.
- External and plugin adapters still require explicit mapping and compatibility work.

### Risks

- **Effect v4 API churn:** pin the exact Effect cohort, use the vendored v4 reference, and keep
  contract tests at public boundaries.
- **Browser bundle growth:** import only needed contract modules, split by route or feature, and
  measure the built SPA before considering a UI-only exception.
- **External lock-in:** expose OpenAPI, JSON, CloudEvents, AsyncAPI, and Problem Details rather than
  Effect runtime objects.
- **Schema used as business policy:** keep authorization, transactions, constraints, and domain
  invariants in their owning layers.
- **Plugin escape paths:** enforce trust, capability, schema ownership, and import boundaries; never
  treat a manifest declaration as a grant.
- **Lossy external mappings:** require version/profile contract fixtures and explicit handling for
  unsupported or discarded fields.

## Validation

The decision is validated when:

- public domain contracts have runtime Effect Schema decoding and encoding;
- HTTP request, response, error, and OpenAPI contracts derive from one source;
- frontend API and route boundaries reject invalid runtime data without importing backend
  implementations;
- TanStack Solid Form consumes the v4 Standard Schema adapter without making schema definitions
  Solid-specific;
- plugin manifests and contributor contracts are versioned and boundary-tested;
- OpenAPI imports and CloudEvents ingestion normalize into typed external contracts with
  authentication, deduplication, and redacted failures;
- external generated types and provider schemas do not leak into domain APIs;
- architecture checks reject shared-contract Valibot/Zod duplicates and direct plugin or connector
  access to private domain implementations;
- the built frontend bundle is measured before any UI-only schema exception is accepted.

## Related Documents

- [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
- [`../architecture/frontend.md`](../architecture/frontend.md)
- [`../architecture/integration-architecture.md`](../architecture/integration-architecture.md)
- [`../architecture/plugin-architecture.md`](../architecture/plugin-architecture.md)
- [`../architecture/process-studio.md`](../architecture/process-studio.md)
- [`./0010-use-vite-solidjs-spa.md`](./0010-use-vite-solidjs-spa.md)
- [`./0012-use-drizzle-schema-flow-and-effect-http.md`](./0012-use-drizzle-schema-flow-and-effect-http.md)
- [`./0013-version-external-standard-adapters.md`](./0013-version-external-standard-adapters.md)
- [`./0019-adopt-integration-surface-profile.md`](./0019-adopt-integration-surface-profile.md)
- [`./0023-adopt-capability-oriented-plugin-contribution.md`](./0023-adopt-capability-oriented-plugin-contribution.md)
