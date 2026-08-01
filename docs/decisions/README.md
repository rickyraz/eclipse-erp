# Architecture Decision Records

> **Related documents**
>
> - Canonical architecture:
>   [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - Documentation workflow:
>   [`../development/documentation-workflow.md`](../development/documentation-workflow.md)
> - ADR template: [`./0000-template.md`](./0000-template.md)

ADRs preserve why architectural choices were made. Canonical architecture documents describe the
current system; ADRs preserve decision history.

## Status Values

- Proposed
- Accepted
- Rejected
- Deprecated
- Superseded

## Index

| ADR                                                            | Decision                                             | Status   |
| -------------------------------------------------------------- | ---------------------------------------------------- | -------- |
| [`0001`](./0001-use-modular-monolith.md)                       | Use a modular monolith                               | Accepted |
| [`0002`](./0002-use-effect-deno-and-drizzle.md)                | Use Effect, Deno, and Drizzle                        | Accepted |
| [`0003`](./0003-postgresql-is-transactional-truth.md)          | PostgreSQL is transactional truth                    | Accepted |
| [`0004`](./0004-separate-events-jobs-and-workflows.md)         | Separate events, jobs, and workflows                 | Accepted |
| [`0005`](./0005-use-ltree-and-sql-pgq-selectively.md)          | Use `ltree` and SQL/PGQ selectively                  | Accepted |
| [`0006`](./0006-use-capability-based-authorization.md)         | Use scoped capability authorization                  | Accepted |
| [`0007`](./0007-adopt-tiered-plugin-trust.md)                  | Adopt tiered plugin trust                            | Accepted |
| [`0008`](./0008-gate-zig-behind-benchmarks.md)                 | Gate Zig behind benchmarks                           | Accepted |
| [`0009`](./0009-use-solidjs-2.md)                              | Use SolidJS 2.0 for the frontend                     | Accepted |
| [`0010`](./0010-use-vite-solidjs-spa.md)                       | Use a Vite-based SolidJS SPA                         | Accepted |
| [`0011`](./0011-financial-ledger-engine.md)                    | Financial ledger execution engine                    | Accepted |
| [`0012`](./0012-use-drizzle-schema-flow-and-effect-http.md)    | Use the Drizzle schema flow and Effect-native HTTP   | Accepted |
| [`0013`](./0013-version-external-standard-adapters.md)         | Isolate external standards behind versioned adapters | Accepted |
| [`0014`](./0014-separate-internal-and-external-identifiers.md) | Separate internal identity from external identifiers | Accepted |
| [`0015`](./0015-one-semantic-owner-per-invariant.md)           | Assign one semantic owner per invariant              | Accepted |
| [`0016`](./0016-isolate-jurisdiction-localization.md)          | Isolate localization from primitive cores            | Accepted |

Accepted ADRs must not be rewritten to alter history. Create a new ADR and use `Supersedes`.
