# Testing Strategy

> **Status:** Canonical
>
> **Owns:** Public contract tests, module integration tests, architecture tests,
> database-invariant tests, and test-layer conventions.
>
> **Related documents**
>
> - Architecture enforcement: [`../architecture/architecture-enforcement.md`](../architecture/architecture-enforcement.md)
> - Active architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - Authorization architecture: [`../architecture/authorization.md`](../architecture/authorization.md)
> - Database roles: [`../operations/database-roles.md`](../operations/database-roles.md)
> - Agent rules: [`../../AGENTS.md`](../../AGENTS.md)

## Testing Principles

Tests should verify observable behavior and protected invariants rather than
duplicating implementation details.

Every behavioral change should select the smallest useful combination of:

- pure unit tests;
- public contract tests;
- module integration tests;
- database invariant tests;
- architecture tests;
- frontend component tests;
- end-to-end workflow tests.

## Test Framework

All TypeScript tests use `@effect/vitest` and run through Deno tasks. Effect
programs, including scoped resources, use `it.effect`; pure synchronous tests
use regular `it`. Tests return Effects directly rather than invoking Effect
runtime runners. Test discovery is limited to `apps/`, `packages/`, and
`tests/`; vendored reference trees are excluded. The contract-test configuration
discovers every `packages/**/tests/**/*.test.*` test plus architecture tests, so
adding a domain package does not require registering it in `deno.json`.
Structural `ast-grep` YAML rule tests remain on the `ast-grep` runner.

## Public Contract Tests

The first public user-account contract implementation is `packages/identity/mod.ts`, with
behavioral tests under `packages/identity/tests/`. Each exported domain contract
must test:

- successful behavior;
- every public tagged business error;
- input decoding and validation;
- authorization behavior;
- transaction rollback behavior;
- idempotency where applicable;
- compatibility guarantees where versioned contracts exist.

Contract tests must import only from the package's public entry point.

They must not import:

- internal repositories;
- private table definitions;
- internal constructors;
- migration helpers;
- implementation-only Effect layers.

Example:

```ts
import {
  InventoryService,
  StockUnavailable,
  ReserveStock,
} from "@eclipse/inventory"
```

## Module Integration Tests

Module integration tests verify the owning module against real infrastructure
or a production-equivalent test layer.

They should cover:

- transaction boundaries;
- concurrency conflicts;
- database constraints;
- domain-event publication;
- rollback after failure;
- tenant isolation;
- retry-safe behavior.

## Cross-Module Transaction Tests

When several modules participate in one PostgreSQL transaction, tests must
verify:

- all changes commit together;
- one failure rolls back all participating changes;
- no module writes directly to another module's tables;
- public tagged failures remain visible to the caller;
- event publication is atomic with domain mutation.

## Database Invariant Tests

Critical database invariants require executable tests.

Examples:

- journal entries remain balanced;
- immutable ledger facts cannot be updated in place;
- inventory quantities cannot violate protected constraints;
- tenant identifiers remain aligned across composite foreign keys;
- duplicate external identifiers are rejected within their declared scope;
- forbidden fiscal-period mutations fail;
- RLS isolates tenants under application roles.

## Authorization Tests

For every high-risk action, test:

- explicit allow;
- default deny;
- scope mismatch;
- suspended or disabled principal;
- static Separation of Duties;
- dynamic Separation of Duties;
- explanation metadata;
- RLS defense in depth.

Frontend visibility tests do not replace server authorization tests.

## Architecture Tests

The current architecture tests validate schema ownership through
`tests/architecture/ownership.test.ts` and validate TypeScript boundaries through
`ast-grep` rule tests. Architecture tests must verify:

- packages import only approved dependencies;
- private internals are not imported cross-domain;
- dependency cycles do not exist;
- tracked public call edges resolve through package public contracts;
- database schema ownership is respected;
- frontend code does not import backend implementation;
- public packages do not leak persistence models.

These tests complement the static boundary linter.

## Event and Job Tests

Event consumers and jobs must test:

- duplicate delivery;
- retry;
- poison-message handling;
- cursor or lease behavior;
- crash recovery;
- idempotency;
- correlation metadata;
- dead-letter behavior.

## Durable Workflow Tests

Checkpointed workflows must test:

- resumption from each step;
- retry exhaustion;
- timeout;
- cancellation;
- compensation where defined;
- duplicate start requests;
- operator-visible progress.

## Process Studio Tests

The Process Studio must test the smallest applicable combination of:

- Typed Action and Event Catalog identity, ownership, stability, versioning, schemas, and
  contributor authorization;
- catalog compatibility with public domain contracts;
- deterministic Process IR serialization, checksums, and version compatibility;
- static validation of graph structure, schemas, mappings, capabilities, tenant
  scope, transition ordering, idempotency, event filters, parallel effects, and
  compensation coverage;
- pure decision determinism and rejection of hidden I/O or mutable state;
- immutable released definitions, explicit environment deployment, and exact instance version
  pinning;
- capability release compatibility and deprecated/retired action behavior;
- lost-response and unknown-outcome recovery without duplicate domain effects;
- duplicate event delivery and durable event-wait registration;
- execution principal, delegated authority, Separation of Duties, human-task authorization, and
  duplicate completion;
- timer, cancellation, retry, crash-recovery, and operator recovery behavior;
- compensation ordering, idempotency, authorization, retry, and audit;
- explicit manual recovery when a committed action has no compensation;
- tenant and organization isolation throughout design and runtime state;
- business/technical correlation, monitor redaction, and operational-control authorization;
- equivalence of visual, keyboard, and structured editing output;
- BPMN import/export translation through Process IR with unsupported semantics
  rejected explicitly.

Each important process invariant needs at least one proof mechanism. Do not add
all test categories automatically when they do not prove a relevant invariant.
The canonical semantics and delivery gates are defined in
[`../architecture/process-studio.md`](../architecture/process-studio.md).

## Frontend Tests

SolidJS 2.0 tests should focus on:

- user-visible behavior;
- contract decoding;
- form validation;
- keyboard interaction;
- accessible labels and errors;
- loading, empty, success, and failure states;
- critical ERP workflows;
- validated URL search state;
- query-key stability and invalidation behavior;
- large-table pagination and virtualization behavior.

Do not test incidental signal or memo implementation details.

## Test Layers

Every Effect service should provide an explicit production layer and, where
useful, deterministic test layers.

Test layers must not silently weaken:

- authorization;
- transaction semantics;
- validation;
- concurrency behavior;
- tagged failures.

## Required CI Stages

```text
format
lint
typecheck
unit tests
public contract tests
architecture tests
database integration tests
frontend tests
build
```

Risky database or workflow changes may require additional migration and recovery
stages.

## Completion Criteria

A change is complete when:

- relevant behavior is tested;
- failure paths are tested;
- architecture checks pass;
- database invariants remain protected;
- skipped validation is explicitly reported.
