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

| ADR                                                                  | Decision                                                        | Status     |
| -------------------------------------------------------------------- | --------------------------------------------------------------- | ---------- |
| [`0001`](./0001-use-modular-monolith.md)                             | Use a modular monolith                                          | Accepted   |
| [`0002`](./0002-use-effect-deno-and-drizzle.md)                      | Use Effect, Deno, and Drizzle                                   | Accepted   |
| [`0003`](./0003-postgresql-is-transactional-truth.md)                | PostgreSQL is transactional truth                               | Accepted   |
| [`0004`](./0004-separate-events-jobs-and-workflows.md)               | Separate events, jobs, and workflows                            | Accepted   |
| [`0005`](./0005-use-ltree-and-sql-pgq-selectively.md)                | Use `ltree` and SQL/PGQ selectively                             | Accepted   |
| [`0006`](./0006-use-capability-based-authorization.md)               | Use scoped capability authorization                             | Accepted   |
| [`0007`](./0007-adopt-tiered-plugin-trust.md)                        | Adopt tiered plugin trust                                       | Accepted   |
| [`0008`](./0008-gate-zig-behind-benchmarks.md)                       | Gate Zig behind benchmarks                                      | Accepted   |
| [`0009`](./0009-use-solidjs-2.md)                                    | Use SolidJS 2.0 for the frontend                                | Accepted   |
| [`0010`](./0010-use-vite-solidjs-spa.md)                             | Use a Vite-based SolidJS SPA                                    | Accepted   |
| [`0011`](./0011-financial-ledger-engine.md)                          | Financial ledger execution engine                               | Accepted   |
| [`0012`](./0012-use-drizzle-schema-flow-and-effect-http.md)          | Use the Drizzle schema flow and Effect-native HTTP              | Accepted   |
| [`0013`](./0013-version-external-standard-adapters.md)               | Isolate external standards behind versioned adapters            | Accepted   |
| [`0014`](./0014-separate-internal-and-external-identifiers.md)       | Separate internal identity from external identifiers            | Accepted   |
| [`0015`](./0015-one-semantic-owner-per-invariant.md)                 | Assign one semantic owner per invariant                         | Accepted   |
| [`0016`](./0016-isolate-jurisdiction-localization.md)                | Isolate localization from primitive cores                       | Accepted   |
| [`0017`](./0017-use-effect-platform-deno.md)                         | Use the canonical Effect Deno adapter                           | Accepted   |
| [`0018`](./0018-adopt-typed-process-studio.md)                       | Adopt a typed, domain-aware Process Studio                      | Accepted   |
| [`0019`](./0019-adopt-integration-surface-profile.md)                | Adopt a typed external integration surface profile              | Accepted   |
| [`0020`](./0020-adopt-capability-release-and-runtime-governance.md)  | Adopt capability release and runtime governance                 | Accepted   |
| [`0021`](./0021-define-p0-scope-and-identity-model.md)               | Define the P0 scope and identity model                          | Accepted   |
| [`0022`](./0022-update-effect-v4-to-beta-103.md)                     | Update Effect v4 and Deno adapter to beta.103                   | Accepted   |
| [`0023`](./0023-adopt-capability-oriented-plugin-contribution.md)    | Adopt capability-oriented plugin contribution                   | Accepted   |
| [`0024`](./0024-adopt-effect-schema-as-canonical-contract-schema.md) | Adopt Effect Schema as the canonical contract schema            | Accepted   |
| [`0025`](./0025-introduce-stateful-entity-runtime.md)                | Introduce a Stateful Entity Runtime                             | Accepted   |
| [`0026`](./0026-evaluate-celld-runtime-adapter.md)                   | Evaluate `celld` as the distributed runtime adapter             | Proposed   |
| [`0027`](./0027-adopt-postgresql-first-replaceable-search.md)        | Adopt PostgreSQL-first, replaceable search                      | Accepted   |
| [`0028`](./0028-complete-p0-identity-party-and-branch-metadata.md)   | Complete P0 identity-party and branch metadata boundaries       | Accepted   |
| [`0029`](./0029-rename-user-and-party-public-vocabulary.md)          | Rename user and Party public vocabulary                         | Accepted   |
| [`0030`](./0030-user-account-lifecycle-and-tenant-membership.md)     | Separate UserAccount lifecycle from tenant membership           | Accepted   |
| [`0031`](./0031-capability-naming-and-business-verb-conventions.md)  | Define capability naming and business verb conventions          | Accepted   |
| [`0032`](./0032-order-confirmation-cross-domain-workflow.md)         | Define atomic Sales + Inventory + Accounting order confirmation | Superseded |
| [`0033`](./0033-extend-order-lifecycle-and-gate-pgque.md)            | Extend order lifecycle and gate PgQue activation                | Accepted   |
| [`0034`](./0034-adopt-non-interference-overload-isolation.md)        | Adopt non-interference as the overload-isolation target         | Accepted   |
| [`0035`](./0035-define-p1-inventory-primitives.md)                   | Define the P1 inventory primitive baseline                      | Accepted   |
| [`0036`](./0036-define-p2-document-and-financial-baseline.md)        | Define the P2 document and financial baseline                   | Accepted   |
| [`0037`](./0037-define-p3-audit-event-and-delivery-boundary.md)      | Define the P3 audit, event, and delivery boundary               | Accepted   |
| [`0038`](./0038-move-internal-event-delivery-to-messaging.md)        | Move internal event delivery ownership to Messaging             | Accepted   |

Accepted ADRs must not be rewritten to alter history. Create a new ADR and use `Supersedes`.
