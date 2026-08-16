import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { AuthorizationDenied, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import { DatabaseFailure } from "../../kernel/mod.ts"
import {
  type EventEnvelope,
  makeMessagingTestLayer,
  MessagingService,
} from "../../messaging/mod.ts"
import {
  AccountingConfigurationAlreadyExists,
  AccountingPeriodNotOpen,
  AccountingService,
  JournalEntry,
  JournalIdempotencyConflict,
  makeAccountingTestLayer,
  PostRevenueForOrderInput,
  ReverseRevenueForOrderInput,
  UnbalancedJournal,
} from "../mod.ts"

const principal = { userAccountId: "accountant", sessionId: "session" }
const tenantId = "00000000-0000-4000-8000-000000000001"
const revenueOrderIds = {
  open: "00000000-0000-4000-8000-000000000010",
  closed: "00000000-0000-4000-8000-000000000011",
  reverse: "00000000-0000-4000-8000-000000000012",
  idempotency: "00000000-0000-4000-8000-000000000013",
  rollback: "00000000-0000-4000-8000-000000000014",
} as const
const revenueMetadata = {
  commandId: "revenue-command-1",
  correlationId: "revenue-correlation-1",
  causationId: null,
} as const
const capabilities = [
  "accounting.legal_entity.configure",
  "accounting.account.create",
  "accounting.journal.post",
  "accounting.revenue.configure",
  "accounting.period.open",
  "accounting.period.close",
  "accounting.revenue.post",
  "accounting.revenue.reverse",
] as const

const withAccounting = <A, E>(
  program: Effect.Effect<A, E, AccountingService>,
  grantedCapabilities: readonly string[] = capabilities,
  messaging = makeMessagingTestLayer(),
) =>
  Effect.provide(
    program,
    makeAccountingTestLayer().pipe(
      Layer.provide(Layer.merge(
        makeAuthorizationTestLayer(
          grantedCapabilities.map((capability) => ({
            userAccountId: principal.userAccountId,
            tenantId,
            capability: capability as (typeof capabilities)[number],
          })),
        ),
        messaging,
      )),
    ),
  )

const makeRecordingMessagingLayer = (events: EventEnvelope[]) =>
  Layer.effect(
    MessagingService,
    Effect.map(MessagingService, (messaging) => ({
      ...messaging,
      append: (input: unknown) =>
        messaging.append(input).pipe(
          Effect.tap((event) => Effect.sync(() => events.push(event))),
        ),
    })),
  ).pipe(Layer.provide(makeMessagingTestLayer()))

const makeFailOnceMessagingLayer = () => {
  let fail = true
  return Layer.effect(
    MessagingService,
    Effect.map(MessagingService, (messaging) => ({
      ...messaging,
      append: (input: unknown) => {
        if (fail) {
          fail = false
          return Effect.fail(
            new DatabaseFailure({ operation: "messaging.test.append", cause: null }),
          )
        }
        return messaging.append(input)
      },
    })),
  ).pipe(Layer.provide(makeMessagingTestLayer()))
}

const prepareRevenuePosting = Effect.gen(function* () {
  const accounting = yield* AccountingService
  yield* accounting.configureLegalEntity({
    principal,
    tenantId,
    legalEntityId: "legal-entity-a",
    baseCurrency: "USD",
    precision: 2,
    fiscalYearStartMonth: 1,
    postingEnabled: true,
  })
  const receivable = yield* accounting.createAccount({
    principal,
    tenantId,
    code: "1100",
    name: "Receivable",
    type: "asset",
  })
  const revenue = yield* accounting.createAccount({
    principal,
    tenantId,
    code: "4000",
    name: "Revenue",
    type: "revenue",
  })
  yield* accounting.configureRevenuePosting({
    principal,
    tenantId,
    legalEntityId: "legal-entity-a",
    receivableAccountId: receivable.id,
    revenueAccountId: revenue.id,
  })
  const period = yield* accounting.openPeriod({
    principal,
    tenantId,
    legalEntityId: "legal-entity-a",
    startsOn: "1900-01-01",
    endsOn: "2100-12-31",
  })
  return { accounting, period }
})

describe("accounting contract", () => {
  it.effect("configures a legal entity once", () =>
    withAccounting(Effect.gen(function* () {
      const accounting = yield* AccountingService
      const configuration = yield* accounting.configureLegalEntity({
        principal,
        tenantId,
        legalEntityId: "legal-entity-a",
        baseCurrency: "usd",
        precision: 2,
        fiscalYearStartMonth: 1,
        postingEnabled: true,
      })
      assert.strictEqual(configuration.baseCurrency, "USD")
      assert.strictEqual(configuration.precision, 2)
      assert.strictEqual(configuration.fiscalYearStartMonth, 1)
      assert.strictEqual(configuration.postingEnabled, true)

      assert.strictEqual(
        (yield* Effect.flip(accounting.configureLegalEntity({
          principal,
          tenantId,
          legalEntityId: "legal-entity-b",
          baseCurrency: "USD",
          precision: 3,
          fiscalYearStartMonth: 1,
          postingEnabled: true,
        })))._tag,
        "SchemaError",
      )

      const error = yield* Effect.flip(accounting.configureLegalEntity({
        principal,
        tenantId,
        legalEntityId: "legal-entity-a",
        baseCurrency: "USD",
        precision: 2,
        fiscalYearStartMonth: 1,
        postingEnabled: true,
      }))
      assert.instanceOf(error, AccountingConfigurationAlreadyExists)
    })))

  it.effect("requires the legal entity configuration capability", () =>
    withAccounting(
      Effect.gen(function* () {
        const accounting = yield* AccountingService
        const error = yield* Effect.flip(accounting.configureLegalEntity({
          principal,
          tenantId,
          legalEntityId: "legal-entity-a",
          baseCurrency: "USD",
          precision: 2,
          fiscalYearStartMonth: 1,
          postingEnabled: true,
        }))
        assert.instanceOf(error, AuthorizationDenied)
      }),
      capabilities.filter((capability) => capability !== "accounting.legal_entity.configure"),
    ))

  it.effect("posts a balanced journal", () =>
    withAccounting(Effect.gen(function* () {
      const accounting = yield* AccountingService
      const cash = yield* accounting.createAccount({
        principal,
        tenantId,
        code: "1000",
        name: "Cash",
        type: "asset",
      })
      const revenue = yield* accounting.createAccount({
        principal,
        tenantId,
        code: "4000",
        name: "Revenue",
        type: "revenue",
      })
      const journal = yield* accounting.postJournal({
        principal,
        tenantId,
        reference: "SALE-1",
        lines: [
          { accountId: cash.id, debit: "125.00", credit: "0" },
          { accountId: revenue.id, debit: "0", credit: "125.00" },
        ],
      })

      assert.strictEqual(journal.status, "posted")
      assert.strictEqual(journal.lines.length, 2)
      const invalidReference = yield* Effect.flip(accounting.postJournal({
        principal,
        tenantId,
        reference: "   ",
        lines: [
          { accountId: cash.id, debit: "125.00", credit: "0" },
          { accountId: revenue.id, debit: "0", credit: "125.00" },
        ],
      }))
      assert.strictEqual(invalidReference._tag, "SchemaError")
      const repeated = yield* accounting.postJournal({
        principal,
        tenantId,
        reference: "SALE-1",
        lines: [
          { accountId: cash.id, debit: "125.00", credit: "0" },
          { accountId: revenue.id, debit: "0", credit: "125.00" },
        ],
      })
      assert.strictEqual(repeated.id, journal.id)
      const scaledReplay = yield* accounting.postJournal({
        principal,
        tenantId,
        reference: "SALE-1",
        lines: [
          { accountId: cash.id, debit: "125.0", credit: "0" },
          { accountId: revenue.id, debit: "0", credit: "125.0" },
        ],
      })
      assert.strictEqual(scaledReplay.id, journal.id)
      assert.instanceOf(
        yield* Effect.flip(accounting.postJournal({
          principal,
          tenantId,
          reference: "SALE-1",
          lines: [
            { accountId: cash.id, debit: "124.00", credit: "0" },
            { accountId: revenue.id, debit: "0", credit: "124.00" },
          ],
        })),
        JournalIdempotencyConflict,
      )
    })))

  it.effect("rejects blank journal references", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        Schema.decodeUnknownEffect(JournalEntry.fields.reference)("   "),
      )
      assert.strictEqual(failure._tag, "SchemaError")
    }))

  it.effect("rejects malformed revenue order identities", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        Schema.decodeUnknownEffect(PostRevenueForOrderInput.fields.orderId)("not-a-uuid"),
      )
      assert.strictEqual(failure._tag, "SchemaError")
    }))

  it.effect("rejects malformed revenue reversal identities", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        Schema.decodeUnknownEffect(ReverseRevenueForOrderInput.fields.orderId)("not-a-uuid"),
      )
      assert.strictEqual(failure._tag, "SchemaError")
    }))

  it.effect("posts revenue in an open period", () =>
    withAccounting(Effect.gen(function* () {
      const { accounting } = yield* prepareRevenuePosting
      const journal = yield* accounting.postRevenueForOrder({
        principal,
        tenantId,
        legalEntityId: "legal-entity-a",
        orderId: revenueOrderIds.open,
        amount: "125.00",
        ...revenueMetadata,
      })
      assert.strictEqual(journal.status, "posted")
      assert.deepStrictEqual(journal.lines.map(({ debit, credit }) => ({ debit, credit })), [
        { debit: "125.00", credit: "0" },
        { debit: "0", credit: "125.00" },
      ])
    })))

  it.effect("rejects revenue posting after the period closes", () =>
    withAccounting(Effect.gen(function* () {
      const { accounting, period } = yield* prepareRevenuePosting
      yield* accounting.closePeriod({
        principal,
        tenantId,
        legalEntityId: "legal-entity-a",
        periodId: period.id,
      })
      assert.instanceOf(
        yield* Effect.flip(accounting.postRevenueForOrder({
          principal,
          tenantId,
          legalEntityId: "legal-entity-a",
          orderId: revenueOrderIds.closed,
          amount: "125.00",
          ...revenueMetadata,
        })),
        AccountingPeriodNotOpen,
      )
    })))

  it.effect("reverses posted revenue idempotently", () =>
    withAccounting(Effect.gen(function* () {
      const { accounting } = yield* prepareRevenuePosting
      const posted = yield* accounting.postRevenueForOrder({
        principal,
        tenantId,
        legalEntityId: "legal-entity-a",
        orderId: revenueOrderIds.reverse,
        amount: "125.00",
        ...revenueMetadata,
      })
      const reversal = yield* accounting.reverseRevenueForOrder({
        principal,
        tenantId,
        legalEntityId: "legal-entity-a",
        orderId: revenueOrderIds.reverse,
      })
      const repeated = yield* accounting.reverseRevenueForOrder({
        principal,
        tenantId,
        legalEntityId: "legal-entity-a",
        orderId: revenueOrderIds.reverse,
      })
      assert.strictEqual(reversal.reversesEntryId, posted.id)
      assert.strictEqual(repeated.id, reversal.id)
    })))

  it.effect("revenue posted atomic publication preserves metadata and one event on replay", () => {
    const events: EventEnvelope[] = []
    return withAccounting(
      Effect.gen(function* () {
        const { accounting } = yield* prepareRevenuePosting
        const input = {
          principal,
          tenantId,
          legalEntityId: "legal-entity-a",
          orderId: revenueOrderIds.idempotency,
          amount: "125.00",
          commandId: "revenue-post-command",
          correlationId: "revenue-post-correlation",
          causationId: "order-confirmed-event",
        }
        const journal = yield* accounting.postRevenueForOrder(input)
        const replay = yield* accounting.postRevenueForOrder({
          ...input,
          commandId: "revenue-post-retry-command",
          correlationId: "revenue-post-retry-correlation",
        })

        assert.strictEqual(replay.id, journal.id)
        assert.strictEqual(events.length, 1)
        assert.notStrictEqual(events[0]?.eventId, journal.id)
        assert.deepStrictEqual(events[0], {
          eventId: events[0]!.eventId,
          eventType: "accounting.revenue.posted",
          eventVersion: 1,
          tenantId,
          aggregateType: "journal_entry",
          aggregateId: journal.id,
          commandId: input.commandId,
          correlationId: input.correlationId,
          causationId: input.causationId,
          idempotencyKey: input.orderId,
          actorPrincipalId: principal.userAccountId,
          occurredAt: journal.postedAt,
          payload: {
            journalId: journal.id,
            legalEntityId: input.legalEntityId,
            orderId: input.orderId,
          },
          publishedAt: null,
          attempts: 0,
        })
        assert.strictEqual(
          new Set([
            events[0]!.commandId,
            events[0]!.correlationId,
            events[0]!.causationId,
            events[0]!.idempotencyKey,
          ]).size,
          4,
        )
      }),
      capabilities,
      makeRecordingMessagingLayer(events),
    )
  })

  it.effect("revenue posted atomic publication rolls back when messaging append fails", () =>
    withAccounting(
      Effect.gen(function* () {
        const { accounting } = yield* prepareRevenuePosting
        const input = {
          principal,
          tenantId,
          legalEntityId: "legal-entity-a",
          orderId: revenueOrderIds.rollback,
          amount: "125.00",
          ...revenueMetadata,
        }

        assert.instanceOf(
          yield* Effect.flip(accounting.postRevenueForOrder(input)),
          DatabaseFailure,
        )
        const journal = yield* accounting.postRevenueForOrder(input)
        assert.strictEqual(journal.status, "posted")
      }),
      capabilities,
      makeFailOnceMessagingLayer(),
    ))

  it.effect("rejects an unbalanced journal", () =>
    withAccounting(Effect.gen(function* () {
      const accounting = yield* AccountingService
      const cash = yield* accounting.createAccount({
        principal,
        tenantId,
        code: "1000",
        name: "Cash",
        type: "asset",
      })
      const error = yield* Effect.flip(accounting.postJournal({
        principal,
        tenantId,
        reference: "BAD-1",
        lines: [
          { accountId: cash.id, debit: "10.00", credit: "0" },
          { accountId: cash.id, debit: "0", credit: "9.00" },
        ],
      }))
      assert.instanceOf(error, UnbalancedJournal)
    })))
})
