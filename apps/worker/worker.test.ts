import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { FinancialOperationService } from "../../packages/accounting/mod.ts"
import { ProcessFinancialJobTypes, ProcessService } from "../../packages/process/mod.ts"
import { runFinancialOperationOnce } from "./runner.ts"

const tenantId = "00000000-0000-4000-8000-000000000001"
const jobId = "00000000-0000-4000-8000-000000000002"
const leaseToken = "00000000-0000-4000-8000-000000000003"
const operationId = "worker-operation"

it.effect("claims a financial job and completes it through the Accounting contract", () => {
  let completed = false
  const job = {
    jobId,
    tenantId,
    jobType: ProcessFinancialJobTypes.submit,
    idempotencyKey: operationId,
    priority: 100,
    status: "leased" as const,
    scheduledAt: new Date().toISOString(),
    leaseUntil: new Date(Date.now() + 60_000).toISOString(),
    leaseOwner: "worker-1",
    leaseToken,
    attempts: 1,
    payload: { tenantId, operationId },
    correlationId: operationId,
  }
  const process = {
    claimJob: () => Effect.succeed(job),
    completeJob: (input: { leaseToken: string }) => {
      assert.strictEqual(input.leaseToken, leaseToken)
      completed = true
      return Effect.succeed({
        ...job,
        status: "completed" as const,
        leaseUntil: null,
        leaseOwner: null,
      })
    },
    renewJob: () => Effect.succeed(job),
    failJob: () => Effect.succeed(job),
  } as unknown as ProcessService
  const accounting = {
    submitFinancialOperation: () =>
      Effect.succeed({
        id: "00000000-0000-4000-8000-000000000004",
        tenantId,
        legalEntityId: "00000000-0000-4000-8000-000000000005",
        periodId: "00000000-0000-4000-8000-000000000006",
        operationId,
        operationType: "journal_post" as const,
        journalId: "00000000-0000-4000-8000-000000000007",
        sourceJournalId: null,
        reference: "worker-reference",
        currency: "USD",
        mappingVersion: 1,
        status: "reconciled" as const,
        attempts: 1,
        scheduledAt: new Date().toISOString(),
        submittedAt: new Date().toISOString(),
        engineAcceptedAt: "1",
        rejectionReason: null,
        recoveryReason: null,
        lastError: null,
        reconciledAt: new Date().toISOString(),
      }),
    reconcileFinancialOperation: () => Effect.die("not used"),
    createJournalIntent: () => Effect.die("not used"),
    createRevenueIntent: () => Effect.die("not used"),
    createReversalIntent: () => Effect.die("not used"),
  } as unknown as FinancialOperationService

  return runFinancialOperationOnce({ tenantId, workerId: "worker-1" }).pipe(
    Effect.provide(Layer.mergeAll(
      Layer.succeed(ProcessService, process),
      Layer.succeed(FinancialOperationService, accounting),
    )),
    Effect.tap((result) =>
      Effect.sync(() => {
        assert.strictEqual(result.status, "completed")
        assert.strictEqual(result.jobId, jobId)
        assert.isTrue(completed)
      })
    ),
  )
})

it.effect("releases an unknown reconciliation for a bounded retry", () => {
  let failed = false
  const job = {
    jobId: "00000000-0000-4000-8000-000000000010",
    tenantId,
    jobType: ProcessFinancialJobTypes.reconcile,
    idempotencyKey: `${operationId}:reconcile`,
    priority: 90,
    status: "leased" as const,
    scheduledAt: new Date().toISOString(),
    leaseUntil: new Date(Date.now() + 60_000).toISOString(),
    leaseOwner: "worker-1",
    leaseToken: "00000000-0000-4000-8000-000000000011",
    attempts: 2,
    payload: { tenantId, operationId },
    correlationId: operationId,
  }
  const process = {
    claimJob: () => Effect.succeed(job),
    completeJob: () => Effect.die("reconciliation must be retried"),
    renewJob: () => Effect.die("not used"),
    failJob: (input: { retryAt: string | null; leaseToken: string }) => {
      assert.strictEqual(input.leaseToken, job.leaseToken)
      assert.isNotNull(input.retryAt)
      failed = true
      return Effect.succeed({ ...job, status: "pending" as const })
    },
  } as unknown as ProcessService
  const accounting = {
    submitFinancialOperation: () => Effect.die("not used"),
    reconcileFinancialOperation: () =>
      Effect.succeed({
        id: "00000000-0000-4000-8000-000000000012",
        tenantId,
        legalEntityId: "00000000-0000-4000-8000-000000000013",
        periodId: "00000000-0000-4000-8000-000000000014",
        operationId,
        operationType: "journal_post" as const,
        journalId: "00000000-0000-4000-8000-000000000015",
        sourceJournalId: null,
        reference: "worker-reconcile-reference",
        currency: "USD",
        mappingVersion: 1,
        status: "unknown" as const,
        attempts: 2,
        scheduledAt: new Date(Date.now() + 5_000).toISOString(),
        submittedAt: new Date().toISOString(),
        engineAcceptedAt: null,
        rejectionReason: null,
        recoveryReason: null,
        lastError: "response_lost",
        reconciledAt: null,
      }),
    createJournalIntent: () => Effect.die("not used"),
    createRevenueIntent: () => Effect.die("not used"),
    createReversalIntent: () => Effect.die("not used"),
  } as unknown as FinancialOperationService

  return runFinancialOperationOnce({ tenantId, workerId: "worker-1" }).pipe(
    Effect.provide(Layer.mergeAll(
      Layer.succeed(ProcessService, process),
      Layer.succeed(FinancialOperationService, accounting),
    )),
    Effect.tap((result) =>
      Effect.sync(() => {
        assert.strictEqual(result.status, "retrying")
        assert.strictEqual(result.jobId, job.jobId)
        assert.isTrue(failed)
      })
    ),
  )
})
