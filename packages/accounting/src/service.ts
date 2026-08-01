import { eq } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { accounts, journalEntries, journalLines } from "../../../db/schema/accounting.ts"
import { Principal } from "../../auth/mod.ts"
import { AuthorizationDenied, type AuthorizationServiceShape } from "../../authorization/mod.ts"
import { DatabaseFailure, type DatabaseService, isDatabaseConstraint } from "../../kernel/mod.ts"

const Money = Schema.String.check(Schema.isPattern(/^\d{1,12}(\.\d{1,2})?$/))

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

export type Account = Schema.Schema.Type<typeof Account>
export type JournalLine = Schema.Schema.Type<typeof JournalLine>
export type JournalEntry = Schema.Schema.Type<typeof JournalEntry>

const ScopedInput = { principal: Principal, tenantId: Schema.String }

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

export const makeAccountingService = (
  database: DatabaseService,
  authorization: AuthorizationServiceShape,
): AccountingService => ({
  createAccount: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(CreateAccountInput)(input)
      yield* authorization.authorize({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        capability: "accounting.account.create",
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
        capability: "accounting.journal.post",
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

          const postedAt = new Date()
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
})

export const makeAccountingTestLayer = (authorization: AuthorizationServiceShape) => {
  const storedAccounts = new Map<string, Account>()
  const references = new Set<string>()
  const service: AccountingService = {
    createAccount: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateAccountInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: "accounting.account.create",
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
          id: crypto.randomUUID(),
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
          capability: "accounting.journal.post",
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
          id: crypto.randomUUID(),
          tenantId: decoded.tenantId,
          reference: decoded.reference.trim(),
          status: "posted" as const,
          postedAt: new Date().toISOString(),
          lines: decoded.lines,
        }
      }),
  }
  return Layer.succeed(AccountingService, service)
}
