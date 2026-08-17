# Financial Ledger Execution Roadmap

> **Status:** Canonical roadmap subdocument
>
> **Owns:** sequencing, implementation dependencies, readiness gates, and cutover steps for the
> required TigerBeetle financial execution profile.
>
> **Detailed authority and runtime rules belong to:** [`../architecture/financial-ledger.md`](../architecture/financial-ledger.md)
> and [`../decisions/0040-adopt-tigerbeetle-financial-ledger.md`](../decisions/0040-adopt-tigerbeetle-financial-ledger.md).

> **Related documents**
>
> - Roadmap index: [`./README.md`](./README.md)
> - Financial ledger architecture: [`../architecture/financial-ledger.md`](../architecture/financial-ledger.md)
> - Ledger decision: [`../decisions/0040-adopt-tigerbeetle-financial-ledger.md`](../decisions/0040-adopt-tigerbeetle-financial-ledger.md)
> - P2 financial baseline: [`../decisions/0036-define-p2-document-and-financial-baseline.md`](../decisions/0036-define-p2-document-and-financial-baseline.md)
> - State and consistency: [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
> - Durable execution: [`../architecture/durable-execution.md`](../architecture/durable-execution.md)
> - Testing strategy: [`../development/testing.md`](../development/testing.md)

## Goal

Make TigerBeetle the required execution engine for accepted financial transfers without turning it
into an ERP database, introducing a live dual-authority model, or silently destroying the current
PostgreSQL transaction guarantees.

The first production profile is deliberately small:

```text
Accounting P2 baseline
  -> account execution mapping
  -> journal posting
  -> revenue posting
  -> correcting/reversal transfer
```

It keeps the current Legal Entity, fixed two-decimal, base-currency, open-period baseline. Pending
transfers, payments, settlement, credit limits, budgets, multi-currency, tax, AP/AR, valuation, and
inventory quantity remain separate decisions.

## What Changes

| Area | Current posture | Target posture | Required work |
| --- | --- | --- | --- |
| Financial authority | PostgreSQL journal rows and balances are the current implementation authority | TigerBeetle is authoritative for accepted transfers, balances, and transfer history | Define the cutover boundary and prohibit competing authorities |
| Accounting contract | Service validates and writes PostgreSQL journal tables directly | Accounting owns policy and calls `FinancialLedgerPort` | Add semantic port and stable operation outcomes |
| Transaction boundary | Journal and event can commit in one PostgreSQL transaction | PostgreSQL intent and TigerBeetle acceptance are separate durable steps | Add operation protocol, retry, unknown-outcome, and recovery state |
| Identity | Journal reference/idempotency is PostgreSQL-local | Account and transfer IDs are deterministic across retries | Version the encoding and mapping |
| Journal data | PostgreSQL rows are treated as financial facts | PostgreSQL rows are metadata/projection with TigerBeetle provenance | Add rebuild and reconciliation behavior |
| Worker path | Request/service performs the PostgreSQL mutation | Durable job/workflow submits and reconciles the TigerBeetle operation | Use the job table or an approved durable workflow, never an Effect fiber |
| Cross-domain workflows | Existing order flow relies on one PostgreSQL transaction | Any TB-backed cross-domain flow needs an explicit accepted/pending/compensation contract | Revisit order confirmation in a separate ADR before migration |
| Operations | PostgreSQL-only deployment and recovery | Trusted TigerBeetle adapter, isolated credentials, backup/restore and no-fallback runbook | Add deployment and failure evidence |
| Reporting | Reads PostgreSQL financial tables | Reads rebuildable PostgreSQL projection backed by TigerBeetle facts | Preserve audit links and reproducibility |

## Implementation Surface

The implementation should change the fewest owners necessary:

- **`packages/accounting`**: keep account, period, posting, reversal, authorization, and policy
  semantics; replace direct financial execution with the public port; expose stable accepted,
  rejected, unknown, and recovery outcomes where the command contract requires them.
- **Kernel/infrastructure**: own the trusted TigerBeetle client lifecycle, configuration, batching,
  provider failure mapping, and network boundary. No TigerBeetle type crosses into Accounting.
- **`apps/worker` with the approved `process.jobs` owner**: lease durable financial submission and
  reconciliation work. The worker invokes Accounting's public finalize/reconcile command; it never
  writes Accounting, Process, or Messaging tables directly. A worker must re-enter command admission
  and authorization for any business command; adapter submission itself uses the narrow trusted
  capability.
- **Accounting-owned PostgreSQL schema**: persist operation intent, deterministic mapping,
  observed outcome, projection provenance, and reconciliation state only when the contract proves
  those records are needed. Do not create a generic cross-domain ledger schema.
- **`db/ownership.toml`**: remains unchanged if these records stay Accounting-owned. A new schema or
  package requires its own ownership decision before migration.
- **Reporting/audit paths**: consume PostgreSQL projections with TigerBeetle IDs and mapping
  versions; do not calculate an independent authoritative balance.
- **Deployment/operations**: add TigerBeetle endpoint, credential, network, backup, restore,
  upgrade, health, capacity, and adapter-exit procedures only after the adapter contract is stable.
- **Tests**: retain current PostgreSQL transition tests while the profile is transitional, then add
  adapter contract, fault-injection, replay, reconciliation, and cutover proofs.

Do not add a TigerBeetle dependency in the documentation/contract phases. Add the pinned client only
when the trusted adapter phase has an approved compatibility and operational target.

## Execution Sequence

### Phase 0 — Decision and authority baseline — complete in this change

Deliverables:

- superseding ADR-0040;
- canonical financial-ledger architecture;
- authority matrix;
- explicit transition from PostgreSQL implementation to TigerBeetle execution;
- roadmap and hard activation gates.

Exit gate:

```text
[x] no document describes PostgreSQL and TigerBeetle as co-authorities
[x] current P2 scope remains bounded
[x] existing cross-domain PostgreSQL atomicity is not silently reinterpreted
```

### Phase 1 — Freeze the first profile and contract

Define before writing an adapter:

- exact first-profile commands and queries;
- `FinancialLedgerPort` success and failure model;
- operation state transitions and caller-visible semantics;
- authority matrix and tenant/Legal Entity scope;
- deterministic account/transfer ID encoding and mapping version;
- event timing: no accepted financial event before TigerBeetle acceptance is durable;
- unknown-outcome, timeout, outage, and manual-recovery behavior;
- period-close, account-mapping, authorization-revocation, and policy-version races;
- authoritative-current versus bounded-stale balance/reporting reads;
- reconciliation anchor/checkpoint and restore correspondence;
- capability and authorization boundary for adapter submission.

Exit gate:

```text
[ ] contract tests can run without TigerBeetle
[ ] no provider type or provider failure appears in a public domain contract
[ ] the contract does not claim cross-store ACID
[ ] current P2 Accounting actions have an explicit migration status
```

### Phase 2 — Durable intent and projection model

Add only the control-plane persistence required by Phase 1:

- operation intent and idempotency identity;
- account and transfer mapping;
- submission/outcome state and retry metadata;
- TigerBeetle provenance and mapping version;
- projection/reconciliation status;
- manual-recovery/quarantine reason.

Use Accounting ownership for Accounting facts. Keep migrations generated/reviewed according to the
existing Drizzle process. Existing PostgreSQL journal history is not rewritten; its transition to a
projection is represented by provenance and a cutover boundary.

Exit gate:

```text
[ ] retry state survives process restart
[ ] duplicate intent cannot create two logical operations
[ ] PostgreSQL failure before/after submission has a recorded recovery path
[ ] projection can be rebuilt from the recorded source mapping
```

### Phase 3 — Test adapter and failure proof

Implement a deterministic in-memory/test adapter against the port before connecting to TigerBeetle.
Prove:

- duplicate submission and compatible replay;
- conflicting replay;
- lost response followed by same-ID lookup;
- process death before and after acceptance;
- PostgreSQL failure before and after acceptance;
- rejected transfer;
- account/amount/ledger mismatch;
- linked transfer all-or-nothing behavior;
- reversal as a new operation;
- reconciliation, quarantine, and manual recovery;
- projection lag and duplicate event behavior.

Use repository testing rules: `@effect/vitest`, `it.effect` for Effects, no `Effect.runPromise` or
`Effect.runSync` in tests, and scoped cleanup for external resources.

Exit gate:

```text
[ ] contract and failure tests pass without a live engine
[ ] every retryable path has one deterministic identity
[ ] no test relies on process exit for cleanup
[ ] failure matrix matches the canonical architecture
```

### Phase 4 — Trusted TigerBeetle adapter

Only after the contract and test adapter gates pass:

1. Select and pin the supported client dependency in the root manifest.
2. Install/update `deno.lock` through the repository dependency workflow.
3. Implement the client lifecycle and provider-error mapping in kernel/infrastructure.
4. Enforce the trusted network and credential boundary.
5. Map EclipseERP accounts to TigerBeetle accounts with deterministic IDs.
6. Compile balanced journals into transfers and linked chains.
7. Validate batching, ordering, balance constraints, and duplicate submission against an isolated
   TigerBeetle environment.
8. Keep provider status and raw causes out of public DTOs while retaining internal diagnostics.

Exit gate:

```text
[ ] provider compatibility and client behavior are pinned and reviewed
[ ] adapter contract tests pass against the isolated engine
[ ] timeout/retry/duplicate semantics are proven
[ ] linked posting and reversal mappings are proven
[ ] no domain package imports TigerBeetle
```

### Phase 5 — Projection and reconciliation

Connect accepted engine outcomes to PostgreSQL control-plane records:

- mark the operation accepted only after TigerBeetle acceptance is known;
- invoke the Accounting public finalize/reconcile command, which updates journal/reporting projections
  with engine provenance and calls the public Messaging contract in the same PostgreSQL transaction;
- publish accepted events from durable PostgreSQL intent;
- reconcile accepted-but-unprojected operations;
- quarantine missing, duplicate, conflicting, or mismatched mappings;
- expose lag, unknown outcomes, rejection, retry, and manual-recovery metrics.

Do not use reconciliation to mutate a transfer or invent a balancing entry. An authorized reversal
is the only correction path for an accepted financial movement.

Exit gate:

```text
[ ] projection is rebuildable from TigerBeetle facts plus PostgreSQL metadata
[ ] reconciliation is idempotent and fail-closed on mismatch
[ ] reports reproduce the expected balance and transfer history
[ ] no PostgreSQL balance is used as a competing financial authority
```

### Phase 6 — Isolated replay and cutover rehearsal

The first cutover uses an explicit, non-overlapping authority boundary. The default is:

- PostgreSQL remains an immutable historical archive for journals before the cutover boundary;
- TigerBeetle receives verified opening balances and owns every selected operation after the boundary;
- reports union both ranges with source provenance and never present them as two authorities for the
  same operation;
- importing all historical transfers into TigerBeetle is optional and requires a separate ordering,
  timestamp, and replay proof before it replaces the opening-balance model;
- first-profile corrections cannot reverse across the boundary; that requires a later correction
  decision covering period, archive reference, opening-balance effect, and reconciliation.

Before production activation:

1. Freeze the selected Legal Entity/profile for the migration window.
2. Export and verify the PostgreSQL opening state and historical scope.
3. Replay/import the approved history into an isolated TigerBeetle environment using deterministic
   IDs and the documented ordering rules.
4. Compare account balances, transfer groups, reversals, and projection totals.
5. Rehearse restore from corresponding backups and recovery from each failure point.
6. Rehearse an adapter exit as forward-only recovery: no accepted TigerBeetle transfer is deleted or
   rewritten to return to PostgreSQL.
7. Define treatment of in-flight `intent`, `submitted`, and `unknown` operations.
8. Define a recovery watermark/checkpoint, deterministic-ID comparison, orphan quarantine, and the
   rule that independently restored stores cannot resume normal posting.

Exit gate:

```text
[ ] opening balances and historical replay are signed off
[ ] restore and outage runbooks are executable
[ ] recovery watermark and cross-store restore comparison are proven
[ ] in-flight operation treatment is explicit
[ ] adapter exit does not require deleting financial history
[ ] cutover has a bounded scope and an owner
```

### Phase 7 — Scoped production activation

Activate one explicit profile scope, such as a Legal Entity or tenant cohort. During activation:

- all mutations for the selected financial invariant use TigerBeetle;
- there is no live PostgreSQL mirror and no silent fallback;
- Accounting authorization and period policy remain in PostgreSQL/domain services;
- accepted-but-unreconciled work is observable and fenced where required;
- retries use the same operation identity;
- the old PostgreSQL path remains disabled for the selected invariant, not chosen per request.

Keep the existing PostgreSQL profile for scopes that have not passed cutover. This is a transition
boundary, not permission to route one logical invariant to two engines.

Exit gate:

```text
[ ] pilot SLOs and failure objectives pass
[ ] no duplicate accepted transfer is observed
[ ] reconciliation lag and manual recovery are within reviewed limits
[ ] authorization, tenant, audit, and reporting proofs pass
[ ] rollback is a forward-only recovery procedure
```

### Phase 8 — Composite workflow migration — separate decision

Revisit ADR-0033 and the current Process workflow before moving its Accounting step. Choose one
explicit model:

- keep the workflow on the transitional PostgreSQL Accounting profile until a complete cutover; or
- redesign it as a durable accepted/pending/reconciled process with idempotent steps,
  compensation/manual recovery, and no claim of one PostgreSQL transaction.

Do not make this change by swapping a Layer or adapter binding. A later ADR must define the new
cross-domain contract, event timing, failure semantics, and user-visible result.

## Global Activation Checklist

```text
[ ] authority matrix approved
[ ] first profile scope approved
[ ] FinancialLedgerPort and failures are public-contract tested
[ ] deterministic ID mapping is versioned and collision-tested
[ ] durable intent and idempotency survive restart
[ ] test adapter proves all failure points
[ ] trusted adapter is isolated and provider-compatible
[ ] linked, reversal, balance, and batch behavior are proven
[ ] PostgreSQL projections are rebuildable and non-authoritative
[ ] reconciliation, quarantine, alerts, and manual recovery are operational
[ ] backup/restore/upgrade/exit rehearsals pass
[ ] historical replay/opening balance is verified
[ ] no silent PostgreSQL fallback exists for the activated profile
[ ] every cross-domain workflow has its own accepted consistency decision
```

## Explicit Non-Goals

This roadmap does not implement a generic TigerBeetle API, a financial reporting warehouse,
PostgreSQL/TigerBeetle live mirroring, payment/settlement semantics, multi-currency, tax, AP/AR,
wallets, budget policy, inventory quantity truth, or a new workflow engine.
