import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

import {
  FinancialOperationJobPayload,
  FinancialOperationService,
} from "../../packages/accounting/mod.ts"
import { ProcessFinancialJobTypes, ProcessService } from "../../packages/process/mod.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))

export const FinancialWorkerInput = Schema.Struct({
  tenantId: Uuid,
  workerId: NonEmptyString,
})
export type FinancialWorkerInput = Schema.Schema.Type<typeof FinancialWorkerInput>

export const FinancialWorkerRun = Schema.Struct({
  status: Schema.Literals(["idle", "completed", "retrying", "failed"]),
  jobId: Schema.NullOr(Uuid),
  operationId: Schema.NullOr(NonEmptyString),
})
export type FinancialWorkerRun = Schema.Schema.Type<typeof FinancialWorkerRun>

const errorTag = (error: unknown): string =>
  typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : "Unknown"

const retryAfter = (milliseconds: number) => new Date(Date.now() + milliseconds).toISOString()

export const runFinancialOperationOnce = (input: unknown) =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(FinancialWorkerInput)(input)
    const process = yield* ProcessService
    const accounting = yield* FinancialOperationService
    let job = yield* process.claimJob({
      tenantId: decoded.tenantId,
      workerId: decoded.workerId,
      jobType: ProcessFinancialJobTypes.submit,
    })
    if (job === null) {
      job = yield* process.claimJob({
        tenantId: decoded.tenantId,
        workerId: decoded.workerId,
        jobType: ProcessFinancialJobTypes.reconcile,
      })
    }
    if (job === null) return { status: "idle", jobId: null, operationId: null } as const

    const payload = yield* Schema.decodeUnknownEffect(FinancialOperationJobPayload)(job.payload)
    const operation = job.jobType === ProcessFinancialJobTypes.reconcile
      ? accounting.reconcileFinancialOperation(payload)
      : accounting.submitFinancialOperation(payload)
    const result = yield* Effect.result(operation)

    if (Result.isSuccess(result)) {
      const value = result.success
      if (value.status === "unknown" && job.jobType === ProcessFinancialJobTypes.reconcile) {
        yield* process.failJob({
          tenantId: decoded.tenantId,
          workerId: decoded.workerId,
          jobId: job.jobId,
          leaseToken: job.leaseToken,
          error: "financial_operation_unknown",
          retryAt: value.scheduledAt,
        })
        return {
          status: "retrying" as const,
          jobId: job.jobId,
          operationId: value.operationId,
        }
      }
      if (
        value.status === "reconciled" || value.status === "rejected" ||
        value.status === "manual_recovery" || value.status === "unknown"
      ) {
        yield* process.completeJob({
          tenantId: decoded.tenantId,
          workerId: decoded.workerId,
          jobId: job.jobId,
          leaseToken: job.leaseToken,
        })
        return {
          status: value.status === "unknown" ? "retrying" as const : "completed" as const,
          jobId: job.jobId,
          operationId: value.operationId,
        }
      }
      yield* process.failJob({
        tenantId: decoded.tenantId,
        workerId: decoded.workerId,
        jobId: job.jobId,
        leaseToken: job.leaseToken,
        error: `financial_operation_${value.status}`,
        retryAt: value.scheduledAt,
      })
      return {
        status: "retrying" as const,
        jobId: job.jobId,
        operationId: value.operationId,
      }
    }

    const error = result.failure
    const permanent = errorTag(error) === "FinancialOperationNotFound" ||
      errorTag(error) === "SchemaError"
    yield* process.failJob({
      tenantId: decoded.tenantId,
      workerId: decoded.workerId,
      jobId: job.jobId,
      leaseToken: job.leaseToken,
      error: `financial_operation_${errorTag(error)}`,
      retryAt: permanent ? null : retryAfter(5_000),
    })
    return {
      status: permanent ? "failed" as const : "retrying" as const,
      jobId: job.jobId,
      operationId: payload.operationId,
    }
  })
