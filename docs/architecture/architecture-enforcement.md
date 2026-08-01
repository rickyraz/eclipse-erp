# Architecture Enforcement

> **Status:** Canonical
>
> **Owns:** Automated enforcement of package boundaries, schema ownership,
> forbidden cross-domain imports, and dependency-cycle rules.
>
> **Related documents**
>
> - Global architecture: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - PostgreSQL ownership: [`./postgresql-19-architecture.md`](./postgresql-19-architecture.md)
> - Testing strategy: [`../development/testing.md`](../development/testing.md)
> - Database roles: [`../operations/database-roles.md`](../operations/database-roles.md)
> - Documentation ownership: [`../documentation-boundaries.md`](../documentation-boundaries.md)

## Purpose

Architectural boundaries are not considered effective merely because they are
documented. The repository must enforce them through static checks, tests,
database privileges, and CI.

## Package Boundary Model

A domain package may import:

- its own internal modules;
- public contracts exported by another domain;
- approved kernel abstractions;
- shared contract and utility packages that have no domain ownership.

A domain package must not import:

- another domain's table definitions;
- another domain's repository implementations;
- another domain's internal services;
- another domain's migration files;
- application entry points;
- server-only code from frontend packages.

## Allowed Dependency Direction

```text
apps
  -> domain public contracts
  -> approved kernel abstractions

domain A
  -> domain B public contract

domain A
  -X-> domain B internal implementation

frontend
  -> shared public contracts
  -X-> backend repositories or database schema
```

## Package Boundary Manifest

Each domain package should expose an explicit public entry point.

Example:

```text
packages/inventory/
├── mod.ts
├── src/
│   ├── commands/
│   ├── queries/
│   ├── services/
│   ├── errors/
│   ├── schema/
│   └── internal/
└── tests/
```

Only exports reachable from `mod.ts` form the public contract.

The boundary checker must reject imports such as:

```ts
import { stockPosition } from "../inventory/src/internal/tables.ts"
```

and allow imports such as:

```ts
import { InventoryService } from "@eclipse/inventory"
```

## Schema Ownership

Each PostgreSQL schema has exactly one owning module.

The owner may:

- define tables and constraints;
- write to its tables;
- expose transaction-aware services;
- publish facts derived from committed changes.

A non-owner must not issue direct writes against the schema.

Cross-domain consistency must use a public service contract inside the same
transaction when atomicity is required.

## Schema Ownership Registry

Maintain one machine-readable registry, for example:

```toml
[schemas]
identity = "packages/identity"
auth = "packages/authorization"
sales = "packages/sales"
inventory = "packages/inventory"
accounting = "packages/accounting"
billing = "packages/billing"
workflow = "packages/workflow"
integration = "packages/integrations"
audit = "packages/audit"
```

The registry is used by:

- migration validation;
- SQL ownership checks;
- restricted database-role generation;
- architecture tests;
- code review tooling.

## SQL Ownership Checks

Static SQL checks should reject:

- writes to a schema not owned by the current package;
- migrations placed outside the owning module or central reviewed migration tree;
- unqualified table references where schema qualification is required;
- raw SQL that bypasses an approved domain service without an explicit exception.

Approved exceptions must be narrow, documented, and reviewed.

## No Cross-Domain Table Imports

Drizzle table definitions remain private to the owning module.

The linter must detect:

- direct imports of another module's table definitions;
- re-exporting private table definitions through a public contract;
- shared generic repository abstractions that expose arbitrary table access;
- frontend imports of database types or table definitions.

Public DTOs must be separate from persistence models.

## Dependency-Cycle Detection

The package dependency graph must remain acyclic unless a documented framework
edge is explicitly exempted.

The checker must report:

- the full cycle;
- the import path creating each edge;
- the public contract that should replace the internal dependency.

Example invalid cycle:

```text
sales
  -> inventory
  -> accounting
  -> sales
```

A typical correction is to extract a stable contract or invert one dependency
through an Effect service interface.

## Architecture Exceptions

An exception must include:

- affected packages;
- reason;
- risk;
- owner;
- expiration or removal condition;
- linked ADR when the exception changes architecture.

Permanent undocumented allowlists are forbidden.

## Required CI Checks

The default branch must reject changes when any of these fail:

```text
package-boundary validation
forbidden-import detection
dependency-cycle detection
schema-ownership validation
architecture tests
relative-link validation for documentation
```

## Suggested Repository Layout

```text
tooling/
├── boundary-linter/
├── dependency-graph/
└── schema-ownership-check/

tests/
└── architecture/

db/
└── ownership.toml
```

## Completion Criteria

Architecture enforcement is complete only when:

- every domain has a declared owner and public entry point;
- every PostgreSQL schema has one registered owner;
- forbidden imports fail locally and in CI;
- dependency cycles fail CI;
- architecture exceptions are explicit and reviewable;
- database privileges reinforce the same ownership model.
