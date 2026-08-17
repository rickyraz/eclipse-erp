# TigerBeetle Financial Ledger: Recovery and Cutover Runbook

> **Status:** rehearsal-required; this document is not an activation approval.
>
> **Owner:** Accounting / Kernel
>
> **Related documents:**
>
> - [Financial ledger architecture](../architecture/financial-ledger.md)
> - [ADR-0040](../decisions/0040-adopt-tigerbeetle-financial-ledger.md)
> - [Financial ledger execution roadmap](../roadmap/financial-ledger-execution.md)
>
> This runbook records the operational boundary for the pinned
> `tigerbeetle-node@0.17.9` client. The application must remain PostgreSQL
> default until every release gate in the roadmap has executable evidence.

## 1. TigerBeetle documentation findings

The official documentation is the source of truth for provider semantics:

- [System Architecture](https://docs.tigerbeetle.com/coding/system-architecture)
  places TigerBeetle in the data plane and the general-purpose database in the
  control plane. The application follows this split.
- [Reliable Transaction Submission](https://docs.tigerbeetle.com/coding/reliable-transaction-submission)
  requires a client-generated, persisted transfer ID and retrying the same ID.
  `financial_operation_transfers.engine_transfer_id` is persisted before the
  first submission attempt; retry and reconciliation reuse it.
- [Requests](https://docs.tigerbeetle.com/coding/requests) says create events
  are idempotent: a replay receives `exists`, not a second object.
- [Data Modeling](https://docs.tigerbeetle.com/coding/data-modeling) assigns
  transfers, balances, double-entry constraints, and strict serializability to
  TigerBeetle. Ledger metadata and application account mappings remain in
  PostgreSQL.
- [Safety](https://docs.tigerbeetle.com/concepts/safety) describes immutable,
  checksummed, hash-chained data and safe shutdown when quorum/durability cannot
  be preserved. The application therefore never converts an unavailable or
  unknown provider result into a PostgreSQL posting.
- [Debits and credits](https://docs.tigerbeetle.com/coding/data-modeling#debits-vs-credits)
  requires the application to interpret the debit/credit balance convention.
  Account provisioning maps asset/expense accounts to
  `credits_must_not_exceed_debits` and liability/equity/revenue accounts to
  `debits_must_not_exceed_credits`.
- [Cluster Recommendations](https://docs.tigerbeetle.com/operating/cluster)
  recommends six replicas for production and states that durability is
  preserved only while the cluster remains safely available. The local
  one-replica cluster is test-only.
- [Deploying](https://docs.tigerbeetle.com/operating/deploying) reserves
  cluster ID `0` for testing and recommends a supervisor and six dedicated
  production replicas. Production configuration must not reuse the local
  `0_0.tigerbeetle` setup.
- [Recovering](https://docs.tigerbeetle.com/operating/recovering) explicitly
  says not to use `tigerbeetle format` for a permanently lost replica. Use
  `tigerbeetle recover` against a healthy cluster, then let state sync repair
  the new replica. No repository script may format or replace a replica by
  guessing.
- [Monitoring](https://docs.tigerbeetle.com/operating/monitoring) requires
  alerting on non-normal replica status and state sync, and recommends
  measuring client-side request latency in addition to replica request timing.
- [Change Data Capture](https://docs.tigerbeetle.com/operating/cdc) can stream
  transfers and balance updates through AMQP. CDC is an observation/rebuild
  input, not a second authority; its resume timestamp must be persisted by the
  operator if it is enabled.

The current official operating index documents replica recovery but does not
provide a generic application-level PostgreSQL/TigerBeetle snapshot transaction
or a magic cross-store backup point. Therefore an independently restored pair
is fenced until the application recovery watermark is verified.

## 2. Authority map

| Fact | Authority | PostgreSQL representation | Rebuild/recovery rule |
|---|---|---|---|
| Accepted transfer, amount, accounts, ledger, code, flags, timestamp | TigerBeetle | `financial_operation_transfers` identity/status | Lookup the same transfer ID; never edit/delete it |
| Account posted/pending totals | TigerBeetle | Balance reads/projections | Re-read from TigerBeetle; no PostgreSQL balance authority |
| Tenant, Legal Entity, account metadata, currency policy | PostgreSQL | Accounting control-plane tables | Required metadata for rebuilding a report |
| Financial intent and operation identity | PostgreSQL | `financial_operations` | Stable operation ID and transfer IDs are immutable |
| Journal lines and references | PostgreSQL | `journal_entries`, `journal_lines` | Metadata projection; accepted amounts must reconcile to TigerBeetle |
| Posted/reconciled status | PostgreSQL control state | Operation/journal/transfer statuses | Rebuild only after exact TigerBeetle identity verification |
| Outbox/event delivery | PostgreSQL | Messaging outbox | Reappend the same event identity/idempotency key |
| Cutover approval and watermark | PostgreSQL | `financial_cutover_controls` | Activation is scoped and auditable; no config-only activation |

A PostgreSQL row is not evidence that TigerBeetle accepted a transfer. An
accepted TigerBeetle transfer is not evidence that the PostgreSQL projection is
complete until the operation is `reconciled`.

## 3. Lifecycle and failure matrix

| Point | PostgreSQL state | TigerBeetle state | Safe action | Reconciliation | Manual recovery |
|---|---|---|---|---|---|
| A. before intent commit | no operation | no submission | retry intent | none | none |
| B. intent committed | intent + submit job | no known transfer | claim same job/IDs | only if outcome becomes unknown | routing/auth drift |
| C. outcome unknown | submitted/unknown | unknown | lookup same IDs | exact identity/metadata lookup | bounded retry exhausted |
| D. response lost after acceptance | unknown | accepted | reconcile same IDs | lookup all expected transfers | missing/conflicting fact |
| E. process dies after acceptance | submitted/unknown | accepted | restart job | receipt then finalization | bounded reconciliation failure |
| F. before journal projection | accepted + draft | accepted | retry finalization | reapply accepted projection | projection invariant mismatch |
| G. before outbox | accepted projection | accepted | retry same event key | verify and append idempotently | event identity conflict |
| H. partial finalization | transaction rollback or accepted | accepted | finalization only | rebuild operation projection | irreconcilable mismatch |
| I. worker lease held | leased job | unchanged/unknown | lease fencing/expiry | state chooses submit or lookup | invalid lease owner |
| J. worker restart | durable job/operation | unchanged/accepted | new worker claims job | same IDs | invalid lease token is rejected |
| K. duplicate workers | one valid lease | at most one transfer set | only valid lease completes | create replay returns `exists` | conflicting replay |
| L. TigerBeetle unavailable | submitted/unknown | unknown | bounded same-ID retry; no PostgreSQL fallback | resume after health | retry budget exhausted |
| M. PostgreSQL unavailable | last committed state | unchanged | retry PostgreSQL work | compare after recovery | restore divergence fences posting |

The executable matrix is also exported as
`packages/accounting/src/financial-readiness.ts` and tested by
`packages/accounting/tests/financial-readiness.test.ts`.

## 4. Historical boundary and opening balance

The current migration policy is **opening-balance cutover**, not an unproven
historical replay:

1. Preserve all legacy PostgreSQL journals as historical control-plane data.
2. Keep their `financial_operations.engine_verified` value false unless an
   exact TigerBeetle transfer identity can be proven.
3. Freeze the selected tenant/Legal Entity boundary and record a cutover
   watermark in `financial_cutover_controls`.
4. Produce one account-level opening-balance report for every account/currency
   mapping.
5. Create/import opening balances in the approved TigerBeetle procedure.
6. Compare exact integer debit and credit totals at account, currency, Legal
   Entity, and mapping-version level.
7. Abort approval on any missing, duplicate, mapping, currency, or amount
   discrepancy.

`verifyOpeningBalances` performs the exact account-level comparison used by the
rehearsal. It applies no tolerance. A global total match is insufficient.
Full historical replay remains an optional future migration and cannot be used
to mark existing PostgreSQL rows as TigerBeetle facts.

## 5. Controlled activation

Normal configuration accepts only PostgreSQL. TigerBeetle activation uses the
Accounting service commands and the database state machine:

```text
postgresql
  -> preparing_tigerbeetle
  -> verification_pending / approved
  -> activating
  -> tigerbeetle
```

The controlled sequence is:

1. Authorized operator calls `prepareTigerBeetleCutover`.
2. A dry-run opening-balance/historical report records its watermark and hash.
3. Recovery/backup and reconciliation rehearsals are recorded.
4. Authorized operator calls `approveTigerBeetleCutover`; all four verification
   flags must be true and there must be no unresolved operation.
5. `activateTigerBeetleCutover` provisions every mapped account idempotently,
   verifies account metadata and balance constraints, then changes the route
   and cutover control in one PostgreSQL transaction.
6. The database trigger rejects direct PostgreSQL-to-TigerBeetle route changes
   unless the durable control is `activating`.
7. Legacy PostgreSQL posting remains fenced after activation. There is no
   catch-and-fallback path.

The current compatibility boundary is tenant-wide for the legacy
`postJournal` API, because that API has no Legal Entity argument. A production
pilot must therefore use a tenant cohort with a non-overlapping financial
boundary, or first migrate that API to an explicit Legal Entity command.

## 6. Recovery procedures

### TigerBeetle outage

- Stop accepting new TigerBeetle financial work after the bounded retry budget
  is reached.
- Keep intents/jobs durable as `submitted` or `unknown`.
- Do not post the same operation to PostgreSQL.
- After cluster health is normal, lookup the original transfer IDs and resume
  reconciliation.

### PostgreSQL outage

- Treat TigerBeetle acceptance as authoritative but incomplete from the
  application perspective.
- On PostgreSQL recovery, resume the operation/job with the original identity.
- Reconcile before allowing dependent financial work.

### Worker or adapter crash

- Let the Process lease expire or use lease fencing.
- The next worker reads the durable operation state.
- `intent/submitted` submits using persisted IDs; `unknown/accepted` reconciles.
- A new transfer identity is never generated for recovery.

### Lost response

- A timeout or network error is `unknown`, not `not_found`.
- Only a successful exact lookup returning no matching transfer IDs proves
  `not_found`.
- A partial result, wrong metadata, wrong mapping version, or conflicting ID
  is manual recovery.

### Replica failure

- Preserve the cluster configuration and all replica indexes.
- Never run `tigerbeetle format` on a lost production replica.
- Confirm the cluster is healthy and can view-change.
- Run the version-matched `tigerbeetle recover` command for the lost replica,
  then start it normally and wait for state sync.
- Alert on non-normal `replica_status` and `state_sync_stage` until normal.

### Cross-store restore

1. Freeze submission and record the PostgreSQL operation watermark.
2. Record the TigerBeetle observation/CDC timestamp if CDC is enabled.
3. Restore each store using its supported procedure; do not assume the backups
   share a commit point.
4. Compare every accepted operation and transfer identity through the
   watermark, plus account metadata and exact balances.
5. Quarantine missing receipts, orphan transfers, conflicting identities, and
   projection gaps.
6. Rebuild only derived PostgreSQL projections after the comparison succeeds.
7. Keep posting disabled until an authorized operator records the verification
   hash and recovery watermark.

No restore procedure deletes, edits, or reassigns an accepted TigerBeetle
transfer. Recovery is forward-only through reconciliation, correction/reversal,
or explicit manual recovery.

## 7. Rehearsal evidence and monitoring

Latest local evidence (2026-08-17): the official TigerBeetle binary
`0.17.9+cc1c06a` passed the scoped one-replica integration test, including a
linked accepted journal, deterministic replay path, and account-constraint
rejection. PostgreSQL-backed repository validation passed with 184 tests and 1
intentional skip. This is adapter and database evidence only; it is not quorum,
production outage, backup/restore, or cutover evidence.

Safe automated evidence:

```sh
deno task test packages/accounting/tests/financial-readiness.test.ts
deno task test packages/accounting/tests/financial-ledger.test.ts
deno task test packages/kernel/tests/tigerbeetle.test.ts
deno task test apps/worker/worker.test.ts
```

PostgreSQL rehearsals must use `withTemporaryDatabase` and never a production
URL. The live integration test remains gated by `TIGERBEETLE_INTEGRATION=1`.
A local single-replica cluster proves client integration only; it does not prove
production quorum, backup, or restore readiness.

The following must be exposed by the deployment metrics/logging layer before
approval:

- submitted backlog and queue age;
- accepted-but-not-reconciled count and age;
- submission/reconciliation latency;
- duplicate and unknown outcomes;
- TigerBeetle unavailable responses;
- projection failures and manual-recovery count;
- cutover status, owner, watermark, and engine ownership;
- TigerBeetle replica status, state-sync status, disk space, and client latency.

Logs must contain operation IDs, stable reason tags, and correlation IDs, but
not credentials or unnecessary financial payloads.
