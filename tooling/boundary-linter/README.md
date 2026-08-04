# Boundary linter

`ast-grep` enforces structural TypeScript rules. Deno checkers validate `db/ownership.toml`,
migration headers, cross-package public-entrypoint imports, and package dependency cycles.

Install the CLI once:

```sh
cargo install ast-grep --locked
```

Run:

```sh
deno task boundary:test
deno task boundary:lint
```

`boundary:lint` runs:

- `tooling/boundary-linter/check-ownership.ts`;
- `tooling/dependency-graph/check.ts`;
- `tooling/call-graph/check.ts`.

The call-graph checker is deliberately conservative. It records direct calls to local functions and
callable names imported from another package's public `mod.ts`. It does not pretend to resolve
Effect dependency injection, callbacks, reflection, or other runtime-indirect calls.
