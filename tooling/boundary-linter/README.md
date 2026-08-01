# Boundary linter

`ast-grep` enforces TypeScript package-boundary rules. The Deno checker validates
`db/ownership.toml` and migration ownership headers.

Install the CLI once:

```sh
cargo install ast-grep --locked
```

Run:

```sh
deno task boundary:test
deno task boundary:lint
```
