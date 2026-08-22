import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { AuthorizationDenied, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import {
  DatabaseFailure,
  FinancialVerificationSigner,
  generateEd25519FinancialVerificationSigner,
  makeFinancialVerificationKeyring,
} from "../../kernel/mod.ts"
import { SalesService } from "../../sales/mod.ts"
import {
  type EventEnvelope,
  makeMessagingTestLayer,
  MessagingService,
} from "../../messaging/mod.ts"
import {
  Account,
  AccountingCapabilities,
  AccountingConfiguration,
  AccountingConfigurationAlreadyExists,
  AccountingPeriod,
  AccountingPeriodNotOpen,
  AccountingService,
  AccountNotFound,
  ConfigureRevenuePostingInput,
  CreateFinancialJournalIntentInput,
  CreateFinancialRevenueIntentInput,
  FinancialCutoverControl,
  FinancialEngineCutoverBlocked,
  FinancialOperation,
  FinancialReconciliationCheckpoint,
  FinancialVerificationArtifact,
  JournalEntry,
  JournalIdempotencyConflict,
  JournalLine,
  makeAccountingTestLayer,
  OpenPeriodInput,
  PostRevenueForOrderInput,
  RevenuePostingProfile,
  ReverseRevenueForOrderInput,
  UnbalancedJournal,
} from "../mod.ts"

const principal = { userAccountId: "accountant", sessionId: "session" }
const tenantId = "00000000-0000-4000-8000-000000000001"
const otherTenantId = "00000000-0000-4000-8000-000000000002"
const revenueOrderIds = {
  open: "00000000-0000-4000-8000-000000000010",
  closed: "00000000-0000-4000-8000-000000000011",
  reverse: "00000000-0000-4000-8000-000000000012",
  idempotency: "00000000-0000-4000-8000-000000000013",
  rollback: "00000000-0000-4000-8000-000000000014",
} as const
const salesFacts = {
  getConfirmedOrderTotal: () => Effect.succeed("125.00"),
} as unknown as SalesService
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
      Layer.provide(Layer.mergeAll(
        makeAuthorizationTestLayer(
          [tenantId, otherTenantId].flatMap((tenantId) =>
            grantedCapabilities.map((capability) => ({
              userAccountId: principal.userAccountId,
              tenantId,
              capability: capability as (typeof capabilities)[number],
            }))
          ),
        ),
        messaging,
        Layer.succeed(SalesService, salesFacts),
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
      const cutoverBlocked = yield* Effect.flip(accounting.configureLegalEntity({
        principal,
        tenantId,
        legalEntityId: "legal-entity-tb",
        baseCurrency: "USD",
        precision: 2,
        fiscalYearStartMonth: 1,
        postingEnabled: true,
        financialEngine: "tigerbeetle",
      }))
      assert.instanceOf(cutoverBlocked, FinancialEngineCutoverBlocked)

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

  it.effect("denies accounting capability in an ungranted tenant", () =>
    withAccounting(Effect.gen(function* () {
      const accounting = yield* AccountingService
      assert.instanceOf(
        yield* Effect.flip(accounting.createAccount({
          principal,
          tenantId: "00000000-0000-4000-8000-000000000003",
          code: "UNGRANTED",
          name: "Untrusted Account",
          type: "asset",
        })),
        AuthorizationDenied,
      )
    })))

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
      const otherCash = yield* accounting.createAccount({
        principal,
        tenantId: otherTenantId,
        code: "1000",
        name: "Cash",
        type: "asset",
      })
      const otherRevenue = yield* accounting.createAccount({
        principal,
        tenantId: otherTenantId,
        code: "4000",
        name: "Revenue",
        type: "revenue",
      })
      const otherJournal = yield* accounting.postJournal({
        principal,
        tenantId: otherTenantId,
        reference: "SALE-1",
        lines: [
          { accountId: otherCash.id, debit: "125.00", credit: "0" },
          { accountId: otherRevenue.id, debit: "0", credit: "125.00" },
        ],
      })
      assert.notStrictEqual(otherJournal.id, journal.id)
      assert.strictEqual(otherJournal.tenantId, otherTenantId)
      assert.instanceOf(
        yield* Effect.flip(accounting.postJournal({
          principal,
          tenantId: otherTenantId,
          reference: "FOREIGN-ACCOUNT",
          lines: [
            { accountId: cash.id, debit: "125.00", credit: "0" },
            { accountId: revenue.id, debit: "0", credit: "125.00" },
          ],
        })),
        AccountNotFound,
      )
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

  it.effect("rejects non-timezone-qualified journal posted timestamps", () =>
    Effect.gen(function* () {
      const dateOnly = yield* Effect.flip(
        Schema.decodeUnknownEffect(JournalEntry.fields.postedAt)("2026-08-20"),
      )
      assert.strictEqual(dateOnly._tag, "SchemaError")
      const malformed = yield* Effect.flip(
        Schema.decodeUnknownEffect(JournalEntry.fields.postedAt)("not-a-timestamp"),
      )
      assert.strictEqual(malformed._tag, "SchemaError")
    }))

  it.effect("rejects malformed journal entry identities", () =>
    Effect.gen(function* () {
      for (const field of ["id", "tenantId", "reversesEntryId"] as const) {
        const failure = yield* Effect.flip(
          Schema.decodeUnknownEffect(JournalEntry.fields[field])("not-a-uuid"),
        )
        assert.strictEqual(failure._tag, "SchemaError")
      }
    }))

  it.effect("rejects contradictory journal reversal state", () =>
    Effect.gen(function* () {
      const base = {
        id: "00000000-0000-4000-8000-000000000030",
        tenantId,
        reference: "journal-1",
        postedAt: "2026-08-20T00:00:00.000Z",
        lines: [{
          accountId: "00000000-0000-4000-8000-000000000031",
          debit: "1",
          credit: "0",
        }],
      }
      const missingSource = yield* Effect.flip(
        Schema.decodeUnknownEffect(JournalEntry)({ ...base, status: "reversed" }),
      )
      assert.strictEqual(missingSource._tag, "SchemaError")
      const unexpectedSource = yield* Effect.flip(
        Schema.decodeUnknownEffect(JournalEntry)({
          ...base,
          status: "posted",
          reversesEntryId: "00000000-0000-4000-8000-000000000032",
        }),
      )
      assert.strictEqual(unexpectedSource._tag, "SchemaError")
    }))

  it.effect("rejects malformed revenue posting profile identities", () =>
    Effect.gen(function* () {
      for (
        const field of [
          "tenantId",
          "legalEntityId",
          "receivableAccountId",
          "revenueAccountId",
        ] as const
      ) {
        const failure = yield* Effect.flip(
          Schema.decodeUnknownEffect(RevenuePostingProfile.fields[field])("not-a-uuid"),
        )
        assert.strictEqual(failure._tag, "SchemaError")
      }
    }))

  it.effect("rejects duplicate revenue posting accounts", () =>
    Effect.gen(function* () {
      const inputFailure = yield* Effect.flip(
        Schema.decodeUnknownEffect(ConfigureRevenuePostingInput)({
          principal,
          tenantId,
          legalEntityId: "legal-entity-a",
          receivableAccountId: "account-1",
          revenueAccountId: "account-1",
        }),
      )
      assert.strictEqual(inputFailure._tag, "SchemaError")
      const outputFailure = yield* Effect.flip(
        Schema.decodeUnknownEffect(RevenuePostingProfile)({
          tenantId,
          legalEntityId: "00000000-0000-4000-8000-000000000050",
          receivableAccountId: "00000000-0000-4000-8000-000000000051",
          revenueAccountId: "00000000-0000-4000-8000-000000000051",
        }),
      )
      assert.strictEqual(outputFailure._tag, "SchemaError")
    }))

  it.effect("rejects malformed accounting period identities", () =>
    Effect.gen(function* () {
      for (const field of ["id", "tenantId", "legalEntityId"] as const) {
        const failure = yield* Effect.flip(
          Schema.decodeUnknownEffect(AccountingPeriod.fields[field])("not-a-uuid"),
        )
        assert.strictEqual(failure._tag, "SchemaError")
      }
    }))

  it.effect("rejects reversed accounting period dates", () =>
    Effect.gen(function* () {
      const inputFailure = yield* Effect.flip(
        Schema.decodeUnknownEffect(OpenPeriodInput)({
          principal,
          tenantId,
          legalEntityId: "legal-entity-a",
          startsOn: "2026-08-20",
          endsOn: "2026-08-19",
        }),
      )
      assert.strictEqual(inputFailure._tag, "SchemaError")
      const outputFailure = yield* Effect.flip(
        Schema.decodeUnknownEffect(AccountingPeriod)({
          id: "00000000-0000-4000-8000-000000000040",
          tenantId,
          legalEntityId: "00000000-0000-4000-8000-000000000041",
          startsOn: "2026-08-20",
          endsOn: "2026-08-19",
          status: "open",
        }),
      )
      assert.strictEqual(outputFailure._tag, "SchemaError")
    }))

  it.effect("rejects malformed journal line account identities", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        Schema.decodeUnknownEffect(JournalLine.fields.accountId)("not-a-uuid"),
      )
      assert.strictEqual(failure._tag, "SchemaError")
    }))

  it.effect("rejects zero-sided and double-sided journal lines", () =>
    Effect.gen(function* () {
      const zeroSided = yield* Effect.flip(
        Schema.decodeUnknownEffect(JournalLine)({
          accountId: "account-1",
          debit: "0.00",
          credit: "0",
        }),
      )
      assert.strictEqual(zeroSided._tag, "SchemaError")
      const doubleSided = yield* Effect.flip(
        Schema.decodeUnknownEffect(JournalLine)({
          accountId: "account-1",
          debit: "1.00",
          credit: "0.01",
        }),
      )
      assert.strictEqual(doubleSided._tag, "SchemaError")
    }))

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

  it.effect("rejects financial operation mapping versions outside PostgreSQL integer range", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        Schema.decodeUnknownEffect(CreateFinancialRevenueIntentInput.fields.mappingVersion)(
          2_147_483_648,
        ),
      )
      assert.strictEqual(failure._tag, "SchemaError")
    }))

  it.effect("rejects blank financial operation identities", () =>
    Effect.gen(function* () {
      for (const operationId of ["", "   "]) {
        const failure = yield* Effect.flip(
          Schema.decodeUnknownEffect(FinancialOperation.fields.operationId)(operationId),
        )
        assert.strictEqual(failure._tag, "SchemaError")
      }
    }))

  it.effect("rejects unresolved cutover operation counts outside PostgreSQL integer range", () =>
    Effect.gen(function* () {
      const negative = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialCutoverControl.fields.unresolvedAcceptedOperations)(
          -1,
        ),
      )
      assert.strictEqual(negative._tag, "SchemaError")
      const overflow = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialCutoverControl.fields.unresolvedAcceptedOperations)(
          2_147_483_648,
        ),
      )
      assert.strictEqual(overflow._tag, "SchemaError")
    }))

  it.effect("rejects blank financial operation terminal metadata", () =>
    Effect.gen(function* () {
      for (
        const field of [
          "engineAcceptedAt",
          "rejectionReason",
          "recoveryReason",
          "lastError",
        ] as const
      ) {
        const failure = yield* Effect.flip(
          Schema.decodeUnknownEffect(FinancialOperation.fields[field])("   "),
        )
        assert.strictEqual(failure._tag, "SchemaError")
      }
    }))

  it.effect("rejects mismatched financial operation source identities", () =>
    Effect.gen(function* () {
      const operation = {
        id: "00000000-0000-4000-8000-000000000020",
        tenantId,
        legalEntityId: "00000000-0000-4000-8000-000000000021",
        periodId: "00000000-0000-4000-8000-000000000022",
        operationId: "operation-1",
        engine: "postgresql",
        engineVerified: true,
        journalId: "00000000-0000-4000-8000-000000000023",
        reference: "reference-1",
        currency: "USD",
        mappingVersion: 1,
        status: "intent",
        attempts: 0,
        scheduledAt: "2026-08-20T00:00:00.000Z",
        submittedAt: null,
        engineAcceptedAt: null,
        rejectionReason: null,
        recoveryReason: null,
        observedEngine: null,
        lastError: null,
        reconciledAt: null,
      }
      const reversedWithoutSource = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialOperation)({
          ...operation,
          operationType: "journal_reverse",
          sourceJournalId: null,
        }),
      )
      assert.strictEqual(reversedWithoutSource._tag, "SchemaError")
      const postedWithSource = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialOperation)({
          ...operation,
          operationType: "journal_post",
          sourceJournalId: "00000000-0000-4000-8000-000000000024",
        }),
      )
      assert.strictEqual(postedWithSource._tag, "SchemaError")

      const intent = {
        principal,
        tenantId,
        legalEntityId: "00000000-0000-4000-8000-000000000021",
        operationId: "operation-1",
        reference: "reference-1",
        currency: "USD",
        mappingVersion: 1,
        lines: [{
          accountId: "00000000-0000-4000-8000-000000000025",
          debit: "1",
          credit: "0",
        }],
        correlationId: "correlation-1",
      }
      const reversedIntentWithoutSource = yield* Effect.flip(
        Schema.decodeUnknownEffect(CreateFinancialJournalIntentInput)({
          ...intent,
          operationType: "journal_reverse",
          sourceJournalId: null,
        }),
      )
      assert.strictEqual(reversedIntentWithoutSource._tag, "SchemaError")
      const postedIntentWithSource = yield* Effect.flip(
        Schema.decodeUnknownEffect(CreateFinancialJournalIntentInput)({
          ...intent,
          operationType: "journal_post",
          sourceJournalId: "00000000-0000-4000-8000-000000000024",
        }),
      )
      assert.strictEqual(postedIntentWithSource._tag, "SchemaError")
    }))

  it.effect("rejects invalid financial intent journal line amounts", () =>
    Effect.gen(function* () {
      const input = {
        principal,
        tenantId,
        legalEntityId: "00000000-0000-4000-8000-000000000021",
        operationId: "operation-lines-1",
        reference: "reference-lines-1",
        currency: "USD",
        mappingVersion: 1,
        correlationId: "correlation-lines-1",
      }
      for (const [debit, credit] of [["0", "0"], ["1", "1"]] as const) {
        const failure = yield* Effect.flip(
          Schema.decodeUnknownEffect(CreateFinancialJournalIntentInput)({
            ...input,
            lines: [{
              accountId: "00000000-0000-4000-8000-000000000025",
              debit,
              credit,
            }],
          }),
        )
        assert.strictEqual(failure._tag, "SchemaError")
      }
    }))

  it.effect("rejects malformed cutover control timestamps", () =>
    Effect.gen(function* () {
      const dateOnly = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialCutoverControl.fields.approvedAt)("2026-08-20"),
      )
      assert.strictEqual(dateOnly._tag, "SchemaError")
      const malformed = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialCutoverControl.fields.activatedAt)(
          "not-a-timestamp",
        ),
      )
      assert.strictEqual(malformed._tag, "SchemaError")
    }))

  it.effect("rejects contradictory cutover control status metadata", () =>
    Effect.gen(function* () {
      const base = {
        tenantId,
        legalEntityId: "00000000-0000-4000-8000-000000000041",
        sourceEngine: "postgresql",
        targetEngine: "tigerbeetle",
        cutoverWatermark: null,
        verificationHash: null,
        openingBalanceVerified: false,
        historicalBoundaryVerified: false,
        reconciliationHealthy: false,
        backupRecoveryVerified: false,
        evidenceArtifactId: null,
        unresolvedAcceptedOperations: 0,
        approvedBy: null,
        approvedAt: null,
        activatedBy: null,
        activatedAt: null,
        lastError: null,
      }
      const invalidApproval = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialCutoverControl)({
          ...base,
          status: "approved",
        }),
      )
      assert.strictEqual(invalidApproval._tag, "SchemaError")
      const invalidActivation = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialCutoverControl)({
          ...base,
          status: "tigerbeetle",
          cutoverWatermark: "watermark-1",
          verificationHash: "hash-1",
          openingBalanceVerified: true,
          historicalBoundaryVerified: true,
          reconciliationHealthy: true,
          backupRecoveryVerified: true,
          evidenceArtifactId: "00000000-0000-4000-8000-000000000042",
          approvedBy: "accountant",
          approvedAt: "2026-08-20T00:00:00.000Z",
        }),
      )
      assert.strictEqual(invalidActivation._tag, "SchemaError")
    }))

  it.effect("rejects financial operation status metadata contradictions", () =>
    Effect.gen(function* () {
      const operation = {
        id: "00000000-0000-4000-8000-000000000030",
        tenantId,
        legalEntityId: "00000000-0000-4000-8000-000000000031",
        periodId: "00000000-0000-4000-8000-000000000032",
        operationId: "operation-status-1",
        operationType: "journal_post",
        engine: "postgresql",
        engineVerified: true,
        journalId: "00000000-0000-4000-8000-000000000033",
        sourceJournalId: null,
        reference: "reference-status-1",
        currency: "USD",
        mappingVersion: 1,
        status: "intent",
        attempts: 0,
        scheduledAt: "2026-08-20T00:00:00.000Z",
        submittedAt: null,
        engineAcceptedAt: null,
        rejectionReason: null,
        recoveryReason: null,
        observedEngine: null,
        lastError: null,
        reconciledAt: null,
      }
      for (
        const invalidState of [
          { status: "accepted" },
          { status: "rejected" },
          { status: "manual_recovery" },
          { status: "reconciled" },
          { status: "intent", recoveryReason: "unexpected-recovery" },
        ]
      ) {
        const failure = yield* Effect.flip(
          Schema.decodeUnknownEffect(FinancialOperation)({ ...operation, ...invalidState }),
        )
        assert.strictEqual(failure._tag, "SchemaError")
      }
    }))

  it.effect("rejects malformed account identities", () =>
    Effect.gen(function* () {
      for (const field of ["id", "tenantId"] as const) {
        const failure = yield* Effect.flip(
          Schema.decodeUnknownEffect(Account.fields[field])("not-a-uuid"),
        )
        assert.strictEqual(failure._tag, "SchemaError")
      }
    }))

  it.effect("rejects malformed accounting configuration identities", () =>
    Effect.gen(function* () {
      for (const field of ["tenantId", "legalEntityId"] as const) {
        const failure = yield* Effect.flip(
          Schema.decodeUnknownEffect(AccountingConfiguration.fields[field])("not-a-uuid"),
        )
        assert.strictEqual(failure._tag, "SchemaError")
      }
    }))

  it.effect("rejects malformed financial verification artifact timestamps", () =>
    Effect.gen(function* () {
      const dateOnly = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialVerificationArtifact.fields.createdAt)("2026-08-20"),
      )
      assert.strictEqual(dateOnly._tag, "SchemaError")
      const malformed = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialVerificationArtifact.fields.createdAt)(
          "not-a-timestamp",
        ),
      )
      assert.strictEqual(malformed._tag, "SchemaError")
    }))

  it.effect("rejects financial operation attempts outside PostgreSQL integer range", () =>
    Effect.gen(function* () {
      const negative = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialOperation.fields.attempts)(-1),
      )
      assert.strictEqual(negative._tag, "SchemaError")
      const overflow = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialOperation.fields.attempts)(2_147_483_648),
      )
      assert.strictEqual(overflow._tag, "SchemaError")
    }))

  it.effect("rejects financial checkpoint counts outside PostgreSQL integer range", () =>
    Effect.gen(function* () {
      const negative = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialReconciliationCheckpoint.fields.mismatchCount)(-1),
      )
      assert.strictEqual(negative._tag, "SchemaError")
      const overflow = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialReconciliationCheckpoint.fields.orphanCount)(
          2_147_483_648,
        ),
      )
      assert.strictEqual(overflow._tag, "SchemaError")
    }))

  it.effect("rejects verified financial checkpoints with mismatch evidence", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialReconciliationCheckpoint)({
          id: "00000000-0000-4000-8000-000000000030",
          tenantId,
          legalEntityId: "00000000-0000-4000-8000-000000000031",
          engine: "tigerbeetle",
          status: "verified",
          recoveryWatermark: "recovery-1",
          sourceWatermark: "source-1",
          targetWatermark: "target-1",
          sourceSnapshotRef: "source-snapshot-1",
          targetSnapshotRef: "target-snapshot-1",
          operationSetHash: "0".repeat(64),
          accountBalanceHash: "1".repeat(64),
          transferSetHash: "2".repeat(64),
          projectionHash: null,
          evidenceArtifactId: null,
          mismatchCount: 1,
          orphanCount: 0,
          checkedBy: "principal-1",
          checkedAt: "2026-08-20T00:00:00.000Z",
        }),
      )
      assert.strictEqual(failure._tag, "SchemaError")
    }))

  it.effect("rejects malformed financial checkpoint timestamps", () =>
    Effect.gen(function* () {
      const dateOnly = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialReconciliationCheckpoint.fields.checkedAt)(
          "2026-08-20",
        ),
      )
      assert.strictEqual(dateOnly._tag, "SchemaError")
      const malformed = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialReconciliationCheckpoint.fields.checkedAt)(
          "not-a-timestamp",
        ),
      )
      assert.strictEqual(malformed._tag, "SchemaError")
    }))

  it.effect("rejects malformed financial operation timestamps", () =>
    Effect.gen(function* () {
      const scheduled = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialOperation.fields.scheduledAt)("2026-08-20"),
      )
      assert.strictEqual(scheduled._tag, "SchemaError")
      const submitted = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialOperation.fields.submittedAt)("not-a-timestamp"),
      )
      assert.strictEqual(submitted._tag, "SchemaError")
      const reconciled = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialOperation.fields.reconciledAt)("2026-08-20"),
      )
      assert.strictEqual(reconciled._tag, "SchemaError")
    }))

  it.effect("accepts revenue posting without a caller amount", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(PostRevenueForOrderInput)({
        principal,
        tenantId,
        legalEntityId: "legal-entity-a",
        orderId: revenueOrderIds.open,
        commandId: "revenue-derived-command",
        correlationId: "revenue-derived-correlation",
        causationId: null,
      })
      assert.strictEqual(decoded.orderId, revenueOrderIds.open)
      assert.isUndefined(decoded.amount)
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
          amount: "99.99",
          commandId: "revenue-post-retry-command",
          correlationId: "revenue-post-retry-correlation",
        })

        assert.strictEqual(replay.id, journal.id)
        assert.strictEqual(replay.lines[0]?.debit, "125.00")
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

  it.effect("approves an artifact after its signing key rotates", () =>
    Effect.gen(function* () {
      const oldKey = yield* generateEd25519FinancialVerificationSigner("old-key")
      const currentKey = yield* generateEd25519FinancialVerificationSigner("current-key")
      let signer = oldKey.signer
      const rotatingSigner = {
        get algorithm() {
          return signer.algorithm
        },
        get keyId() {
          return signer.keyId
        },
        sign: (payload: Uint8Array) => signer.sign(payload),
        verify: (payload: Uint8Array, signature: Uint8Array) => signer.verify(payload, signature),
      }
      const legalEntityId = "00000000-0000-4000-8000-000000000003"
      const authorization = makeAuthorizationTestLayer([
        AccountingCapabilities.legalEntityConfigure,
        AccountingCapabilities.financialEngineActivate,
        AccountingCapabilities.financialEvidenceRecord,
      ].map((capability) => ({
        userAccountId: principal.userAccountId,
        tenantId,
        capability,
      })))
      const accounting = yield* Effect.provide(
        Effect.service(AccountingService),
        makeAccountingTestLayer().pipe(
          Layer.provide(Layer.mergeAll(
            authorization,
            makeMessagingTestLayer(),
            Layer.succeed(SalesService, salesFacts),
            Layer.succeed(FinancialVerificationSigner, rotatingSigner),
            makeFinancialVerificationKeyring([{
              algorithm: oldKey.signer.algorithm,
              keyId: oldKey.signer.keyId,
              verify: oldKey.signer.verify,
            }]),
          )),
        ),
      )
      yield* accounting.configureLegalEntity({
        principal,
        tenantId,
        legalEntityId,
        baseCurrency: "USD",
        precision: 2,
        fiscalYearStartMonth: 1,
        postingEnabled: true,
      })
      yield* accounting.prepareTigerBeetleCutover({ principal, tenantId, legalEntityId })
      const artifact = yield* accounting.recordFinancialVerificationArtifact({
        principal,
        tenantId,
        evidence: {
          tenantId,
          legalEntityId,
          kind: "cutover_rehearsal",
          completeness: "bounded",
          scope: `tenant:${tenantId}/legal-entity:${legalEntityId}`,
          schemaVersion: 1,
          mappingVersion: 1,
          currency: "USD",
          sourceWatermark: "postgres:1",
          targetWatermark: "tigerbeetle:1",
          sourceSnapshotRef: "postgres:snapshot",
          targetSnapshotRef: "tigerbeetle:snapshot",
          operationSetHash: "0".repeat(64),
          accountBalanceHash: "1".repeat(64),
          transferSetHash: "2".repeat(64),
          projectionHash: "3".repeat(64),
          sourceDebitMinor: "100",
          sourceCreditMinor: "100",
          targetDebitMinor: "100",
          targetCreditMinor: "100",
          accountCount: 1,
          operationCount: 1,
          transferCount: 1,
          mismatchCount: 0,
          startedAt: "2026-08-18T00:00:00.000Z",
          completedAt: "2026-08-18T00:01:00.000Z",
        },
      })

      signer = currentKey.signer
      const approved = yield* accounting.approveTigerBeetleCutover({
        principal,
        tenantId,
        legalEntityId,
        evidenceArtifactId: artifact.id,
      })

      assert.strictEqual(artifact.signingKeyId, "old-key")
      assert.strictEqual(rotatingSigner.keyId, "current-key")
      assert.strictEqual(approved.status, "approved")
    }))
})
