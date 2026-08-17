import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { DatabaseFailure } from "./database.ts"

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const Uuid = Schema.String.check(Schema.isUUID())
const PostgresInt = Schema.Int.check(
  Schema.isBetween({ minimum: -2_147_483_648, maximum: 2_147_483_647 }),
)

export const DurableJobInput = Schema.Struct({
  tenantId: Uuid,
  jobType: NonEmptyString,
  idempotencyKey: NonEmptyString,
  priority: PostgresInt,
  payload: Schema.Json,
  correlationId: NonEmptyString,
})

export const DurableJob = Schema.Struct({
  jobId: Uuid,
  tenantId: Uuid,
  jobType: NonEmptyString,
  idempotencyKey: NonEmptyString,
  priority: PostgresInt,
  payload: Schema.Json,
  correlationId: NonEmptyString,
})

export type DurableJobInput = Schema.Schema.Type<typeof DurableJobInput>
export type DurableJob = Schema.Schema.Type<typeof DurableJob>

export interface DurableJobEnqueuer {
  readonly enqueue: (
    input: unknown,
  ) => Effect.Effect<DurableJob, DatabaseFailure | Schema.SchemaError>
}

export const DurableJobEnqueuer = Context.Service<DurableJobEnqueuer>(
  "EclipseERP/DurableJobEnqueuer",
)
