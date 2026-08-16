import { and, eq, gte, lte } from "drizzle-orm"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

import {
  accountingPeriods,
  accounts,
  journalEntries,
  journalLines,
  legalEntityAccountingConfigurations,
  revenuePostingProfiles,
} from "../../../db/schema/accounting.ts"
import { Principal } from "../../auth/mod.ts"
import { AuthorizationDenied, AuthorizationService } from "../../authorization/mod.ts"
import { AccountingCapabilities } from "./capabilities.ts"
import { Database, DatabaseFailure, isDatabaseConstraint } from "../../kernel/mod.ts"
import { EventIdempotencyConflict, MessagingService } from "../../messaging/mod.ts"
import { AccountingRevenuePostedEvent, RevenuePostedEventPayload } from "./events.ts"

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const Uuid = Schema.String.check(Schema.isUUID())
const Money = Schema.String.check(Schema.isPattern(/^\d{1,12}(\.\d{1,2})?$/))
const CurrencyCode = Schema.String.check(Schema.isPattern(/^[A-Za-z]{3}$/))
const Precision = Schema.Literal(2)
const FiscalYearStartMonth = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 }))
const IsoDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))

export const AccountingConfiguration = Schema.Struct({
  tenantId: Schema.String,
  legalEntityId: Schema.String,
  baseCurrency: CurrencyCode,
  precision: Precision,
  fiscalYearStartMonth: FiscalYearStartMonth,
  postingEnabled: Schema.Boolean,
})

export const Account = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  code: Schema.String,
  name: Schema.String,
  type: Schema.Literals(["asset", "liability", "equity", "revenue", "expense"]),
})

export const JournalLine = Schema.Struct({
  accountId: Schema.String,
  debit: Money,
  credit: Money,
})

export const JournalEntry = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  reference: NonEmptyString,
  status: Schema.Literals(["posted", "reversed"]),
  postedAt: Schema.String,
  reversesEntryId: Schema.optional(Schema.String),
  lines: Schema.Array(JournalLine),
})

export const AccountingPeriod = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  legalEntityId: Schema.String,
  startsOn: IsoDate,
  endsOn: IsoDate,
  status: Schema.Literals(["open", "closed"]),
})

export const RevenuePostingProfile = Schema.Struct({
  tenantId: Schema.String,
  legalEntityId: Schema.String,
  receivableAccountId: Schema.String,
  revenueAccountId: Schema.String,
})

export type AccountingConfiguration = Schema.Schema.Type<typeof AccountingConfiguration>
export type Account = Schema.Schema.Type<typeof Account>
export type JournalLine = Schema.Schema.Type<typeof JournalLine>
export type JournalEntry = Schema.Schema.Type<typeof JournalEntry>
export type AccountingPeriod = Schema.Schema.Type<typeof AccountingPeriod>
export type RevenuePostingProfile = Schema.Schema.Type<typeof RevenuePostingProfile>

const ScopedInput = { principal: Principal, tenantId: Schema.String }

export const ConfigureLegalEntityInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Schema.String,
  baseCurrency: CurrencyCode,
  precision: Precision,
  fiscalYearStartMonth: FiscalYearStartMonth,
  postingEnabled: Schema.Boolean,
})

export const CreateAccountInput = Schema.Struct({
  ...ScopedInput,
  code: Schema.String,
  name: Schema.String,
  type: Account.fields.type,
})

export const PostJournalInput = Schema.Struct({
  ...ScopedInput,
  reference: NonEmptyString,
  lines: Schema.Array(JournalLine),
})

export const ConfigureRevenuePostingInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Schema.String,
  receivableAccountId: Schema.String,
  revenueAccountId: Schema.String,
})

export const OpenPeriodInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Schema.String,
  startsOn: IsoDate,
  endsOn: IsoDate,
})

export const ClosePeriodInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Schema.String,
  periodId: Schema.String,
})

export const PostRevenueForOrderInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Schema.String,
  orderId: Uuid,
  amount: Money,
  commandId: NonEmptyString,
  correlationId: NonEmptyString,
  causationId: Schema.optionalKey(Schema.NullOr(NonEmptyString)),
})

export const ReverseRevenueForOrderInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Schema.String,
  orderId: Uuid,
})

export class AccountingConfigurationAlreadyExists
  extends Schema.TaggedErrorClass<AccountingConfigurationAlreadyExists>()(
    "AccountingConfigurationAlreadyExists",
    {
      tenantId: Schema.String,
      legalEntityId: Schema.String,
    },
  ) {}
export class AccountingLegalEntityNotFound
  extends Schema.TaggedErrorClass<AccountingLegalEntityNotFound>()(
    "AccountingLegalEntityNotFound",
    {
      tenantId: Schema.String,
      legalEntityId: Schema.String,
    },
  ) {}
export class AccountAlreadyExists
  extends Schema.TaggedErrorClass<AccountAlreadyExists>()("AccountAlreadyExists", {
    tenantId: Schema.String,
    code: Schema.String,
  }) {}
export class AccountNotFound extends Schema.TaggedErrorClass<AccountNotFound>()("AccountNotFound", {
  tenantId: Schema.String,
}) {}
export class JournalReferenceAlreadyExists
  extends Schema.TaggedErrorClass<JournalReferenceAlreadyExists>()(
    "JournalReferenceAlreadyExists",
    {
      tenantId: Schema.String,
      reference: Schema.String,
    },
  ) {}
export class JournalIdempotencyConflict
  extends Schema.TaggedErrorClass<JournalIdempotencyConflict>()("JournalIdempotencyConflict", {
    tenantId: Schema.String,
    reference: Schema.String,
  }) {}
export class InvalidJournalLine
  extends Schema.TaggedErrorClass<InvalidJournalLine>()("InvalidJournalLine", {
    index: Schema.Int,
  }) {}
export class UnbalancedJournal
  extends Schema.TaggedErrorClass<UnbalancedJournal>()("UnbalancedJournal", {
    debit: Schema.String,
    credit: Schema.String,
  }) {}
export class RevenuePostingProfileAlreadyExists
  extends Schema.TaggedErrorClass<RevenuePostingProfileAlreadyExists>()(
    "RevenuePostingProfileAlreadyExists",
    { tenantId: Schema.String, legalEntityId: Schema.String },
  ) {}
export class InvalidRevenuePostingProfile
  extends Schema.TaggedErrorClass<InvalidRevenuePostingProfile>()("InvalidRevenuePostingProfile", {
    tenantId: Schema.String,
    legalEntityId: Schema.String,
  }) {}
export class AccountingPeriodOverlap
  extends Schema.TaggedErrorClass<AccountingPeriodOverlap>()("AccountingPeriodOverlap", {
    tenantId: Schema.String,
    legalEntityId: Schema.String,
  }) {}
export class AccountingPeriodNotFound
  extends Schema.TaggedErrorClass<AccountingPeriodNotFound>()("AccountingPeriodNotFound", {
    tenantId: Schema.String,
    legalEntityId: Schema.String,
    periodId: Schema.String,
  }) {}
export class AccountingPeriodNotOpen
  extends Schema.TaggedErrorClass<AccountingPeriodNotOpen>()("AccountingPeriodNotOpen", {
    tenantId: Schema.String,
    legalEntityId: Schema.String,
  }) {}
export class RevenuePostingProfileNotFound
  extends Schema.TaggedErrorClass<RevenuePostingProfileNotFound>()(
    "RevenuePostingProfileNotFound",
    {
      tenantId: Schema.String,
      legalEntityId: Schema.String,
    },
  ) {}
export class RevenueJournalNotFound
  extends Schema.TaggedErrorClass<RevenueJournalNotFound>()("RevenueJournalNotFound", {
    tenantId: Schema.String,
    legalEntityId: Schema.String,
    orderId: Uuid,
  }) {}

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

export interface AccountingService {
  readonly configureLegalEntity: (
    input: unknown,
  ) => Effect.Effect<
    AccountingConfiguration,
    AccountingConfigurationAlreadyExists | AccountingLegalEntityNotFound | CommonFailure
  >
  readonly createAccount: (
    input: unknown,
  ) => Effect.Effect<Account, AccountAlreadyExists | CommonFailure>
  readonly configureRevenuePosting: (
    input: unknown,
  ) => Effect.Effect<
    RevenuePostingProfile,
    | AccountNotFound
    | InvalidRevenuePostingProfile
    | RevenuePostingProfileAlreadyExists
    | CommonFailure
  >
  readonly openPeriod: (
    input: unknown,
  ) => Effect.Effect<AccountingPeriod, AccountingPeriodOverlap | CommonFailure>
  readonly closePeriod: (
    input: unknown,
  ) => Effect.Effect<AccountingPeriod, AccountingPeriodNotFound | CommonFailure>
  readonly postRevenueForOrder: (
    input: unknown,
  ) => Effect.Effect<
    JournalEntry,
    | AccountingPeriodNotOpen
    | EventIdempotencyConflict
    | JournalIdempotencyConflict
    | RevenuePostingProfileNotFound
    | CommonFailure
  >
  readonly reverseRevenueForOrder: (
    input: unknown,
  ) => Effect.Effect<
    JournalEntry,
    | AccountingPeriodNotOpen
    | RevenueJournalNotFound
    | RevenuePostingProfileNotFound
    | CommonFailure
  >
  readonly postJournal: (
    input: unknown,
  ) => Effect.Effect<
    JournalEntry,
    | AccountNotFound
    | JournalIdempotencyConflict
    | JournalReferenceAlreadyExists
    | InvalidJournalLine
    | UnbalancedJournal
    | CommonFailure
  >
}

export const AccountingService = Context.Service<AccountingService>(
  "EclipseERP/AccountingService",
)

const toMinor = (value: string) => {
  const [whole, fraction = ""] = value.split(".")
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))
}

const journalEntrySelection = {
  id: journalEntries.id,
  tenantId: journalEntries.tenantId,
  reference: journalEntries.reference,
  status: journalEntries.status,
  postedAt: journalEntries.postedAt,
}

const journalLineSelection = {
  accountId: journalLines.accountId,
  debit: journalLines.debit,
  credit: journalLines.credit,
}

const revenueReference = (legalEntityId: string, orderId: string) =>
  `revenue:${legalEntityId}:${orderId}`
const reversalReference = (legalEntityId: string, orderId: string) =>
  `revenue-reversal:${legalEntityId}:${orderId}`
const utcDate = (clock: Clock.Clock) =>
  new Date(clock.currentTimeMillisUnsafe()).toISOString().slice(0, 10)

const normalizeLines = (lines: readonly JournalLine[]) =>
  lines.map((line) => `${line.accountId}:${line.debit}:${line.credit}`).toSorted()

const validateLines = (lines: readonly JournalLine[]) => {
  if (lines.length < 2) return new UnbalancedJournal({ debit: "0", credit: "0" })
  let debit = 0n
  let credit = 0n
  for (const [index, line] of lines.entries()) {
    const lineDebit = toMinor(line.debit)
    const lineCredit = toMinor(line.credit)
    if ((lineDebit > 0n) === (lineCredit > 0n)) return new InvalidJournalLine({ index })
    debit += lineDebit
    credit += lineCredit
  }
  return debit === credit
    ? undefined
    : new UnbalancedJournal({ debit: String(debit), credit: String(credit) })
}

export const makeAccountingService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  const messaging = yield* MessagingService
  const clock = yield* Clock.Clock
  const now = () => new Date(clock.currentTimeMillisUnsafe())
  return {
    configureLegalEntity: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ConfigureLegalEntityInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: AccountingCapabilities.legalEntityConfigure,
        })
        const baseCurrency = decoded.baseCurrency.toUpperCase()
        const rows = yield* database.query(
          (db) =>
            db.insert(legalEntityAccountingConfigurations).values({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              baseCurrency,
              precision: decoded.precision,
              fiscalYearStartMonth: decoded.fiscalYearStartMonth,
              postingEnabled: decoded.postingEnabled,
            }).returning({
              tenantId: legalEntityAccountingConfigurations.tenantId,
              legalEntityId: legalEntityAccountingConfigurations.legalEntityId,
              baseCurrency: legalEntityAccountingConfigurations.baseCurrency,
              precision: legalEntityAccountingConfigurations.precision,
              fiscalYearStartMonth: legalEntityAccountingConfigurations.fiscalYearStartMonth,
              postingEnabled: legalEntityAccountingConfigurations.postingEnabled,
            }),
          "accounting.legal_entity.configure",
        ).pipe(
          Effect.mapError((error) => {
            if (isDatabaseConstraint(error, "legal_entity_accounting_configurations_pkey")) {
              return new AccountingConfigurationAlreadyExists({
                tenantId: decoded.tenantId,
                legalEntityId: decoded.legalEntityId,
              })
            }
            if (
              isDatabaseConstraint(
                error,
                "legal_entity_accounting_configurations_legal_entity_fkey",
                "23503",
              )
            ) {
              return new AccountingLegalEntityNotFound({
                tenantId: decoded.tenantId,
                legalEntityId: decoded.legalEntityId,
              })
            }
            return error
          }),
        )
        return { ...rows[0]!, precision: 2 as const }
      }),
    createAccount: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateAccountInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: AccountingCapabilities.accountCreate,
        })
        const code = decoded.code.trim().toUpperCase()
        const rows = yield* database.query(
          (db) =>
            db.insert(accounts).values({
              tenantId: decoded.tenantId,
              code,
              name: decoded.name.trim(),
              type: decoded.type,
            }).returning({
              id: accounts.id,
              tenantId: accounts.tenantId,
              code: accounts.code,
              name: accounts.name,
              type: accounts.type,
            }),
          "accounting.account.create",
        ).pipe(
          Effect.mapError((error) =>
            isDatabaseConstraint(error, "accounts_tenant_code_key")
              ? new AccountAlreadyExists({ tenantId: decoded.tenantId, code })
              : error
          ),
        )
        return rows[0]!
      }),
    configureRevenuePosting: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ConfigureRevenuePostingInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: AccountingCapabilities.revenueConfigure,
        })
        const accountRows = yield* database.query(
          (db) =>
            db.select({ id: accounts.id, type: accounts.type }).from(accounts).where(
              and(
                eq(accounts.tenantId, decoded.tenantId),
                eq(accounts.id, decoded.receivableAccountId),
              ),
            ),
          "accounting.revenue_profile.receivable.lookup",
        )
        const revenueRows = yield* database.query(
          (db) =>
            db.select({ id: accounts.id, type: accounts.type }).from(accounts).where(
              and(
                eq(accounts.tenantId, decoded.tenantId),
                eq(accounts.id, decoded.revenueAccountId),
              ),
            ),
          "accounting.revenue_profile.revenue.lookup",
        )
        if (accountRows[0] === undefined || revenueRows[0] === undefined) {
          return yield* Effect.fail(new AccountNotFound({ tenantId: decoded.tenantId }))
        }
        if (accountRows[0].type !== "asset" || revenueRows[0].type !== "revenue") {
          return yield* Effect.fail(
            new InvalidRevenuePostingProfile({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
            }),
          )
        }
        const rows = yield* database.query(
          (db) =>
            db.insert(revenuePostingProfiles).values(decoded).returning({
              tenantId: revenuePostingProfiles.tenantId,
              legalEntityId: revenuePostingProfiles.legalEntityId,
              receivableAccountId: revenuePostingProfiles.receivableAccountId,
              revenueAccountId: revenuePostingProfiles.revenueAccountId,
            }),
          "accounting.revenue_profile.configure",
        ).pipe(Effect.mapError((error) =>
          isDatabaseConstraint(error, "revenue_posting_profiles_pkey")
            ? new RevenuePostingProfileAlreadyExists({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
            })
            : error
        ))
        return rows[0]!
      }),
    openPeriod: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(OpenPeriodInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: AccountingCapabilities.periodOpen,
        })
        const rows = yield* database.query(
          (db) =>
            db.insert(accountingPeriods).values({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              startsOn: decoded.startsOn,
              endsOn: decoded.endsOn,
            }).returning({
              id: accountingPeriods.id,
              tenantId: accountingPeriods.tenantId,
              legalEntityId: accountingPeriods.legalEntityId,
              startsOn: accountingPeriods.startsOn,
              endsOn: accountingPeriods.endsOn,
              status: accountingPeriods.status,
            }),
          "accounting.period.open",
        ).pipe(Effect.mapError((error) =>
          isDatabaseConstraint(error, "accounting_periods_no_overlap", "23P01")
            ? new AccountingPeriodOverlap({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
            })
            : error
        ))
        return rows[0]!
      }),
    closePeriod: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ClosePeriodInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: AccountingCapabilities.periodClose,
        })
        const period = yield* database.transaction(
          async (tx) => {
            const rows = await tx.select({
              id: accountingPeriods.id,
              tenantId: accountingPeriods.tenantId,
              legalEntityId: accountingPeriods.legalEntityId,
              startsOn: accountingPeriods.startsOn,
              endsOn: accountingPeriods.endsOn,
              status: accountingPeriods.status,
            }).from(accountingPeriods).where(and(
              eq(accountingPeriods.tenantId, decoded.tenantId),
              eq(accountingPeriods.legalEntityId, decoded.legalEntityId),
              eq(accountingPeriods.id, decoded.periodId),
            )).for("update")
            const existing = rows[0]
            if (existing === undefined || existing.status === "closed") return existing
            return (await tx.update(accountingPeriods).set({
              status: "closed",
              updatedAt: now(),
            }).where(eq(accountingPeriods.id, existing.id)).returning({
              id: accountingPeriods.id,
              tenantId: accountingPeriods.tenantId,
              legalEntityId: accountingPeriods.legalEntityId,
              startsOn: accountingPeriods.startsOn,
              endsOn: accountingPeriods.endsOn,
              status: accountingPeriods.status,
            }))[0]!
          },
          "accounting.period.close",
        )
        if (period === undefined) {
          return yield* Effect.fail(
            new AccountingPeriodNotFound({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              periodId: decoded.periodId,
            }),
          )
        }
        return period
      }),
    postRevenueForOrder: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(PostRevenueForOrderInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: AccountingCapabilities.revenuePost,
        })
        const reference = revenueReference(decoded.legalEntityId, decoded.orderId)
        const commandId = decoded.commandId.trim()
        const correlationId = decoded.correlationId.trim()
        const causationId = decoded.causationId?.trim() ?? null
        const existing = yield* database.query(
          (db) =>
            db.select(journalEntrySelection).from(journalEntries).where(and(
              eq(journalEntries.tenantId, decoded.tenantId),
              eq(journalEntries.reference, reference),
            )),
          "accounting.revenue.lookup",
        )
        if (existing[0] !== undefined) {
          if (existing[0].status !== "posted" || existing[0].postedAt === null) {
            return yield* Effect.fail(
              new JournalIdempotencyConflict({ tenantId: decoded.tenantId, reference }),
            )
          }
          const lines = yield* database.query(
            (db) =>
              db.select(journalLineSelection).from(journalLines).where(and(
                eq(journalLines.tenantId, decoded.tenantId),
                eq(journalLines.entryId, existing[0]!.id),
              )),
            "accounting.revenue.lines.lookup",
          )
          const storedAmount = lines.find((line) => String(line.debit ?? "0") !== "0")?.debit
          if (String(storedAmount) !== decoded.amount) {
            return yield* Effect.fail(
              new JournalIdempotencyConflict({ tenantId: decoded.tenantId, reference }),
            )
          }
          return {
            id: existing[0].id,
            tenantId: existing[0].tenantId,
            reference,
            status: "posted" as const,
            postedAt: existing[0].postedAt!.toISOString(),
            lines: lines.map((line) => ({
              accountId: line.accountId,
              debit: String(line.debit ?? "0"),
              credit: String(line.credit ?? "0"),
            })),
          }
        }
        const journal = yield* database.withTransaction(
          Effect.gen(function* () {
            const mutation = yield* database.transaction(
              async (tx) => {
                const profile = (await tx.select().from(revenuePostingProfiles).where(and(
                  eq(revenuePostingProfiles.tenantId, decoded.tenantId),
                  eq(revenuePostingProfiles.legalEntityId, decoded.legalEntityId),
                )).for("update"))[0]
                if (profile === undefined) return { _tag: "profile-missing" as const }
                const configuration = (await tx.select({
                  postingEnabled: legalEntityAccountingConfigurations.postingEnabled,
                })
                  .from(legalEntityAccountingConfigurations).where(and(
                    eq(legalEntityAccountingConfigurations.tenantId, decoded.tenantId),
                    eq(legalEntityAccountingConfigurations.legalEntityId, decoded.legalEntityId),
                  )).for("update"))[0]
                if (configuration?.postingEnabled !== true) {
                  return { _tag: "period-closed" as const }
                }
                const currentPeriod =
                  (await tx.select({ id: accountingPeriods.id }).from(accountingPeriods).where(and(
                    eq(accountingPeriods.tenantId, decoded.tenantId),
                    eq(accountingPeriods.legalEntityId, decoded.legalEntityId),
                    eq(accountingPeriods.status, "open"),
                    lte(accountingPeriods.startsOn, utcDate(clock)),
                    gte(accountingPeriods.endsOn, utcDate(clock)),
                  )).for("update"))[0]
                if (currentPeriod === undefined) return { _tag: "period-closed" as const }
                const entry = (await tx.insert(journalEntries).values({
                  tenantId: decoded.tenantId,
                  reference,
                }).returning({ id: journalEntries.id }))[0]!
                const lines: readonly JournalLine[] = [
                  { accountId: profile.receivableAccountId, debit: decoded.amount, credit: "0" },
                  { accountId: profile.revenueAccountId, debit: "0", credit: decoded.amount },
                ]
                await tx.insert(journalLines).values(lines.map((line) => ({
                  tenantId: decoded.tenantId,
                  entryId: entry.id,
                  ...line,
                })))
                const postedAt = now()
                const posted = (await tx.update(journalEntries).set({
                  status: "posted",
                  postedAt,
                  updatedAt: postedAt,
                })
                  .where(eq(journalEntries.id, entry.id)).returning(journalEntrySelection))[0]!
                return {
                  _tag: "posted" as const,
                  journal: {
                    id: posted.id,
                    tenantId: posted.tenantId,
                    reference: posted.reference,
                    status: "posted" as const,
                    postedAt: posted.postedAt!.toISOString(),
                    lines,
                  },
                }
              },
              "accounting.revenue.post",
            )
            if (mutation._tag === "posted") {
              const payload = yield* Schema.decodeUnknownEffect(RevenuePostedEventPayload)({
                journalId: mutation.journal.id,
                legalEntityId: decoded.legalEntityId,
                orderId: decoded.orderId,
              })
              yield* messaging.append({
                eventId: crypto.randomUUID(),
                eventType: AccountingRevenuePostedEvent.id,
                eventVersion: AccountingRevenuePostedEvent.version,
                tenantId: decoded.tenantId,
                aggregateType: AccountingRevenuePostedEvent.aggregateType,
                aggregateId: mutation.journal.id,
                commandId,
                correlationId,
                causationId,
                idempotencyKey: decoded.orderId,
                actorPrincipalId: decoded.principal.userAccountId,
                occurredAt: mutation.journal.postedAt,
                payload,
              })
            }
            return mutation
          }),
          "accounting.revenue.post.atomic",
        ).pipe(Effect.mapError((error) =>
          isDatabaseConstraint(error, "journal_entries_reference_key")
            ? new JournalIdempotencyConflict({ tenantId: decoded.tenantId, reference })
            : error
        ))
        if (journal._tag === "profile-missing") {
          return yield* Effect.fail(
            new RevenuePostingProfileNotFound({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
            }),
          )
        }
        if (journal._tag === "period-closed") {
          return yield* Effect.fail(
            new AccountingPeriodNotOpen({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
            }),
          )
        }
        return journal.journal
      }),
    reverseRevenueForOrder: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ReverseRevenueForOrderInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: AccountingCapabilities.revenueReverse,
        })
        const sourceReference = revenueReference(decoded.legalEntityId, decoded.orderId)
        const reference = reversalReference(decoded.legalEntityId, decoded.orderId)
        const journal = yield* database.transaction(
          async (tx) => {
            const existing = (await tx.select(journalEntrySelection).from(journalEntries).where(and(
              eq(journalEntries.tenantId, decoded.tenantId),
              eq(journalEntries.reference, reference),
            )).for("update"))[0]
            if (existing !== undefined) return { _tag: "existing" as const, entry: existing }
            const profile =
              (await tx.select({ legalEntityId: revenuePostingProfiles.legalEntityId })
                .from(revenuePostingProfiles).where(and(
                  eq(revenuePostingProfiles.tenantId, decoded.tenantId),
                  eq(revenuePostingProfiles.legalEntityId, decoded.legalEntityId),
                )).for("update"))[0]
            if (profile === undefined) return { _tag: "profile-missing" as const }
            const configuration = (await tx.select({
              postingEnabled: legalEntityAccountingConfigurations.postingEnabled,
            })
              .from(legalEntityAccountingConfigurations).where(and(
                eq(legalEntityAccountingConfigurations.tenantId, decoded.tenantId),
                eq(legalEntityAccountingConfigurations.legalEntityId, decoded.legalEntityId),
              )).for("update"))[0]
            const currentPeriod =
              (await tx.select({ id: accountingPeriods.id }).from(accountingPeriods).where(and(
                eq(accountingPeriods.tenantId, decoded.tenantId),
                eq(accountingPeriods.legalEntityId, decoded.legalEntityId),
                eq(accountingPeriods.status, "open"),
                lte(accountingPeriods.startsOn, utcDate(clock)),
                gte(accountingPeriods.endsOn, utcDate(clock)),
              )).for("update"))[0]
            if (configuration?.postingEnabled !== true || currentPeriod === undefined) {
              return { _tag: "period-closed" as const }
            }
            const source = (await tx.select(journalEntrySelection).from(journalEntries).where(and(
              eq(journalEntries.tenantId, decoded.tenantId),
              eq(journalEntries.reference, sourceReference),
            )).for("update"))[0]
            if (source === undefined || source.status !== "posted") {
              return { _tag: "source-missing" as const }
            }
            const sourceLines = await tx.select(journalLineSelection).from(journalLines).where(and(
              eq(journalLines.tenantId, decoded.tenantId),
              eq(journalLines.entryId, source.id),
            ))
            const lines = sourceLines.map((line) => ({
              accountId: line.accountId,
              debit: String(line.credit ?? "0"),
              credit: String(line.debit ?? "0"),
            }))
            const entry = (await tx.insert(journalEntries).values({
              tenantId: decoded.tenantId,
              reference,
            }).returning({ id: journalEntries.id }))[0]!
            await tx.insert(journalLines).values(lines.map((line) => ({
              tenantId: decoded.tenantId,
              entryId: entry.id,
              ...line,
            })))
            const postedAt = now()
            const posted = (await tx.update(journalEntries).set({
              status: "reversed",
              reversesEntryId: source.id,
              postedAt,
              updatedAt: postedAt,
            })
              .where(eq(journalEntries.id, entry.id)).returning(journalEntrySelection))[0]!
            return {
              _tag: "reversed" as const,
              journal: {
                id: posted.id,
                tenantId: posted.tenantId,
                reference: posted.reference,
                status: "reversed" as const,
                postedAt: posted.postedAt!.toISOString(),
                reversesEntryId: source.id,
                lines,
              },
            }
          },
          "accounting.revenue.reverse",
        )
        if (journal._tag === "profile-missing") {
          return yield* Effect.fail(
            new RevenuePostingProfileNotFound({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
            }),
          )
        }
        if (journal._tag === "period-closed") {
          return yield* Effect.fail(
            new AccountingPeriodNotOpen({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
            }),
          )
        }
        if (journal._tag === "source-missing") {
          return yield* Effect.fail(
            new RevenueJournalNotFound({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              orderId: decoded.orderId,
            }),
          )
        }
        if (journal._tag === "existing") {
          const lines = yield* database.query(
            (db) =>
              db.select(journalLineSelection).from(journalLines).where(and(
                eq(journalLines.tenantId, decoded.tenantId),
                eq(journalLines.entryId, journal.entry.id),
              )),
            "accounting.revenue_reversal.lines.lookup",
          )
          return {
            id: journal.entry.id,
            tenantId: journal.entry.tenantId,
            reference,
            status: "reversed" as const,
            postedAt: journal.entry.postedAt!.toISOString(),
            lines: lines.map((line) => ({
              accountId: line.accountId,
              debit: String(line.debit ?? "0"),
              credit: String(line.credit ?? "0"),
            })),
          }
        }
        return journal.journal
      }),
    postJournal: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(PostJournalInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: AccountingCapabilities.journalPost,
        })
        const lineError = validateLines(decoded.lines)
        if (lineError !== undefined) return yield* Effect.fail(lineError)
        const reference = decoded.reference.trim()

        const loadExisting = () =>
          Effect.gen(function* () {
            const entries = yield* database.query(
              (db) =>
                db.select(journalEntrySelection)
                  .from(journalEntries)
                  .where(
                    and(
                      eq(journalEntries.tenantId, decoded.tenantId),
                      eq(journalEntries.reference, reference),
                    ),
                  ),
              "accounting.journal.lookup",
            )
            const entry = entries[0]
            if (entry === undefined || entry.status !== "posted" || entry.postedAt === null) {
              return yield* Effect.fail(
                new JournalReferenceAlreadyExists({
                  tenantId: decoded.tenantId,
                  reference,
                }),
              )
            }
            const lines = yield* database.query(
              (db) =>
                db.select(journalLineSelection)
                  .from(journalLines)
                  .where(
                    and(
                      eq(journalLines.tenantId, decoded.tenantId),
                      eq(journalLines.entryId, entry.id),
                    ),
                  ),
              "accounting.journal.lines.lookup",
            )
            const storedLines = lines.map((line) => ({
              accountId: line.accountId,
              debit: String(line.debit ?? "0"),
              credit: String(line.credit ?? "0"),
            }))
            if (
              JSON.stringify(normalizeLines(storedLines)) !==
                JSON.stringify(normalizeLines(decoded.lines))
            ) {
              return yield* Effect.fail(
                new JournalIdempotencyConflict({
                  tenantId: decoded.tenantId,
                  reference,
                }),
              )
            }
            return {
              id: entry.id,
              tenantId: entry.tenantId,
              reference: entry.reference,
              status: "posted" as const,
              postedAt: entry.postedAt.toISOString(),
              lines: decoded.lines,
            }
          })

        const result = yield* database.transaction(
          async (tx) => {
            const existingEntries = await tx.select(journalEntrySelection)
              .from(journalEntries)
              .where(
                and(
                  eq(journalEntries.tenantId, decoded.tenantId),
                  eq(journalEntries.reference, reference),
                ),
              )
              .for("update")
            const existing = existingEntries[0]
            if (existing !== undefined) {
              if (existing.status !== "posted" || existing.postedAt === null) {
                return { _tag: "idempotency-conflict" as const }
              }
              const lines = await tx.select(journalLineSelection)
                .from(journalLines)
                .where(
                  and(
                    eq(journalLines.tenantId, decoded.tenantId),
                    eq(journalLines.entryId, existing.id),
                  ),
                )
              const storedLines = lines.map((line) => ({
                accountId: line.accountId,
                debit: String(line.debit ?? "0"),
                credit: String(line.credit ?? "0"),
              }))
              if (
                JSON.stringify(normalizeLines(storedLines)) !==
                  JSON.stringify(normalizeLines(decoded.lines))
              ) {
                return { _tag: "idempotency-conflict" as const }
              }
              return {
                _tag: "existing" as const,
                journal: {
                  id: existing.id,
                  tenantId: existing.tenantId,
                  reference: existing.reference,
                  status: "posted" as const,
                  postedAt: existing.postedAt.toISOString(),
                  lines: decoded.lines,
                },
              }
            }

            const entry = (await tx.insert(journalEntries).values({
              tenantId: decoded.tenantId,
              reference,
            }).returning({ id: journalEntries.id }))[0]!

            await tx.insert(journalLines).values(
              decoded.lines.map((line) => ({
                tenantId: decoded.tenantId,
                entryId: entry.id,
                accountId: line.accountId,
                debit: line.debit,
                credit: line.credit,
              })),
            )

            const postedAt = now()
            const posted = (await tx.update(journalEntries)
              .set({ status: "posted", postedAt, updatedAt: postedAt })
              .where(eq(journalEntries.id, entry.id))
              .returning(journalEntrySelection))[0]!
            return {
              _tag: "created" as const,
              journal: {
                id: posted.id,
                tenantId: posted.tenantId,
                reference: posted.reference,
                status: "posted" as const,
                postedAt: posted.postedAt!.toISOString(),
                lines: decoded.lines,
              },
            }
          },
          "accounting.journal.post",
        ).pipe(
          Effect.mapError((error) => {
            if (isDatabaseConstraint(error, "journal_lines_account_fkey", "23503")) {
              return new AccountNotFound({ tenantId: decoded.tenantId })
            }
            if (isDatabaseConstraint(error, "journal_entries_reference_key")) {
              return new JournalReferenceAlreadyExists({
                tenantId: decoded.tenantId,
                reference,
              })
            }
            return error
          }),
          Effect.result,
        )
        if (Result.isFailure(result)) {
          if (result.failure instanceof JournalReferenceAlreadyExists) return yield* loadExisting()
          return yield* Effect.fail(result.failure)
        }
        if (result.success._tag === "idempotency-conflict") {
          return yield* Effect.fail(
            new JournalIdempotencyConflict({
              tenantId: decoded.tenantId,
              reference,
            }),
          )
        }
        return result.success.journal
      }),
  } satisfies AccountingService
})

export const makeAccountingTestLayer = () =>
  Layer.effect(
    AccountingService,
    Effect.gen(function* () {
      const authorization = yield* AuthorizationService
      const messaging = yield* MessagingService
      const clock = yield* Clock.Clock
      const configurations = new Map<string, AccountingConfiguration>()
      const profiles = new Map<string, RevenuePostingProfile>()
      const periods = new Map<string, AccountingPeriod>()
      const storedAccounts = new Map<string, Account>()
      const storedJournals = new Map<string, JournalEntry>()
      const nextId = () => crypto.randomUUID()
      const service: AccountingService = {
        configureLegalEntity: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(ConfigureLegalEntityInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: AccountingCapabilities.legalEntityConfigure,
            })
            const key = `${decoded.tenantId}:${decoded.legalEntityId}`
            if (configurations.has(key)) {
              return yield* Effect.fail(
                new AccountingConfigurationAlreadyExists({
                  tenantId: decoded.tenantId,
                  legalEntityId: decoded.legalEntityId,
                }),
              )
            }
            const configuration: AccountingConfiguration = {
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              baseCurrency: decoded.baseCurrency.toUpperCase(),
              precision: decoded.precision,
              fiscalYearStartMonth: decoded.fiscalYearStartMonth,
              postingEnabled: decoded.postingEnabled,
            }
            configurations.set(key, configuration)
            return configuration
          }),
        createAccount: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(CreateAccountInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: AccountingCapabilities.accountCreate,
            })
            const code = decoded.code.trim().toUpperCase()
            if (
              [...storedAccounts.values()].some((account) =>
                account.tenantId === decoded.tenantId && account.code === code
              )
            ) {
              return yield* Effect.fail(
                new AccountAlreadyExists({ tenantId: decoded.tenantId, code }),
              )
            }
            const account = {
              id: nextId(),
              tenantId: decoded.tenantId,
              code,
              name: decoded.name.trim(),
              type: decoded.type,
            }
            storedAccounts.set(account.id, account)
            return account
          }),
        configureRevenuePosting: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(ConfigureRevenuePostingInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: AccountingCapabilities.revenueConfigure,
            })
            const receivable = storedAccounts.get(decoded.receivableAccountId)
            const revenue = storedAccounts.get(decoded.revenueAccountId)
            if (
              receivable?.tenantId !== decoded.tenantId || revenue?.tenantId !== decoded.tenantId
            ) {
              return yield* Effect.fail(new AccountNotFound({ tenantId: decoded.tenantId }))
            }
            if (receivable.type !== "asset" || revenue.type !== "revenue") {
              return yield* Effect.fail(
                new InvalidRevenuePostingProfile({
                  tenantId: decoded.tenantId,
                  legalEntityId: decoded.legalEntityId,
                }),
              )
            }
            const key = `${decoded.tenantId}:${decoded.legalEntityId}`
            if (profiles.has(key)) {
              return yield* Effect.fail(
                new RevenuePostingProfileAlreadyExists({
                  tenantId: decoded.tenantId,
                  legalEntityId: decoded.legalEntityId,
                }),
              )
            }
            const profile: RevenuePostingProfile = {
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              receivableAccountId: decoded.receivableAccountId,
              revenueAccountId: decoded.revenueAccountId,
            }
            profiles.set(key, profile)
            return profile
          }),
        openPeriod: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(OpenPeriodInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: AccountingCapabilities.periodOpen,
            })
            const overlap = [...periods.values()].some((period) =>
              period.tenantId === decoded.tenantId &&
              period.legalEntityId === decoded.legalEntityId &&
              period.startsOn <= decoded.endsOn && decoded.startsOn <= period.endsOn
            )
            if (overlap) {
              return yield* Effect.fail(
                new AccountingPeriodOverlap({
                  tenantId: decoded.tenantId,
                  legalEntityId: decoded.legalEntityId,
                }),
              )
            }
            const period: AccountingPeriod = {
              id: nextId(),
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              startsOn: decoded.startsOn,
              endsOn: decoded.endsOn,
              status: "open",
            }
            periods.set(period.id, period)
            return period
          }),
        closePeriod: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(ClosePeriodInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: AccountingCapabilities.periodClose,
            })
            const period = periods.get(decoded.periodId)
            if (
              period === undefined || period.tenantId !== decoded.tenantId ||
              period.legalEntityId !== decoded.legalEntityId
            ) {
              return yield* Effect.fail(
                new AccountingPeriodNotFound({
                  tenantId: decoded.tenantId,
                  legalEntityId: decoded.legalEntityId,
                  periodId: decoded.periodId,
                }),
              )
            }
            const closed = { ...period, status: "closed" as const }
            periods.set(closed.id, closed)
            return closed
          }),
        postRevenueForOrder: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(PostRevenueForOrderInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: AccountingCapabilities.revenuePost,
            })
            const reference = revenueReference(decoded.legalEntityId, decoded.orderId)
            const commandId = decoded.commandId.trim()
            const correlationId = decoded.correlationId.trim()
            const causationId = decoded.causationId?.trim() ?? null
            const existing = storedJournals.get(`${decoded.tenantId}:${reference}`)
            if (existing !== undefined) {
              if (existing.lines[0]?.debit !== decoded.amount) {
                return yield* Effect.fail(
                  new JournalIdempotencyConflict({ tenantId: decoded.tenantId, reference }),
                )
              }
              return existing
            }
            const key = `${decoded.tenantId}:${decoded.legalEntityId}`
            const profile = profiles.get(key)
            if (profile === undefined) {
              return yield* Effect.fail(
                new RevenuePostingProfileNotFound({
                  tenantId: decoded.tenantId,
                  legalEntityId: decoded.legalEntityId,
                }),
              )
            }
            const today = utcDate(clock)
            if (
              configurations.get(key)?.postingEnabled !== true ||
              ![...periods.values()].some((period) =>
                period.tenantId === decoded.tenantId &&
                period.legalEntityId === decoded.legalEntityId &&
                period.status === "open" && period.startsOn <= today && today <= period.endsOn
              )
            ) {
              return yield* Effect.fail(
                new AccountingPeriodNotOpen({
                  tenantId: decoded.tenantId,
                  legalEntityId: decoded.legalEntityId,
                }),
              )
            }
            const journal: JournalEntry = {
              id: crypto.randomUUID(),
              tenantId: decoded.tenantId,
              reference,
              status: "posted",
              postedAt: new Date(clock.currentTimeMillisUnsafe()).toISOString(),
              lines: [
                { accountId: profile.receivableAccountId, debit: decoded.amount, credit: "0" },
                { accountId: profile.revenueAccountId, debit: "0", credit: decoded.amount },
              ],
            }
            yield* messaging.append({
              eventId: crypto.randomUUID(),
              eventType: AccountingRevenuePostedEvent.id,
              eventVersion: AccountingRevenuePostedEvent.version,
              tenantId: decoded.tenantId,
              aggregateType: AccountingRevenuePostedEvent.aggregateType,
              aggregateId: journal.id,
              commandId,
              correlationId,
              causationId,
              idempotencyKey: decoded.orderId,
              actorPrincipalId: decoded.principal.userAccountId,
              occurredAt: journal.postedAt,
              payload: {
                journalId: journal.id,
                legalEntityId: decoded.legalEntityId,
                orderId: decoded.orderId,
              },
            })
            storedJournals.set(`${decoded.tenantId}:${reference}`, journal)
            return journal
          }),
        reverseRevenueForOrder: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(ReverseRevenueForOrderInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: AccountingCapabilities.revenueReverse,
            })
            const reference = reversalReference(decoded.legalEntityId, decoded.orderId)
            const existing = storedJournals.get(`${decoded.tenantId}:${reference}`)
            if (existing !== undefined) return existing
            const key = `${decoded.tenantId}:${decoded.legalEntityId}`
            if (!profiles.has(key)) {
              return yield* Effect.fail(
                new RevenuePostingProfileNotFound({
                  tenantId: decoded.tenantId,
                  legalEntityId: decoded.legalEntityId,
                }),
              )
            }
            const today = utcDate(clock)
            if (
              configurations.get(key)?.postingEnabled !== true ||
              ![...periods.values()].some((period) =>
                period.tenantId === decoded.tenantId &&
                period.legalEntityId === decoded.legalEntityId &&
                period.status === "open" && period.startsOn <= today && today <= period.endsOn
              )
            ) {
              return yield* Effect.fail(
                new AccountingPeriodNotOpen({
                  tenantId: decoded.tenantId,
                  legalEntityId: decoded.legalEntityId,
                }),
              )
            }
            const source = storedJournals.get(
              `${decoded.tenantId}:${revenueReference(decoded.legalEntityId, decoded.orderId)}`,
            )
            if (source === undefined) {
              return yield* Effect.fail(
                new RevenueJournalNotFound({
                  tenantId: decoded.tenantId,
                  legalEntityId: decoded.legalEntityId,
                  orderId: decoded.orderId,
                }),
              )
            }
            const journal: JournalEntry = {
              id: nextId(),
              tenantId: decoded.tenantId,
              reference,
              status: "reversed",
              postedAt: new Date(clock.currentTimeMillisUnsafe()).toISOString(),
              reversesEntryId: source.id,
              lines: source.lines.map((line) => ({
                accountId: line.accountId,
                debit: line.credit,
                credit: line.debit,
              })),
            }
            storedJournals.set(`${decoded.tenantId}:${reference}`, journal)
            return journal
          }),
        postJournal: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(PostJournalInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: AccountingCapabilities.journalPost,
            })
            const error = validateLines(decoded.lines)
            if (error !== undefined) return yield* Effect.fail(error)
            if (
              decoded.lines.some((line) =>
                storedAccounts.get(line.accountId)?.tenantId !== decoded.tenantId
              )
            ) {
              return yield* Effect.fail(new AccountNotFound({ tenantId: decoded.tenantId }))
            }
            const reference = decoded.reference.trim()
            const key = `${decoded.tenantId}:${reference}`
            const existing = storedJournals.get(key)
            if (existing !== undefined) {
              if (
                JSON.stringify(normalizeLines(existing.lines)) !==
                  JSON.stringify(normalizeLines(decoded.lines))
              ) {
                return yield* Effect.fail(
                  new JournalIdempotencyConflict({
                    tenantId: decoded.tenantId,
                    reference,
                  }),
                )
              }
              return existing
            }
            const journal: JournalEntry = {
              id: nextId(),
              tenantId: decoded.tenantId,
              reference,
              status: "posted",
              postedAt: new Date(clock.currentTimeMillisUnsafe()).toISOString(),
              lines: decoded.lines,
            }
            storedJournals.set(key, journal)
            return journal
          }),
      }
      return service
    }),
  )
