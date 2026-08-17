# Financial Ledger Architecture

> **Status:** Canonical
>
> **Owns:** financial authority, the financial execution boundary, cross-store outcome
> semantics, identity mapping, and reconciliation for the activated ledger profile.
>
> **Related documents**
>
> - Ledger decision: [`../decisions/0040-adopt-tigerbeetle-financial-ledger.md`](../decisions/0040-adopt-tigerbeetle-financial-ledger.md)
> - Previous ledger decision: [`../decisions/0011-financial-ledger-engine.md`](../decisions/0011-financial-ledger-engine.md)
> - State and consistency: [`./state-and-consistency.md`](./state-and-consistency.md)
> - PostgreSQL architecture: [`./postgresql-19-architecture.md`](./postgresql-19-architecture.md)
> - Durable execution: [`./durable-execution.md`](./durable-execution.md)
> - P2 financial baseline: [`../decisions/0036-define-p2-document-and-financial-baseline.md`](../decisions/0036-define-p2-document-and-financial-baseline.md)
> - Execution roadmap: [`../roadmap/financial-ledger-execution.md`](../roadmap/financial-ledger-execution.md)

## Position

TigerBeetle is the required target execution engine for EclipseERP financial movements. It is a
financial data plane, not an ERP database and not a reporting warehouse. PostgreSQL remains the
control-plane and non-ledger transactional database.

The repository is in a transition period until the first profile is activated. Existing
PostgreSQL-backed Accounting commands remain the current implementation during migration. The
provider-neutral `FinancialLedgerPort`, deterministic test adapter, and scoped TigerBeetle adapter
are implemented as an unactivated integration slice; they do not change the current Accounting
command path. They are not a reason to add a live PostgreSQL/TigerBeetle mirror, and no new command
may silently assume that both stores are authoritative.

A Legal Entity selects its route explicitly with `financial_engine`, which defaults to PostgreSQL
until the cutover gates are approved. Durable financial operations default their requested engine to
TigerBeetle, but historical rows are marked `engine_verified = false` during migration rather than
being treated as proven TigerBeetle work. Unverified, cross-engine, or routing-drifted operations
are fenced into manual recovery. Once any Legal Entity for a tenant is routed to TigerBeetle, the
legacy tenant-scoped PostgreSQL journal path is rejected rather than allowing two authorities.

## Authority Matrix

| Fact or responsibility | Authority | Notes |
| --- | --- | --- |
| Tenant, Legal Entity, account meaning, chart-of-accounts metadata | PostgreSQL / Accounting | Business identity and semantics, not TigerBeetle provider metadata |
| Fiscal periods, posting dates, posting policy, authorization | PostgreSQL / Accounting | Policy is evaluated before financial submission |
| Financial operation intent, command identity, retry state, workflow state | PostgreSQL | Durable control-plane state |
| Accepted debit-credit transfer and linked transfer chain | TigerBeetle | One financial authority for the activated profile |
| Pending, posted, and voided transfer state | TigerBeetle | Only where a decided capability uses pending transfers |
| Account balance and balance constraints | TigerBeetle | PostgreSQL may project values for reads |
| Immutable transfer history | TigerBeetle | PostgreSQL stores references and projections |
| Journal/document metadata and correction relationships | PostgreSQL / Accounting | Financial acceptance is derived from the mapped TigerBeetle operation |
| Audit references and reporting projection | PostgreSQL | Rebuildable from TigerBeetle facts plus control-plane metadata |
| Reconciliation state and mismatch quarantine | PostgreSQL / application operations | Reconciliation never creates an unapproved business correction |
| TigerBeetle client, transport, batching, and provider failures | Kernel/infrastructure | Never part of a domain public contract |

No row has two authorities. A PostgreSQL journal row or balance projection cannot authorize a new
financial movement by itself.

The first cutover must declare a non-overlapping authority boundary. The default migration posture
is an immutable PostgreSQL historical archive before the cutover boundary and TigerBeetle authority
for operations after it, with verified opening balances and source provenance in reports. A
post-cutover reversal may target only a post-cutover operation in the first profile. The
implementation additionally requires the source operation to be verified TigerBeetle-owned,
reconciled, in the same Legal Entity and currency, and locked together with its immutable source
lines. A correction that crosses the boundary is rejected into an explicit not-ready/manual-recovery
path until a later correction decision defines its period, archive reference, opening-balance effect,
and reconciliation proof. Full historical transfer import is an optional migration improvement, not
a prerequisite for the first profile; it requires its own ordering and replay proof.

## Semantic Boundary

Accounting owns the business vocabulary and policy:

```text
postJournal
reversePosting
createExecutionAccount
getBalance
getBalanceHistory
```

A future reservation capability may add:

```text
reserve
postReservation
voidReservation
```

only after its owner, authorization, scope, and correction semantics are decided. These operations
are not a license to implement payment, settlement, credit, budget, or inventory semantics early.

`FinancialLedgerPort` is the engine-independent application boundary. It is capability-aware rather
than a lowest-common-denominator storage interface. TigerBeetle account, transfer, flag, timestamp,
client, and transport types remain private to the trusted adapter.

The adapter may be implemented behind the kernel/infrastructure boundary. Domain packages depend on
stable capability-level failures and the public port, never on TigerBeetle or PostgreSQL driver
failures.

The port is owned by the Accounting/application contract boundary and is supplied at the composition
root. Kernel/infrastructure may implement the provider adapter but must not import Accounting domain
semantics. If a neutral package is needed later, it may contain only the provider-neutral port shape;
it must not become a generic ledger domain or import TigerBeetle types.

## Financial Operation Protocol

An activated operation crosses the two stores in a bounded, durable protocol:

```text
1. authorize and evaluate Accounting policy
2. PostgreSQL transaction: persist intent + deterministic identity + expected mapping
3. durable worker submits the same identity to TigerBeetle
4. resolve response or retry/lookup the same identity
5. PostgreSQL transaction: persist outcome + provenance + projection state
6. publish the accepted financial fact from durable PostgreSQL intent
7. reconcile before unsafe follow-up work
```

The durable operation state is:

```text
intent -> submitted -> accepted -> reconciled
                    |             |
                    +-> rejected  +-> manual_recovery
                    +-> unknown
```

Rules:

- A TigerBeetle call is never treated as part of an open PostgreSQL transaction.
- A timeout is an unknown outcome until the same ID is resolved.
- A retry never generates a new financial identity for the same logical operation.
- `accepted` means TigerBeetle accepted the financial movement; `reconciled` means the PostgreSQL
  control-plane receipt and projection are verified against that movement.
- An accepted operation may remain visible as projection-pending after a PostgreSQL failure.
- A known TigerBeetle rejection does not create a financial projection.
- Unknown or mismatched outcomes are fenced and may enter manual recovery.
- An activated profile has no silent PostgreSQL fallback.

A job table or approved checkpointed workflow owns durable submission and recovery. An Effect fiber,
request lifetime, or in-memory retry loop is never the durability mechanism.

### Caller-visible states and reads

Internal operation state and public journal state are distinct:

```text
internal operation: intent -> submitted -> accepted -> reconciled
public journal:     draft  -> posted   -> reversed
```

For the activated profile:

- `posted` is returned only after TigerBeetle acceptance and the PostgreSQL outcome, projection,
  mapping, and outbox transaction commit;
- `reconciled` is an internal readiness state, not a second financial posting;
- if TigerBeetle accepted but that PostgreSQL transaction failed or its response was lost, callers
  receive no success and the retry resolves the same operation ID to the prior result;
- a reversal or dependent financial command requires the source operation to be reconciled, unless a
  later capability contract explicitly proves a safe accepted-but-unreconciled path;
- authoritative current balance/history reads use the approved TigerBeetle adapter path;
- PostgreSQL reports are bounded-stale projections, carry projection/reconciliation status, and must
  not silently fall back to command resources or claim current authority.

## Failure and Publication Matrix

| Failure point | Financial fact | PostgreSQL state | Caller/worker behavior |
| --- | --- | --- | --- |
| Before intent commit | No TigerBeetle submission | No intent | Retry the command safely |
| Intent committed, no submission | No accepted transfer | `intent` | Durable worker submits the same IDs |
| TigerBeetle rejects | No accepted transfer | `rejected` after receipt transaction | Return a stable business/infrastructure result; no posted projection |
| TigerBeetle accepts and receipt transaction commits | Accepted transfer exists | `accepted`/projection plus outbox | Return `posted`; reconciliation may still be pending |
| TigerBeetle accepts, PostgreSQL receipt fails | Accepted transfer exists | No durable receipt or `unknown` | No caller-visible success; freeze dependent work and reconcile by the same IDs |
| Response is lost | Unknown until lookup | `submitted` or `unknown` | Retry/lookup the same IDs; never generate new IDs |
| Mapping or amount mismatch | Transfer may exist but is unsafe | `manual_recovery`/quarantine | Fail closed; do not invent a balancing mutation |
| TigerBeetle unavailable | Unknown or no new result | Intent remains durable | Retry within policy; never fall back to PostgreSQL |
| Restore points diverge | Authority cannot be assumed from either copy | Profile fenced | Freeze submission, compare deterministic IDs, quarantine drift, and recover explicitly |

After TigerBeetle acceptance, the worker invokes an Accounting-owned public finalize/reconcile
command. That command opens the PostgreSQL transaction and commits the outcome receipt,
journal/reporting projection, provenance, and event/outbox record together by invoking the public
`MessagingService` contract inside the owner transaction. The worker never writes Accounting,
Process, or Messaging tables directly. `process.jobs` owns submission/reconciliation lease and
lifecycle state; Accounting owns the financial operation outcome and projection.

The outbox record means durable publication intent; it does not mean consumer completion or external
delivery. Duplicate event delivery is handled independently from duplicate TigerBeetle submission.

## Identity and Mapping

Every operation uses a stable, versioned identity. Account and transfer IDs are derived
**deterministically** from EclipseERP identities and operation parts. The encoding, byte order,
namespace, and mapping version are explicit and covered by collision and replay tests. The current
adapter's mapping version `v1` hashes the UTF-8 JSON tuple
`["eclipse-erp/tigerbeetle", "v1", ...parts]` with SHA-256 and uses the first 16 bytes as a
big-endian unsigned 128-bit ID; the forbidden zero and maximum values are remapped to `1`. Account
parts are `account, mappingVersion, tenantId, legalEntityId, accountId, currency`; transfer parts
are `transfer, mappingVersion, tenantId, legalEntityId, operationId, position`.

The control-plane mapping records enough data to verify the complete operation:

```text
Tenant + Legal Entity
+ domain operation and command identity
+ journal/reference and correction relationship
+ account mapping and ledger
+ amount and direction
+ transfer group and linked-chain position
+ mapping version
+ TigerBeetle IDs and observed status
```

TigerBeetle linked-event execution does not replace this association record. The PostgreSQL mapping
is the durable explanation of which transfers make up one EclipseERP journal; TigerBeetle remains
the authority for whether those transfers were accepted.

## Journal and Projection Rules

The first migration profile is the bounded P2 Accounting baseline:

- one Tenant and Legal Entity scope;
- Legal Entity base currency;
- fixed two-decimal minor-unit arithmetic;
- account configuration and open-period policy in PostgreSQL;
- journal posting, revenue posting, and correcting/reversal transfers through the port.

For an activated profile:

- journal metadata and lines are PostgreSQL projections/control-plane records;
- a journal is financially accepted only when its mapped TigerBeetle operation is accepted;
- a reversal is a new correcting TigerBeetle operation and a new PostgreSQL projection;
- accepted transfer history is never updated or deleted;
- reports read a PostgreSQL projection or approved TigerBeetle query path, never a competing balance;
- projections carry source IDs, mapping version, and reconciliation status so they can be rebuilt.

### Period and policy concurrency

The PostgreSQL intent transaction snapshots the Legal Entity, posting period, account mapping, and
policy versions used for the operation. It serializes with period close and configuration changes:

- an open period cannot close while an operation for that period is `intent`, `submitted`, `accepted`,
  or `unknown`; close returns a typed pending-work failure or waits through an approved durable
  close workflow;
- a mapping or posting-policy change cannot invalidate a non-reconciled operation; it is rejected or
  creates a new version for later operations;
- the submission worker revalidates the captured versions before sending an unsubmitted operation;
  a stale intent is fenced rather than submitted with changed semantics;
- authorization is checked before intent creation, and a policy or scope change fences unsubmitted
  work until an authorized recovery command resumes it;
- period close uses a bounded wait/deadline. When the deadline expires, it returns a typed
  pending-financial-operation failure and leaves the period open; it never holds a PostgreSQL
  transaction indefinitely;
- an accepted operation whose projection is missing or unreconciled keeps the period fenced until
  reconciliation or authorized manual recovery completes. Reconciliation updates the projection and
  receipt; it does not post a new fact into a closed period.

This prevents a period close, account remapping, or policy change from racing a delayed submission.

This architecture does not add AP/AR, invoices, payments, settlement, tax, FX, multi-currency,
wallets, credit facilities, budgets, or inventory quantity/value semantics. Each requires a separate
owner and decision.

## Reconciliation

Reconciliation compares PostgreSQL intent and mapping records with TigerBeetle observations. It must
be idempotent, version-aware, observable, and safe to rerun.

The reconciliation anchor is an infrastructure-private, versioned tuple:

```text
engine snapshot/checkpoint identity when supported
+ per-ledger/account scan boundary
+ mapping version
+ verified deterministic operation-set hash
```

The anchor is persisted with the projection checkpoint and advanced only after the corresponding
TigerBeetle transfer set and balances are verified. Creating an anchor either uses an immutable
engine snapshot/checkpoint or briefly fences new submissions at a bounded boundary while the scan
and balance reads are taken. If the engine cannot provide a durable snapshot or cursor for the
required query, reconciliation uses a bounded full scan with that submission fence and declares
bounded completeness; it does not claim a point-in-time global history guarantee. A transfer ID
alone is not a global ordering or replay watermark.

At minimum it detects:

- PostgreSQL intent with no resolved TigerBeetle operation;
- TigerBeetle operation with no PostgreSQL intent or receipt;
- duplicate or conflicting deterministic identity;
- account, ledger, direction, amount, linked-chain, or mapping-version mismatch;
- TigerBeetle accepted while the PostgreSQL projection is missing or behind;
- PostgreSQL marked accepted while TigerBeetle remains unresolved;
- restore or checkpoint gaps between the two stores.

Reconciliation can reload, replay, rebuild, quarantine, or require manual recovery. It must not issue
an invented posting merely to make the stores look equal. Corrections remain authorized business
commands and use new transfers.

### Cross-store restore protocol

A PostgreSQL or TigerBeetle restore is not safe to resume independently:

1. Freeze financial submission, period close, and dependent corrections.
2. Record a recovery watermark and the last accepted reconciliation anchor.
3. Compare deterministic operation IDs, mappings, receipts, and account balances across both stores.
4. Quarantine orphan transfers, missing receipts, missing mappings, and incompatible restore points.
5. Rebuild or manually recover the PostgreSQL projection before reopening the profile.
6. Require an operator-approved recovery record; normal posting cannot resume from an unresolved
   mismatch.

No restore procedure deletes or rewrites an accepted TigerBeetle transfer.

## Trust and Operations

TigerBeetle has no application authorization boundary. Only the trusted financial adapter/worker may
reach the cluster, using a narrow credential and network path. Frontend callers, arbitrary domain
modules, reporting workers, and untrusted plugins must not connect directly.

The production profile requires:

- version-pinned client and compatibility evidence;
- bounded request batching and concurrency;
- backup, restore, upgrade, and point-in-time relationship procedures;
- health, latency, rejection, unknown-outcome, projection-lag, and reconciliation metrics;
- outage behavior that blocks the profile instead of falling back to PostgreSQL;
- adapter exit and forward-only recovery procedures;
- command-resource budgets that do not allow financial retries to starve protected work.

Detailed sequencing and gates are owned by
[`../roadmap/financial-ledger-execution.md`](../roadmap/financial-ledger-execution.md).
