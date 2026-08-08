import { eq } from "drizzle-orm"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  accounts,
  journalEntries,
  journalLines,
  legalEntityAccountingConfigurations,
} from "../../../db/schema/accounting.ts"
import { Principal } from "../../auth/mod.ts"
import { AuthorizationDenied, AuthorizationService } from "../../authorization/mod.ts"
import { AccountingCapabilities } from "./capabilities.ts"
import { Database, DatabaseFailure, isDatabaseConstraint } from "../../kernel/mod.ts"

const Money = Schema.String.check(Schema.isPattern(/^\d{1,12}(\.\d{1,2})?$/))
const CurrencyCode = Schema.String.check(Schema.isPattern(/^[A-Za-z]{3}$/))
const Precision = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 18 }))
const FiscalYearStartMonth = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 }))

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
  reference: Schema.String,
  status: Schema.Literal("posted"),
  postedAt: Schema.String,
  lines: Schema.Array(JournalLine),
})

export type AccountingConfiguration = Schema.Schema.Type<typeof AccountingConfiguration>
export type Account = Schema.Schema.Type<typeof Account>
export type JournalLine = Schema.Schema.Type<typeof JournalLine>
export type JournalEntry = Schema.Schema.Type<typeof JournalEntry>

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
  reference: Schema.String,
  lines: Schema.Array(JournalLine),
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
export class InvalidJournalLine
  extends Schema.TaggedErrorClass<InvalidJournalLine>()("InvalidJournalLine", {
    index: Schema.Int,
  }) {}
export class UnbalancedJournal
  extends Schema.TaggedErrorClass<UnbalancedJournal>()("UnbalancedJournal", {
    debit: Schema.String,
    credit: Schema.String,
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
  readonly postJournal: (
    input: unknown,
  ) => Effect.Effect<
    JournalEntry,
    | AccountNotFound
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
      return rows[0]!
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

      const result = yield* database.transaction(
        async (tx) => {
          const entry = (await tx.insert(journalEntries).values({
            tenantId: decoded.tenantId,
            reference: decoded.reference.trim(),
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
            .returning({
              id: journalEntries.id,
              tenantId: journalEntries.tenantId,
              reference: journalEntries.reference,
              status: journalEntries.status,
              postedAt: journalEntries.postedAt,
            }))[0]!
          return { ...posted, lines: decoded.lines }
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
              reference: decoded.reference.trim(),
            })
          }
          return error
        }),
      )
      return {
        id: result.id,
        tenantId: result.tenantId,
        reference: result.reference,
        status: "posted" as const,
        postedAt: result.postedAt!.toISOString(),
        lines: result.lines,
      }
    }),
  } satisfies AccountingService
})

export const makeAccountingTestLayer = () =>
  Layer.effect(
    AccountingService,
    Effect.gen(function* () {
      const authorization = yield* AuthorizationService
      const clock = yield* Clock.Clock
      const configurations = new Map<string, AccountingConfiguration>()
      const storedAccounts = new Map<string, Account>()
      const references = new Set<string>()
      let sequence = 1
      const nextId = () => `accounting-test-${sequence++}`
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
          return yield* Effect.fail(new AccountAlreadyExists({ tenantId: decoded.tenantId, code }))
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
        const key = `${decoded.tenantId}:${decoded.reference.trim()}`
        if (references.has(key)) {
          return yield* Effect.fail(
            new JournalReferenceAlreadyExists({
              tenantId: decoded.tenantId,
              reference: decoded.reference.trim(),
            }),
          )
        }
        references.add(key)
        return {
          id: nextId(),
          tenantId: decoded.tenantId,
          reference: decoded.reference.trim(),
          status: "posted" as const,
          postedAt: new Date(clock.currentTimeMillisUnsafe()).toISOString(),
          lines: decoded.lines,
        }
      }),
      }
      return service
    }),
  )
