# ADR-0022: Update Effect v4 and the Deno adapter to beta.103

- Status: Accepted
- Date: 2026-08-04
- Supersedes: ADR-0017
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - Previous Deno adapter decision: [`./0017-use-effect-platform-deno.md`](./0017-use-effect-platform-deno.md)

## Context

The repository was aligned on Effect `4.0.0-beta.102`, while the canonical
`effect` subtree has advanced to `4.0.0-beta.103`. The Deno adapter, shared
platform package, SQL PostgreSQL package, and Effect Vitest helpers must remain
on the same Effect release.

## Decision

- Align `effect`, `@effect/platform-node-shared`, `@effect/sql-pg`, and
  `@effect/vitest` on `4.0.0-beta.103`.
- Update `vendor/effect-smol` from the Effect remote to commit
  `d1133e8f2bad96b059310a2b8f74cdd4db0a3381`.
- Pin the Deno adapter aliases in the separate root `import_map.json` to that
  same commit. Keep `deno.json` responsible for tasks and runtime/tooling
  configuration only.
- Regenerate `deno.lock` from the updated root `package.json`.
- Do not mix Effect beta.102 and beta.103 packages or adapter source.

## Consequences

- The application and vendored reference use one consistent Effect beta.
- The Deno adapter receives the upstream beta.103 implementation, including
  its current native Deno HTTP/runtime behavior.
- Future Effect updates must update the package versions, subtree revision,
  import-map aliases, lockfile, and validation together.

## Validation

- `deno task check` resolves the adapter through `import_map.json`.
- Full and contract test suites pass with the updated dependency graph.
- Boundary, migration, formatting, and lint checks pass.
