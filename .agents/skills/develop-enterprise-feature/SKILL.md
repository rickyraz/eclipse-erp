---
name: develop-enterprise-feature
description: "Use for terse business-capability requests such as add warehouse transfers, add purchase returns, add customer credit limits, implement an ERP workflow, or buat/tambahkan fitur bisnis; expand intent from repository evidence into the smallest complete contract, compose relevant Skills, implement, and validate without speculative ERP behavior."
---

# Purpose

Turn a small business request into the minimum complete, repository-compliant ERP feature. This is an orchestration Skill: it discovers the feature contract and routes implementation to focused Skills rather than duplicating their mechanics.

# Use This Skill When

- a request describes business intent more than files or code, such as “add warehouse transfers” or “support purchase returns”;
- a new command, workflow, policy, or stateful ERP capability may cross schema, authorization, transactions, public contracts, or HTTP;
- the request is terse in English or Indonesian: `add`, `implement`, `support`, `create`, `we need`, `buat fitur`, `tambahkan`, or `implementasikan`.

Start here for a new business capability even when the final owner is an existing package. Compose only the lower-level Skills that the feature actually needs.

# Do Not Use This Skill When

- the change is mechanical: rename, typo, formatting, static text, dependency version, or a refactor with no business behavior;
- the user has explicitly supplied a complete contract and only one lower-level workflow remains;
- the request is only a schema, API, authorization, or transaction change with no feature-intent discovery needed; use that focused Skill directly.

# Required Context

Inspect only the relevant repository context before designing:

1. Source of truth: accepted superseding ADRs, then [`architecture-spec-v4.md`](../../../docs/architecture/architecture-spec-v4.md), then the owning subsystem documentation.
2. Ownership: [`db/ownership.toml`](../../../db/ownership.toml), relevant `packages/*/mod.ts`, schema files, public services, and neighboring implementations.
3. Contracts and enforcement: related tests, [`architecture-enforcement.md`](../../../docs/architecture/architecture-enforcement.md), authorization rules, transaction conventions, and existing Skills under this directory.
4. Existing vocabulary: use the repository’s names, identifiers, errors, lifecycle states, package boundaries, and validation commands before inventing new ones.

Before designing a new implementation, find the closest existing business capability. Reuse its package layout, public-contract shape, error style, authorization style, transaction style, API style, and tests. Deviate only when the new invariant requires it, and record that deviation in the Architecture Delta.

Do not reread unrelated subsystems or copy an ERP product’s feature list into the repository.

# Architecture Rules

- Treat the developer’s words as the business intent, not as a complete technical specification.
- Classify each inferred requirement as `EXPLICIT`, `REPOSITORY_REQUIRED`, `DOMAIN_REQUIRED`, `ENTERPRISE_BASELINE`, `OPTIONAL`, or `UNKNOWN`.
- Every non-`EXPLICIT` requirement must have an evidence source and confidence recorded internally:

  ```text
  requirement | classification | evidence | confidence | action
  ```

  If there is no evidence, classify the idea as `OPTIONAL` or `UNKNOWN`; do not implement it. `ENTERPRISE_BASELINE` is valid only when a concrete correctness consequence makes it relevant to this feature.
- Infer only from, in order: the request, repository architecture, ADRs/canonical docs, domain invariants, nearest-neighbor implementations, public contracts/schemas, tests/tooling, and ERP semantics necessary for internal correctness.
- Implement `EXPLICIT`, `REPOSITORY_REQUIRED`, `DOMAIN_REQUIRED`, and applicable evidence-backed `ENTERPRISE_BASELINE` behavior. Keep `OPTIONAL` behavior out of scope and surface material `UNKNOWN` decisions instead of guessing.
- Give mutable business state one authoritative owner. Other domains use public contracts; they do not write another domain’s tables.
- Prefer existing Effect v4, Drizzle, tenant, authorization, transaction, error, API, migration, audit, and test patterns. Do not create a parallel framework or speculative extension point.
- Do not introduce a new domain, architectural layer, infrastructure abstraction, event mechanism, workflow engine, generic repository, state-machine framework, or authorization mechanism when an existing paved road can implement the feature correctly.
- If an existing paved road is insufficient, record the reason in the Architecture Delta and create an ADR before introducing a difficult-to-reverse primitive.
- Use database constraints for guarantees the database can enforce. Application validation improves errors but does not replace constraints.
- Do not invent legal, tax, fiscal, payroll, localization, or jurisdiction-specific behavior. International-ready structure is not permission to implement every country’s rules.
- Do not add accounting entries, events, jobs, workers, shipment stages, lots, serials, valuation, notifications, documents, or approvals unless repository evidence or the request requires them.
- Keep the Feature Contract internal and compact. Do not persist it as a new repository document unless it is a long-lived architectural or business contract with no existing canonical owner.

# Workflow

## 1. Interpret

Rewrite the terse request as one business capability sentence. Identify the business objects, actors, commands, consequential effects, and whether the feature changes mutable state.

## 2. Inspect the Nearest Neighbor First

Find the closest existing capability by business effect, not just by table name. Then inspect its:

- package layout and public `mod.ts` contract;
- schemas, constraints, and migration path;
- typed errors and authorization capabilities;
- transaction, locking, retry, and idempotency behavior;
- API commands/queries and contract tests.

Use this implementation as the default template. Record what stays unchanged and only design the required delta.

## 3. Build the Evidence Ledger

For every important inference, record an internal ledger entry:

```text
Requirement: atomic confirmation
Classification: DOMAIN_REQUIRED
Evidence: stock mutation + existing DatabaseService.transaction convention
Confidence: high
Action: implement

Requirement: approval workflow
Classification: OPTIONAL
Evidence: none
Confidence: low
Action: omit
```

A phrase such as “enterprise ERP usually does this” is not evidence. If a baseline has no concrete effect on correctness, authorization, audit, tenant isolation, or the requested business outcome, do not implement it.

## 4. Derive the Feature Contract and Architecture Delta

Keep this internal and compact. Include only relevant sections:

```text
Feature:
Evidence ledger:
Owning domain:
Participating domains and approved contracts:
Actors and capabilities:
Business objects and tenant/organization scope:
Minimum lifecycle and valid commands:
Queries, if required:
Business invariants and database constraints:
Transactional boundary, locks, retries, and idempotency:
Auditability and traceability:
Accounting/inventory consequences:
API surface:
Persistence and migration implications:
Typed failures:
Out of scope:
Unknowns that block safe implementation:

Architecture Delta
Existing capability/pattern:
Required new behavior/files:
Unchanged architecture:
New primitive required? If yes, reason and ADR:
```

The goal is to implement a delta against the existing architecture, not redesign a subsystem. Do not create a permanent Feature Contract document unless the completion criteria above require a new canonical contract.

## 5. Define Transition Contracts

If the operation has meaningful states, write the smallest state machine and a transition contract before persistence:

```text
Transition | Preconditions | Side effects | Authorization | Retry/idempotency
DRAFT -> CONFIRMED | stock sufficient | deduct source | transfer.confirm | safe retry
CONFIRMED -> COMPLETED | confirmed | credit destination | transfer.complete | safe retry
```

Reject invalid transitions explicitly. State names alone are insufficient: each transition must explain its precondition, business effects, permission, and duplicate-request behavior. Do not add states merely because a larger ERP might have them.

## 6. Evaluate Applicable Enterprise Baselines

For state-changing work, check only the relevant concerns and link each one to evidence:

- **Atomicity:** do all invariant-sensitive writes commit or roll back together?
- **Idempotency:** can retries duplicate stock, money, allocation, posting, closing, or other effects?
- **Concurrency:** can concurrent commands consume the same resource or cross a state boundary? Reuse existing locks, conditional updates, unique constraints, and ordering.
- **Authorization:** are read, create, modify, and irreversible transition capabilities distinct where the repository requires it?
- **Auditability:** does existing infrastructure require actor, tenant, timestamp, command, state change, or correlation data?
- **Tenant/organization scope:** can any reference or mutation cross an ownership boundary?
- **Accounting:** classify involvement as none, read-only, eventual, transactional, or unknown from existing accounting contracts. Never create journal entries by assumption.
- **Inventory:** when relevant, inspect on-hand, available, reserved, movement, warehouse/location, negative-stock, lot/serial, unit, and valuation concepts—but use only concepts the repository supports or the feature requires.

## 7. Identify Unknowns

Ask only when an unresolved choice materially changes business semantics and repository evidence cannot decide it. Stop rather than silently guessing when ownership conflicts, critical state has no authoritative owner, cross-domain atomicity has no approved contract, or jurisdiction-specific behavior is required but undefined.

If repository evidence is insufficient and external domain research would change the contract, do not improvise or silently browse for a preferred ERP design. Mark the decision `UNKNOWN` and use an approved research workflow if the repository provides one; otherwise ask the developer for the material business decision.

## 8. Route and Compose

Load only the applicable implementation Skills:

- new owner or package → [`create-domain-module`](../create-domain-module/SKILL.md);
- owned tables, constraints, or migrations → [`change-owned-schema`](../change-owned-schema/SKILL.md);
- public service, DTO, or tagged errors → [`expose-public-contract`](../expose-public-contract/SKILL.md);
- cross-domain behavior or facts → [`introduce-cross-domain-integration`](../introduce-cross-domain-integration/SKILL.md);
- protected business actions → [`add-authorization-capability`](../add-authorization-capability/SKILL.md);
- Effect HTTP commands or queries → [`add-api-endpoint`](../add-api-endpoint/SKILL.md);
- stock, balance, journal, idempotent, or multi-write invariants → [`implement-transactional-workflow`](../implement-transactional-workflow/SKILL.md);
- relational, unique, foreign-key, or concurrency validation → [`constraint-validation-strategy`](../constraint-validation-strategy/SKILL.md).

Do not mechanically invoke every Skill. The Feature Contract and Architecture Delta decide the composition.

## 9. Implement the Smallest Complete Slice

Follow the selected Skills and the nearest-neighbor paved road. Implement the minimum behavior that makes the requested capability internally correct, including applicable negative paths and typed failures. Keep optional enhancements in the out-of-scope list instead of scaffolding them “for later.”

## 10. Validate with Invariant Proofs

For every important invariant, choose at least one proof mechanism:

```text
Invariant: transfer cannot consume stock twice
Proof: idempotency test + protected state transition

Invariant: tenant references cannot cross boundaries
Proof: composite foreign key + contract test
```

Use the smallest applicable proof: database constraint, domain test, public contract test, rollback test, or concurrency test. Do not add every test category automatically when it does not prove a feature invariant.

## 11. Review and Report

Re-read the Feature Contract, Evidence Ledger, Architecture Delta, and transition contracts against the implementation. Verify that every inferred behavior has evidence, every deviation has a reason, and no optional ERP functionality was silently added. Update the canonical documentation owner or add an ADR only when the change introduces or changes a long-lived architectural decision.

# Deterministic Tools

Use existing tasks; do not invent equivalent commands. Validate progressively:

1. focused domain/unit tests;
2. affected public contract and API tests;
3. affected architecture, boundary, schema, and migration checks;
4. scoped type checking;
5. broader repository tests only when required by repository policy, CI impact, or the composed Skills.

Common commands:

```sh
deno task skills:check
deno task boundary:test
deno task boundary:lint
deno task test:contract
deno task test
deno task check
```

When applicable, also run `deno task db:check`, migration validation, focused PostgreSQL tests, API/contract tests, and the commands required by the composed Skills. Report unavailable build targets or blocked infrastructure instead of hiding them. Do not claim that a full suite is necessary when focused proof is sufficient, but do not skip checks required by CI or repository policy.

# Required Checks

- every non-`EXPLICIT` requirement has an evidence source, classification, confidence, and action;
- the nearest relevant implementation was inspected and the Architecture Delta is explicit;
- the requested capability exists under one clear semantic owner;
- the minimum lifecycle and transition contracts include preconditions, effects, authorization, and retry behavior when state matters;
- each important invariant has at least one concrete proof mechanism;
- applicable constraints, tenant boundaries, authorization, transactions, retries, and concurrency behavior are enforced;
- public cross-domain access uses approved package contracts;
- migrations, API contracts, boundary checks, and typed failure mappings follow repository policy;
- canonical documentation or an ADR is updated when the architecture changed;
- no optional ERP subsystem was silently introduced.

# Failure Conditions

Stop and report instead of implementing when:

- two authoritative sources or ADRs conflict without a documented resolution;
- no domain can own the critical invariant;
- the nearest-neighbor pattern cannot be reused and a new primitive would be required without an ADR;
- the design requires direct writes across domain boundaries or cross-tenant mutation;
- an atomic invariant cannot use the repository’s transaction boundary;
- a retryable effect has no safe idempotency strategy;
- a required legal or jurisdiction-specific rule would have to be invented;
- external domain research would materially change semantics but no approved research workflow exists;
- a material business decision remains `UNKNOWN`.

# Completion Criteria

```text
[ ] business intent was translated into a compact internal Feature Contract
[ ] every inference has evidence, classification, confidence, and action
[ ] nearest-neighbor implementation and Architecture Delta were recorded
[ ] ownership and relevant cross-domain contracts are correct
[ ] lifecycle transitions include preconditions, effects, authorization, and retry behavior
[ ] each important invariant has a proof mechanism
[ ] atomicity, idempotency, and concurrency protections are present when applicable
[ ] only relevant specialized Skills were composed
[ ] progressive tests and deterministic repository checks were run and reported
[ ] canonical documentation/ADR updates are complete when required
[ ] speculative ERP functionality was not added
```

# Related Skills

- [`create-domain-module`](../create-domain-module/SKILL.md)
- [`change-owned-schema`](../change-owned-schema/SKILL.md)
- [`expose-public-contract`](../expose-public-contract/SKILL.md)
- [`introduce-cross-domain-integration`](../introduce-cross-domain-integration/SKILL.md)
- [`add-authorization-capability`](../add-authorization-capability/SKILL.md)
- [`add-api-endpoint`](../add-api-endpoint/SKILL.md)
- [`implement-transactional-workflow`](../implement-transactional-workflow/SKILL.md)
- [`constraint-validation-strategy`](../constraint-validation-strategy/SKILL.md)

# References

- [`AGENTS.md`](../../../AGENTS.md)
- [Architecture specification](../../../docs/architecture/architecture-spec-v4.md)
- [Architecture enforcement](../../../docs/architecture/architecture-enforcement.md)
- [Authorization architecture](../../../docs/architecture/authorization.md)
- [PostgreSQL architecture](../../../docs/architecture/postgresql-19-architecture.md)
- [Testing strategy](../../../docs/development/testing.md)
- [ADR-0006: capability-based authorization](../../../docs/decisions/0006-use-capability-based-authorization.md)
- [ADR-0012: Drizzle schema flow and Effect HTTP](../../../docs/decisions/0012-use-drizzle-schema-flow-and-effect-http.md)
- [ADR-0015: one semantic owner per invariant](../../../docs/decisions/0015-one-semantic-owner-per-invariant.md)
