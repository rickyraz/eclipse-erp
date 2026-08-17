# ADR-0040: Adopt TigerBeetle as the Financial Ledger Execution Engine

- Status: Accepted
- Date: 2026-08-17
- Supersedes: ADR-0011 and the broad financial-ledger authority rule in ADR-0003
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Previous ledger-engine decision: [`./0011-financial-ledger-engine.md`](./0011-financial-ledger-engine.md)
> - Previous PostgreSQL truth decision: [`./0003-postgresql-is-transactional-truth.md`](./0003-postgresql-is-transactional-truth.md)
> - Financial ledger architecture: [`../architecture/financial-ledger.md`](../architecture/financial-ledger.md)
> - PostgreSQL architecture: [`../architecture/postgresql-19-architecture.md`](../architecture/postgresql-19-architecture.md)
> - State and consistency: [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
> - Durable execution: [`../architecture/durable-execution.md`](../architecture/durable-execution.md)
> - P2 financial baseline: [`./0036-define-p2-document-and-financial-baseline.md`](./0036-define-p2-document-and-financial-baseline.md)
> - Execution roadmap: [`../roadmap/financial-ledger-execution.md`](../roadmap/financial-ledger-execution.md)

## Context

EclipseERP needs financial correctness that does not depend only on service conventions:
immutable movements, atomic double-entry execution, deterministic retries, balance constraints,
and strict ordering. TigerBeetle provides these financial transaction primitives while PostgreSQL
remains the right home for ERP metadata, policy, authorization, workflow state, and reporting
projections.

The earlier ledger decision selected PostgreSQL first and treated TigerBeetle as a future
optimization. That no longer matches the correctness-first target for EclipseERP. The change is not
a request to move the ERP into TigerBeetle or to add an unreviewed second write path. It is a change
in financial execution authority and therefore changes transaction and recovery semantics.

TigerBeetle is a specialized financial OLTP database, not a general-purpose ERP database. Its
official architecture and data-model guidance describe a financial data plane that operates beside a
control-plane database such as PostgreSQL:

- [TigerBeetle in Your System Architecture](https://docs.tigerbeetle.com/coding/system-architecture/)
- [TigerBeetle Data Modeling](https://docs.tigerbeetle.com/coding/data-modeling/)
- [TigerBeetle Transfer Reference](https://docs.tigerbeetle.com/reference/transfer/)
- [TigerBeetle Reliable Transaction Submission](https://docs.tigerbeetle.com/coding/reliable-transaction-submission/)

## Decision

EclipseERP adopts TigerBeetle as the **required financial-ledger execution engine**. This is an
architectural correctness requirement, not an optional performance accelerator. Production
activation remains gated by the execution roadmap; accepting this ADR does not silently switch the
current PostgreSQL implementation or authorize a live dual-write.

The target shape is:

```text
Accounting policy and business metadata
              |
              v
      FinancialLedgerPort
              |
              v
  trusted TigerBeetle adapter/service
              |
              v
         TigerBeetle
  accepted transfers and balances
              |
              v
 PostgreSQL control-plane projection
```

TigerBeetle is authoritative for the financial facts that the activated ledger profile submits to
it:

- accepted debit-credit transfers and linked transfer chains;
- pending, posted, and voided transfer state when a decided capability uses pending transfers;
- account balances and configured balance constraints;
- immutable transfer history and its engine-assigned timestamps.

PostgreSQL remains authoritative for ERP and control-plane facts:

- Tenant, Legal Entity, account meaning, chart-of-accounts metadata, and account mappings;
- fiscal periods, posting policy, authorization, and accounting configuration;
- command identity, financial operation intent, workflow/retry state, and manual recovery state;
- journal/document metadata, audit references, and rebuildable reporting projections;
- reconciliation state and the mapping between domain operations and TigerBeetle identities.

A PostgreSQL representation of a TigerBeetle transfer is a projection or mapping, not a second
financial authority. A PostgreSQL journal may retain the ERP's reference, lines, period, actor,
source document, and correction relationships, but its financial acceptance must derive from the
TigerBeetle operation recorded for the same deterministic identity.

The broad PostgreSQL truth rule from ADR-0003 is retained for non-ledger business facts, PostgreSQL
constraints, and PostgreSQL-owned control-plane transactions. Financial transfer, balance, and
transfer-history authority is the explicit exception defined here.

### Semantic boundary

Accounting remains the semantic owner of posting, reversal, account meaning, fiscal policy, and
business authorization. The financial execution contract is expressed in EclipseERP vocabulary,
not in TigerBeetle request flags:

```text
postJournal
reversePosting
createExecutionAccount
reserve             (only for a separately decided reservation capability)
postReservation     (only for that capability)
voidReservation     (only for that capability)
getBalance
getBalanceHistory
```

The public contract must not expose TigerBeetle account, transfer, client, flag, or transport
classes. It must not be a lowest-common-denominator `insertJournalLines` abstraction that erases
atomic linked transfers, pending state, or deterministic idempotency.

The trusted adapter owns TigerBeetle client lifecycle, batching, request encoding, provider failure
mapping, and connection isolation. Domain packages may depend only on the engine-independent
financial contract and stable capability-level failures.

### Cross-store execution protocol

TigerBeetle does not participate in a PostgreSQL transaction. An activated financial operation uses
this protocol:

1. Authenticate, decode, authorize, and evaluate Accounting policy in EclipseERP.
2. In a PostgreSQL transaction, persist the operation intent, deterministic operation identity,
   expected mapping, and durable submission/recovery work.
3. Submit the same deterministic account and transfer IDs to TigerBeetle through the trusted adapter.
4. Interpret the response or perform an idempotent lookup using the same IDs after a timeout.
5. In a separate PostgreSQL transaction, persist the observed outcome, update the journal/reporting
   projection with TigerBeetle provenance, and append the event/outbox record through the public
   Messaging contract.
6. Return caller-visible financial success only after TigerBeetle acceptance and that PostgreSQL
   receipt transaction commit. The outbox record is durable publication intent, not consumer completion.
7. Reconcile accepted-but-unprojected or otherwise unknown operations before allowing unsafe follow-up
   work.

The operation state is explicit:

```text
intent -> submitted -> accepted -> reconciled
                    |             |
                    +-> rejected  +-> manual_recovery
                    +-> unknown
```

`unknown` is not failure and is not permission to generate a new transfer ID. The same ID is retried
until the outcome is known or the operation is fenced for manual recovery. If TigerBeetle accepted but
the PostgreSQL receipt transaction failed, the caller receives no success until reconciliation
recovers the same operation. A TigerBeetle outage blocks the activated financial profile; the
application must not silently fall back to PostgreSQL.

The PostgreSQL intent records the period, account mapping, and policy versions used for submission.
Period close and mapping changes must fence or wait for non-reconciled operations; a delayed worker
must not submit an intent whose policy snapshot is stale.

No implementation may hold an open PostgreSQL transaction while treating a remote TigerBeetle call
as if it were part of that transaction. No implementation may claim that an existing PostgreSQL
Sales + Inventory + Accounting transaction remains atomic after its Accounting step moves to
TigerBeetle. That workflow requires a separate consistency decision and an explicit accepted,
pending, compensation, or manual-recovery contract.

### Identity and association

Every logical financial operation has a stable, versioned identity. Account and transfer IDs sent to
TigerBeetle are deterministically derived from EclipseERP identities and operation parts, with a
fixed encoding and collision tests. Retries reuse the same IDs. The mapping records at least the
Tenant, Legal Entity, domain operation, journal/reference, transfer group, account mapping, ledger,
amount, and mapping version.

Linked transfer relationships are not assumed to be recoverable from TigerBeetle alone. EclipseERP
stores the journal-to-transfer association and any required user-data pointer in PostgreSQL, then
verifies the complete chain during reconciliation.

### Scope boundary

This ADR does not expand the current P2 financial baseline. The first migration profile is limited
to the decided Accounting slice: Legal Entity-scoped, fixed two-decimal, base-currency account
configuration, journal posting, revenue posting, and correcting/reversal transfers.

The following remain separate decisions and implementation gates:

- payment authorization, settlement, wallet, credit-limit, and budget policies;
- AP/AR, invoices, tax, FX, and multi-currency accounting;
- inventory quantity truth and inventory reservation semantics;
- inventory valuation or COGS policy;
- historical import strategy beyond the approved cutover plan;
- migration of the existing atomic Sales + Inventory + Accounting workflow.

TigerBeetle primitives may support those capabilities later, but their existence does not create
EclipseERP business contracts or authorize them for Process Studio.

## Alternatives Considered

### Keep PostgreSQL as the permanent ledger and make TigerBeetle optional

Rejected. It leaves financial correctness dependent on the generic PostgreSQL journal write path and
keeps TigerBeetle as a performance appendage instead of the selected financial execution boundary.

### Write PostgreSQL and TigerBeetle as co-authorities

Rejected. Two balances or two accepted transfer histories create an unresolved authority conflict
when one write succeeds and the other does not.

### Mirror every PostgreSQL journal into TigerBeetle

Rejected as a mandatory architecture. A mirror adds cost and reconciliation without moving financial
authority. Isolated replay and cutover validation are allowed; production mirroring is not.

### Switch every existing workflow immediately

Rejected. A cross-store operation cannot inherit PostgreSQL's local ACID semantics. Existing
PostgreSQL-backed workflows remain transitional until their own transaction and recovery contracts
are redesigned and accepted.

### Use TigerBeetle directly from domain packages

Rejected. It would leak provider vocabulary, connection trust, retry behavior, and engine-specific
constraints into Accounting and make the domain contract impossible to evolve safely.

## Consequences

### Positive

- Double-entry execution, immutable transfer history, deterministic retry, and balance constraints
  move into a purpose-built financial state machine.
- PostgreSQL remains available for rich ERP metadata, fiscal policy, authorization, audit links, and
  rebuildable reporting.
- Financial acceptance has one explicit authority instead of a PostgreSQL/TigerBeetle tie.
- Pending and linked-transfer capabilities can be adopted without exposing provider vocabulary.
- Reconciliation becomes an explicit operational control rather than an informal comparison.

### Negative

- Financial operations become cross-store protocols rather than one PostgreSQL transaction.
- Unknown outcomes, recovery fencing, projections, and operational isolation become mandatory.
- TigerBeetle availability becomes part of the availability of every activated financial profile.
- Existing synchronous cross-domain workflows cannot be migrated by changing one adapter binding.
- The repository gains a specialized deployment, backup, upgrade, and observability surface.

### Risks

- A projection or journal table may accidentally regain financial authority.
- A retry path may create a new ID after a lost response and duplicate a business operation.
- An operator may restore PostgreSQL and TigerBeetle from non-corresponding points in time.
- An unbounded adapter call may hold PostgreSQL locks or exhaust command resources.
- A future capability may assume pending, multi-currency, or balance-limit semantics without a domain
  decision and invariant proof.

## Activation Gates

TigerBeetle is not a production dependency for a scope until all of the following are reviewed and
executable:

- authority matrix and first-profile scope;
- `FinancialLedgerPort` contract and stable failure model;
- deterministic ID and mapping version;
- durable intent, retry, unknown-outcome, and manual-recovery protocol;
- test adapter and fault-injection proof;
- trusted adapter, network isolation, credentials, batching, and provider compatibility;
- account/transfer mapping and rebuildable PostgreSQL projection;
- reconciliation mismatch classes, quarantine, alerts, and operator runbook;
- backup, restore, upgrade, outage, and adapter-exit rehearsal;
- isolated historical replay and opening-balance verification;
- bounded pilot with no silent PostgreSQL fallback;
- separate consistency decision for every cross-domain workflow that previously relied on one
  PostgreSQL transaction.

Benchmarks inform capacity, batch size, and SLOs. They are not the reason to adopt TigerBeetle, but
production activation still requires evidence that the selected deployment can meet its reviewed
operational objectives.

## Validation

The implementation must prove, at minimum:

- duplicate submission returns the original financial result;
- a lost response can be resolved by retrying or looking up the same ID;
- TigerBeetle linked-transfer execution is all-or-nothing;
- the PostgreSQL journal-to-transfer association is persisted separately, orphan chains are detected,
  and no journal is reported as posted before the required receipt transaction commits;
- pending transfer lifecycle is correct wherever that capability is enabled;
- PostgreSQL failure before and after TigerBeetle acceptance produces the documented state;
- TigerBeetle outage fails closed without a PostgreSQL fallback;
- mismatched amount, account, ledger, or mapping version is quarantined;
- reconciliation is idempotent and never hides drift by inventing a business mutation;
- reversals create new correcting transfers and never mutate accepted history;
- reporting and audit output can be reproduced from TigerBeetle facts plus PostgreSQL metadata;
- domain packages contain no TigerBeetle imports or provider failures.
