---
name: expose-public-contract
description: "Use when adding or changing a domain command, query, Effect service, DTO, tagged error, test layer, or package export, especially when another package or API needs an internal fact."
---

# Purpose

Expose the smallest stable domain contract callers need while keeping persistence, repositories, and implementation failures private.

# Use This Skill When

- adding or modifying exports in `packages/*/mod.ts`;
- another domain, app, or adapter needs behavior owned by a package;
- introducing a command/query or tagged business failure;
- versioning or changing an existing public DTO.

# Do Not Use This Skill When

- a caller can already use the current public contract;
- the proposed export is a Drizzle table, query type, repository, or internal helper;
- the request is only transport wiring; use `add-api-endpoint`.

# Required Context

Inspect the package `mod.ts`, service interface, implementation, test layer, public contract tests, and every current caller. Determine compatibility expectations before changing a schema or failure union.

# Architecture Rules

- Public contracts use Effect Schema DTOs, Effect services, commands/queries, tagged domain errors, and layers.
- Drizzle and PostgreSQL types remain private.
- Failures belong to the layer that can act on them; do not widen domain unions with startup or driver-specific errors.
- Known constraints map to owning-domain errors; unknown persistence failures map once to `DatabaseFailure`.
- Contract tests import only the package public entry point.
- Do not export a generic abstraction solely to avoid one explicit service method.

# Workflow

## 1. Inspect

Grep all imports of the package and all exports from its `mod.ts`. Read tests for success, validation, authorization, rollback, and every public tagged error.

## 2. Decide

Define the caller-visible operation, input/output schemas, actionable failures, required environment, compatibility impact, and whether a versioned adapter is needed.

## 3. Implement

Change the service contract and implementation together. Export only the required symbols from `mod.ts`. Keep mapping and persistence helpers private. Update the deterministic test layer without weakening authorization or transaction semantics.

## 4. Validate

Add or update public contract tests through `mod.ts`. If another package consumes the contract, compose with `introduce-cross-domain-integration` and run the dependency checks.

# Deterministic Tools

```sh
deno task test:contract
deno task boundary:test
deno task boundary:lint
deno task check
```

Use repository grep and the package dependency checker to find consumers; do not rely on memory of the call graph.

# Required Checks

- no persistence types are exported;
- every new public error is actionable for a domain caller and covered by tests;
- schema decoding and authorization remain at trust boundaries;
- callers import `mod.ts`, not `src/`;
- compatibility-sensitive changes have an ADR or versioned boundary when required.

# Failure Conditions

Stop when the requested export would leak infrastructure, duplicate another owner’s invariant, create a package cycle, or make a breaking compatibility promise without an owner and migration plan.

# Completion Criteria

Callers can perform the requested behavior through one typed public boundary; implementation details remain private; contract, boundary, and type checks pass.

# Related Skills

- [`introduce-cross-domain-integration`](../introduce-cross-domain-integration/SKILL.md)
- [`add-api-endpoint`](../add-api-endpoint/SKILL.md)
- [`change-owned-schema`](../change-owned-schema/SKILL.md)

# References

- [Module contract](../../../docs/architecture/architecture-spec-v4.md)
- [Testing strategy](../../../docs/development/testing.md)
- [Architecture enforcement](../../../docs/architecture/architecture-enforcement.md)
- [Identity public contract example](../../../packages/identity/mod.ts)
- [Party public contract example](../../../packages/party/mod.ts)
