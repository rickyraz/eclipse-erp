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
- `tooling/dependency-graph/check.ts`.
