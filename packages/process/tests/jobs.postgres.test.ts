import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as TestClock from "effect/testing/TestClock"
import type { Sql } from "postgres"

import { AuthorizationService, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import { AccountingService, makeAccountingService } from "../../accounting/mod.ts"
import { InventoryService, makeInventoryService } from "../../inventory/mod.ts"
import { Database, makePostgresDatabase, runMigrations } from "../../kernel/mod.ts"
import { makeMessagingService, MessagingService } from "../../messaging/mod.ts"
import {
  makeProcessService,
  ProcessJobLeaseLost,
  ProcessJobMaxAttempts,
  ProcessJobNotFound,
} from "../mod.ts"
import { makeSalesService, SalesService } from "../../sales/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")

const makeProcess = (client: Sql) =>
  Effect.gen(function* () {
    const database = makePostgresDatabase(client)
    const authorization = yield* AuthorizationService
    const requirements = Layer.merge(
      Layer.succeed(Database, database),
      Layer.succeed(AuthorizationService, authorization),
    )
    const messaging = yield* makeMessagingService.pipe(
      Effect.provideService(Database, database),
    )
    const sales = yield* Effect.provide(
      makeSalesService,
      Layer.merge(requirements, Layer.succeed(MessagingService, messaging)),
    )
    const inventory = yield* Effect.provide(
      makeInventoryService,
      Layer.merge(requirements, Layer.succeed(MessagingService, messaging)),
    )
    const accounting = yield* Effect.provide(
      makeAccountingService,
      Layer.mergeAll(
        requirements,
        Layer.succeed(MessagingService, messaging),
        Layer.succeed(SalesService, sales),
      ),
    )
    return yield* Effect.provide(
      makeProcessService,
      Layer.mergeAll(
        Layer.succeed(Database, database),
        Layer.succeed(AuthorizationService, authorization),
        Layer.succeed(SalesService, sales),
        Layer.succeed(InventoryService, inventory),
        Layer.succeed(AccountingService, accounting),
        Layer.succeed(MessagingService, messaging),
      ),
    )
  })

it.effect.skipIf(databaseUrl === undefined)(
  "fences Process job leases and moves exhausted retries to manual recovery",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      TestClock.withLive(
        Effect.gen(function* () {
          yield* runMigrations(client)
          const [tenant] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
          )
          const authorizationLayer = makeAuthorizationTestLayer([])
          const process = yield* makeProcess(client).pipe(Effect.provide(authorizationLayer))
          const [job] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
            insert into process.jobs
              (tenant_id, job_type, idempotency_key, scheduled_at, payload, correlation_id)
            values
              (${tenant!.id}, 'process.order_confirmation.post_commit', 'lease-test-1',
               now() - interval '1 second',
               ${JSON.stringify({ eventId: crypto.randomUUID() })}::jsonb, 'lease-correlation-1')
            returning id
          `
          )

          const first = yield* process.claimJob({
            tenantId: tenant!.id,
            workerId: "worker-a",
          })
          assert.isNotNull(first)
          assert.strictEqual(first!.jobId, job!.id)
          assert.strictEqual(first!.status, "leased")
          assert.strictEqual(first!.leaseOwner, "worker-a")
          assert.isNotNull(first!.leaseToken)

          assert.isNull(
            yield* process.claimJob({
              tenantId: tenant!.id,
              workerId: "worker-b",
            }),
          )

          yield* Effect.promise(() =>
            client`
            update process.jobs
            set lease_until = now() - interval '1 second'
            where id = ${job!.id}
          `
          )
          assert.instanceOf(
            yield* Effect.flip(process.renewJob({
              tenantId: tenant!.id,
              workerId: "worker-a",
              jobId: job!.id,
              leaseToken: first!.leaseToken!,
            })),
            ProcessJobLeaseLost,
          )
          const second = yield* process.claimJob({
            tenantId: tenant!.id,
            workerId: "worker-b",
          })
          assert.isNotNull(second)
          assert.strictEqual(second!.leaseOwner, "worker-b")
          assert.notStrictEqual(second!.leaseToken, first!.leaseToken)
          assert.strictEqual(second!.attempts, 2)

          assert.instanceOf(
            yield* Effect.flip(process.renewJob({
              tenantId: tenant!.id,
              workerId: "worker-a",
              jobId: job!.id,
              leaseToken: first!.leaseToken!,
            })),
            ProcessJobLeaseLost,
          )
          assert.instanceOf(
            yield* Effect.flip(process.completeJob({
              tenantId: tenant!.id,
              workerId: "worker-a",
              jobId: job!.id,
              leaseToken: first!.leaseToken!,
            })),
            ProcessJobLeaseLost,
          )
          assert.instanceOf(
            yield* Effect.flip(process.failJob({
              tenantId: tenant!.id,
              workerId: "worker-a",
              jobId: job!.id,
              leaseToken: first!.leaseToken!,
              error: "stale worker",
              retryAt: null,
            })),
            ProcessJobLeaseLost,
          )

          const retryAt = new Date(Date.now() - 1_000).toISOString()
          const pending = yield* process.failJob({
            tenantId: tenant!.id,
            workerId: "worker-b",
            jobId: job!.id,
            leaseToken: second!.leaseToken!,
            error: "retryable worker failure",
            retryAt,
          })
          assert.strictEqual(pending.status, "pending")
          assert.isNull(pending.leaseOwner)
          assert.isNull(pending.leaseToken)

          const third = yield* process.claimJob({
            tenantId: tenant!.id,
            workerId: "worker-c",
          })
          assert.isNotNull(third)
          assert.strictEqual(third!.attempts, ProcessJobMaxAttempts)
          const recovered = yield* process.failJob({
            tenantId: tenant!.id,
            workerId: "worker-c",
            jobId: job!.id,
            leaseToken: third!.leaseToken!,
            error: "retry exhausted",
            retryAt,
          })
          assert.strictEqual(recovered.status, "manual_recovery")
          assert.isNull(recovered.leaseOwner)
          assert.isNull(recovered.leaseToken)

          assert.instanceOf(
            yield* Effect.flip(process.completeJob({
              tenantId: tenant!.id,
              workerId: "worker-c",
              jobId: job!.id,
              leaseToken: third!.leaseToken!,
            })),
            ProcessJobLeaseLost,
          )
          assert.instanceOf(
            yield* Effect.flip(process.renewJob({
              tenantId: tenant!.id,
              workerId: "worker-c",
              jobId: crypto.randomUUID(),
              leaseToken: crypto.randomUUID(),
            })),
            ProcessJobNotFound,
          )
        }).pipe(Effect.provide(makeAuthorizationTestLayer([]))),
      )),
)
