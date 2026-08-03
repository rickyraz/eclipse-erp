# ADR-0017: Use the canonical Effect Deno adapter

- Status: Accepted
- Date: 2026-08-03
- Supersedes: The HTTP runtime-adapter portion of ADR-0012
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture:
>   [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)

## Context

EclipseERP runs on Deno, but its Effect HTTP server previously crossed through
`@effect/platform-node` and `node:http`. The canonical Effect repository now contains
`@effect/platform-deno` with native `DenoHttpServer` and `DenoRuntime` implementations.

As of August 3, 2026, `@effect/platform-deno@4.0.0-beta.102` exists in the canonical repository but
is not published to npm. The repository is already maintained as a pinned git subtree.

## Decision

Align `effect`, `@effect/vitest`, `@effect/sql-pg`, and `@effect/platform-node-shared` on
`4.0.0-beta.102`.

Use `DenoHttpServer` and `DenoRuntime` through explicit import-map URLs pinned to the same canonical
Effect commit as the subtree. Application code must not import `node:http` or call `Deno.serve`
directly. The adapter may retain its upstream `@effect/platform-node-shared` dependency until Effect
removes it.

Maintain the subtree from `https://github.com/Effect-TS/effect.git` on `main`. The existing
`vendor/effect-smol` prefix remains unchanged to preserve subtree history.

## Alternatives Considered

- Keep `@effect/platform-node`: rejected because it adds an unnecessary Node server boundary to a
  Deno application.
- Copy the Deno adapter into application code: rejected because the canonical implementation already
  exists and copying would create a fork.
- Wait for npm publication: rejected because the commit-pinned canonical source provides the exact
  beta adapter required now.

## Consequences

- HTTP serving and process shutdown use native Deno implementations.
- The Deno adapter is temporarily loaded from commit-pinned canonical source URLs.
- Updating the subtree revision, import-map URLs, and Effect package versions must remain
  coordinated.
- The import-map aliases can be replaced by an npm dependency when the package is published.

## Validation

- Architecture tests require `DenoHttpServer` and `DenoRuntime` imports and reject direct
  `node:http` and `Deno.serve` application usage.
- Type checking verifies the commit-pinned adapter against Effect `4.0.0-beta.102`.
