import { and, asc, eq, inArray } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  accounts,
  financialOperations,
  financialOperationTransfers,
  journalEntries,
  journalLines,
} from "../../../db/schema/accounting.ts"
import {
  Database,
  DatabaseFailure,
  FINANCIAL_LEDGER_MAX_MINOR,
  requireExactMajorToMinor,
} from "../../kernel/mod.ts"
import {
  CreateExecutionAccountInput,
  FinancialExecutionOutcome,
  FinancialJournalLine,
  FinancialLedgerPort,
  GetFinancialBalanceInput,
  PostFinancialJournalInput,
} from "./financial-ledger.ts"

type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense"
type PostedBalance = { debitsMinor: bigint; creditsMinor: bigint }

type OperationRow = {
  readonly id: string
  readonly tenantId: string
  readonly legalEntityId: string
  readonly operationId: string
  readonly operationType: "journal_post" | "journal_reverse" | "revenue_post"
  readonly engine: "postgresql" | "tigerbeetle"
  readonly sourceJournalId: string | null
  readonly engineVerified: boolean
  readonly journalId: string
  readonly currency: string
  readonly mappingVersion: number
  readonly status:
    | "intent"
    | "submitted"
    | "accepted"
    | "rejected"
    | "unknown"
    | "manual_recovery"
    | "reconciled"
  readonly attempts: number
  readonly submittedAt: Date | null
  readonly engineAcceptedAt: string | null
  readonly rejectionReason: string | null
  readonly recoveryReason: string | null
}

const operationSelection = {
  id: financialOperations.id,
  tenantId: financialOperations.tenantId,
  legalEntityId: financialOperations.legalEntityId,
  operationId: financialOperations.operationId,
  operationType: financialOperations.operationType,
  engine: financialOperations.engine,
  sourceJournalId: financialOperations.sourceJournalId,
  engineVerified: financialOperations.engineVerified,
  journalId: financialOperations.journalId,
  currency: financialOperations.currency,
  mappingVersion: financialOperations.mappingVersion,
  status: financialOperations.status,
  attempts: financialOperations.attempts,
  submittedAt: financialOperations.submittedAt,
  engineAcceptedAt: financialOperations.engineAcceptedAt,
  rejectionReason: financialOperations.rejectionReason,
  recoveryReason: financialOperations.recoveryReason,
}

const operationKey = (input: PostFinancialJournalInput) =>
  `${input.tenantId}:${input.legalEntityId}:${input.operationId}`

const transferId = (input: PostFinancialJournalInput, position: number) =>
  `postgresql:v1:${operationKey(input)}:${position}`

const pairLines = (lines: readonly FinancialJournalLine[]) => {
  const debits = lines
    .filter((line) => BigInt(line.debitMinor) > 0n)
    .map((line) => ({ accountId: line.accountId, remaining: BigInt(line.debitMinor) }))
  const credits = lines
    .filter((line) => BigInt(line.creditMinor) > 0n)
    .map((line) => ({ accountId: line.accountId, remaining: BigInt(line.creditMinor) }))
  const pairs: Array<{
    readonly debitAccountId: string
    readonly creditAccountId: string
    readonly amount: bigint
  }> = []
  let debitIndex = 0
  let creditIndex = 0
  while (debitIndex < debits.length && creditIndex < credits.length) {
    const debit = debits[debitIndex]!
    const credit = credits[creditIndex]!
    const amount = debit.remaining < credit.remaining ? debit.remaining : credit.remaining
    pairs.push({ debitAccountId: debit.accountId, creditAccountId: credit.accountId, amount })
    debit.remaining -= amount
    credit.remaining -= amount
    if (debit.remaining === 0n) debitIndex += 1
    if (credit.remaining === 0n) creditIndex += 1
  }
  return pairs
}

const validateJournal = (
  input: PostFinancialJournalInput,
): FinancialExecutionOutcome | undefined => {
  if (input.lines.length < 2) {
    return { _tag: "rejected", operationId: input.operationId, reason: "unbalanced" }
  }
  let debit = 0n
  let credit = 0n
  for (const line of input.lines) {
    const lineDebit = BigInt(line.debitMinor)
    const lineCredit = BigInt(line.creditMinor)
    if (
      lineDebit > FINANCIAL_LEDGER_MAX_MINOR || lineCredit > FINANCIAL_LEDGER_MAX_MINOR ||
      (lineDebit > 0n) === (lineCredit > 0n)
    ) {
      return { _tag: "rejected", operationId: input.operationId, reason: "invalid_amount" }
    }
    debit += lineDebit
    credit += lineCredit
    if (debit > FINANCIAL_LEDGER_MAX_MINOR || credit > FINANCIAL_LEDGER_MAX_MINOR) {
      return { _tag: "rejected", operationId: input.operationId, reason: "invalid_amount" }
    }
  }
  return debit === credit
    ? undefined
    : { _tag: "rejected", operationId: input.operationId, reason: "unbalanced" }
}

const toMinor = (value: string | null) => requireExactMajorToMinor(String(value ?? "0"), 2)

const constraintFor = (type: AccountType) =>
  type === "asset" || type === "expense"
    ? "credits_must_not_exceed_debits" as const
    : "debits_must_not_exceed_credits" as const

const acceptedOutcome = (
  input: PostFinancialJournalInput,
  operation: OperationRow,
  ids = pairLines(input.lines).map((_, index) => transferId(input, index)),
): FinancialExecutionOutcome => ({
  _tag: "accepted",
  operationId: input.operationId,
  mappingVersion: input.mappingVersion,
  acceptedAt: operation.engineAcceptedAt ?? operation.submittedAt?.toISOString() ?? "postgresql",
  transferCount: ids.length,
  transferIds: ids,
})

const unknownOutcome = (
  operationId: string,
  reason: "unavailable" | "response_lost" | "not_found" = "unavailable",
) => ({ _tag: "unknown" as const, operationId, reason })

const operationMatches = (operation: OperationRow, input: PostFinancialJournalInput) =>
  operation.tenantId === input.tenantId &&
  operation.legalEntityId === input.legalEntityId &&
  operation.operationId === input.operationId &&
  operation.journalId === input.journalId &&
  operation.engine === "postgresql" &&
  operation.engineVerified &&
  operation.currency === input.currency &&
  operation.mappingVersion === input.mappingVersion

const transferRowsMatch = (
  rows: readonly {
    readonly position: number
    readonly debitAccountId: string
    readonly creditAccountId: string
    readonly amountMinor: string
    readonly engineTransferId: string | null
  }[],
  input: PostFinancialJournalInput,
) => {
  const pairs = pairLines(input.lines)
  return rows.length === pairs.length && rows.every((row, index) => {
    const pair = pairs[index]!
    const expectedId = transferId(input, index)
    return row.position === index &&
      row.debitAccountId === pair.debitAccountId &&
      row.creditAccountId === pair.creditAccountId &&
      String(row.amountMinor) === pair.amount.toString() &&
      (row.engineTransferId === null || row.engineTransferId === expectedId)
  })
}

const readOperation = (
  database: typeof Database.Service,
  input: PostFinancialJournalInput,
  lock: boolean,
) =>
  database.query(
    (db) => {
      const query = db.select(operationSelection).from(financialOperations).where(and(
        eq(financialOperations.tenantId, input.tenantId),
        eq(financialOperations.operationId, input.operationId),
      ))
      return lock ? query.for("update") : query
    },
    "accounting.postgresql_ledger.operation",
  )

const readTransfers = (
  database: typeof Database.Service,
  tenantId: string,
  operationId: string,
) =>
  database.query(
    (db) =>
      db.select({
        position: financialOperationTransfers.position,
        debitAccountId: financialOperationTransfers.debitAccountId,
        creditAccountId: financialOperationTransfers.creditAccountId,
        amountMinor: financialOperationTransfers.amountMinor,
        engineTransferId: financialOperationTransfers.engineTransferId,
        status: financialOperationTransfers.status,
      }).from(financialOperationTransfers).where(and(
        eq(financialOperationTransfers.tenantId, tenantId),
        eq(financialOperationTransfers.operationId, operationId),
      )).orderBy(asc(financialOperationTransfers.position)),
    "accounting.postgresql_ledger.transfers",
  )

const readJournalLines = (
  database: typeof Database.Service,
  tenantId: string,
  journalId: string,
) =>
  database.query(
    (db) =>
      db.select({
        accountId: journalLines.accountId,
        debit: journalLines.debit,
        credit: journalLines.credit,
      }).from(journalLines).where(and(
        eq(journalLines.tenantId, tenantId),
        eq(journalLines.entryId, journalId),
      )),
    "accounting.postgresql_ledger.journal_lines",
  )

const journalLinesMatch = (
  rows: readonly { readonly accountId: string; readonly debit: string; readonly credit: string }[],
  input: PostFinancialJournalInput,
) => {
  const expected = input.lines.map((line) => ({
    accountId: line.accountId,
    debit: BigInt(line.debitMinor),
    credit: BigInt(line.creditMinor),
  })).sort((left, right) =>
    `${left.accountId}:${left.debit}:${left.credit}`.localeCompare(
      `${right.accountId}:${right.debit}:${right.credit}`,
    )
  )
  const actual = rows.map((line) => ({
    accountId: line.accountId,
    debit: toMinor(line.debit),
    credit: toMinor(line.credit),
  })).sort((left, right) =>
    `${left.accountId}:${left.debit}:${left.credit}`.localeCompare(
      `${right.accountId}:${right.debit}:${right.credit}`,
    )
  )
  return actual.length === expected.length && actual.every((line, index) => {
    const expectedLine = expected[index]!
    return line.accountId === expectedLine.accountId &&
      line.debit === expectedLine.debit && line.credit === expectedLine.credit
  })
}

const readPostedLines = (
  database: typeof Database.Service,
  input: GetFinancialBalanceInput,
  accountIds: readonly string[],
) =>
  database.query(
    (db) =>
      db.select({
        accountId: journalLines.accountId,
        debit: journalLines.debit,
        credit: journalLines.credit,
      }).from(journalLines)
        .innerJoin(
          journalEntries,
          and(
            eq(journalEntries.tenantId, journalLines.tenantId),
            eq(journalEntries.id, journalLines.entryId),
          ),
        )
        .innerJoin(
          financialOperations,
          and(
            eq(financialOperations.tenantId, journalEntries.tenantId),
            eq(financialOperations.journalId, journalEntries.id),
          ),
        ).where(and(
          eq(journalLines.tenantId, input.tenantId),
          eq(financialOperations.legalEntityId, input.legalEntityId),
          eq(financialOperations.engine, "postgresql"),
          eq(financialOperations.engineVerified, true),
          eq(financialOperations.currency, input.currency),
          eq(financialOperations.mappingVersion, input.mappingVersion),
          inArray(financialOperations.status, ["accepted", "reconciled"]),
          inArray(journalEntries.status, ["posted", "reversed"]),
          inArray(journalLines.accountId, accountIds),
        )),
    "accounting.postgresql_ledger.posted_lines",
  )

const balancesFrom = (
  rows: readonly {
    readonly accountId: string
    readonly debit: string
    readonly credit: string
  }[],
) => {
  const balances = new Map<string, PostedBalance>()
  for (const row of rows) {
    const current = balances.get(row.accountId) ?? { debitsMinor: 0n, creditsMinor: 0n }
    balances.set(row.accountId, {
      debitsMinor: current.debitsMinor + toMinor(row.debit),
      creditsMinor: current.creditsMinor + toMinor(row.credit),
    })
  }
  return balances
}

const toRejected = (reason: string | null): FinancialExecutionOutcome => ({
  _tag: "rejected",
  operationId: "unknown",
  reason: reason === "invalid_account" || reason === "invalid_amount" ||
      reason === "unbalanced" || reason === "constraint_violation"
    ? reason
    : "constraint_violation",
})

export const makePostgresqlFinancialLedger = Effect.gen(function* () {
  const database = yield* Database

  const createExecutionAccount = (input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(CreateExecutionAccountInput)(input)
      const [account] = yield* database.query(
        (db) =>
          db.select({ id: accounts.id, type: accounts.type }).from(accounts).where(and(
            eq(accounts.tenantId, decoded.tenantId),
            eq(accounts.id, decoded.accountId),
          )),
        "accounting.postgresql_ledger.account",
      )
      if (account === undefined) {
        return {
          _tag: "rejected" as const,
          accountId: decoded.accountId,
          reason: "invalid_account" as const,
        }
      }
      const expectedConstraint = constraintFor(account.type)
      if (
        decoded.balanceConstraint !== undefined && decoded.balanceConstraint !== "none" &&
        decoded.balanceConstraint !== expectedConstraint
      ) {
        return {
          _tag: "manual_recovery" as const,
          accountId: decoded.accountId,
          reason: "mapping_mismatch" as const,
        }
      }
      return {
        _tag: "accepted" as const,
        accountId: decoded.accountId,
        mappingVersion: decoded.mappingVersion,
        acceptedAt: "postgresql",
      }
    }).pipe(
      Effect.catchIf(
        (error) => error instanceof DatabaseFailure,
        () =>
          Effect.succeed({
            _tag: "unknown" as const,
            accountId: "unknown",
            reason: "unavailable" as const,
          }),
      ),
    )

  const expectedTransferIds = (input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(PostFinancialJournalInput)(input)
      return pairLines(decoded.lines).map((_, index) => transferId(decoded, index))
    })

  const postJournal = (input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(PostFinancialJournalInput)(input)
      const validation = validateJournal(decoded)
      if (validation !== undefined) return validation
      const pairs = pairLines(decoded.lines)
      if (
        pairs.length === 0 || pairs.some((pair) => pair.debitAccountId === pair.creditAccountId)
      ) {
        return {
          _tag: "rejected" as const,
          operationId: decoded.operationId,
          reason: "constraint_violation" as const,
        }
      }
      return yield* database.withTransaction(
        Effect.gen(function* () {
          const [operation] = yield* readOperation(database, decoded, true)
          if (operation === undefined || !operationMatches(operation, decoded)) {
            return {
              _tag: "manual_recovery" as const,
              operationId: decoded.operationId,
              reason: "mapping_mismatch" as const,
            }
          }
          const persistedLines = yield* readJournalLines(
            database,
            decoded.tenantId,
            operation.journalId,
          )
          if (!journalLinesMatch(persistedLines, decoded)) {
            return {
              _tag: "manual_recovery" as const,
              operationId: decoded.operationId,
              reason: "conflicting_replay" as const,
            }
          }
          const transfers = yield* readTransfers(database, decoded.tenantId, operation.id)
          if (!transferRowsMatch(transfers, decoded)) {
            return {
              _tag: "manual_recovery" as const,
              operationId: decoded.operationId,
              reason: "mapping_mismatch" as const,
            }
          }
          if (operation.status === "accepted" || operation.status === "reconciled") {
            return acceptedOutcome(decoded, operation)
          }
          if (
            operation.status !== "intent" && operation.status !== "submitted" &&
            operation.status !== "unknown"
          ) {
            return operation.status === "rejected"
              ? { ...toRejected(operation.rejectionReason), operationId: decoded.operationId }
              : {
                _tag: "manual_recovery" as const,
                operationId: decoded.operationId,
                reason: operation.recoveryReason === "conflicting_replay"
                  ? "conflicting_replay" as const
                  : "reconciliation_required" as const,
              }
          }

          const accountIds = [...new Set(decoded.lines.map((line) => line.accountId))].sort()
          const accountRows = yield* database.query(
            (db) =>
              db.select({ id: accounts.id, type: accounts.type }).from(accounts).where(and(
                eq(accounts.tenantId, decoded.tenantId),
                inArray(accounts.id, accountIds),
              )).for("update"),
            "accounting.postgresql_ledger.accounts",
          )
          if (accountRows.length !== accountIds.length) {
            return {
              _tag: "rejected" as const,
              operationId: decoded.operationId,
              reason: "invalid_account" as const,
            }
          }
          const balanceInput = {
            tenantId: decoded.tenantId,
            legalEntityId: decoded.legalEntityId,
            accountId: accountIds[0]!,
            currency: decoded.currency,
            mappingVersion: decoded.mappingVersion,
          }
          const postedLines = yield* readPostedLines(database, balanceInput, accountIds)
          const balances = balancesFrom(postedLines)
          const deltas = new Map<string, PostedBalance>()
          for (const line of decoded.lines) {
            const current = deltas.get(line.accountId) ?? { debitsMinor: 0n, creditsMinor: 0n }
            deltas.set(line.accountId, {
              debitsMinor: current.debitsMinor + BigInt(line.debitMinor),
              creditsMinor: current.creditsMinor + BigInt(line.creditMinor),
            })
          }
          for (const account of accountRows) {
            const current = balances.get(account.id) ?? { debitsMinor: 0n, creditsMinor: 0n }
            const delta = deltas.get(account.id) ?? { debitsMinor: 0n, creditsMinor: 0n }
            const next = {
              debitsMinor: current.debitsMinor + delta.debitsMinor,
              creditsMinor: current.creditsMinor + delta.creditsMinor,
            }
            const violates = account.type === "asset" || account.type === "expense"
              ? next.creditsMinor > next.debitsMinor
              : next.debitsMinor > next.creditsMinor
            if (violates) {
              return {
                _tag: "rejected" as const,
                operationId: decoded.operationId,
                reason: "constraint_violation" as const,
              }
            }
          }

          const now = new Date()
          const acceptedAt = now.toISOString()
          if (operation.status === "intent" || operation.status === "unknown") {
            yield* database.query(
              (db) =>
                db.update(financialOperations).set({
                  status: "submitted",
                  attempts: operation.attempts + 1,
                  submittedAt: operation.submittedAt ?? now,
                  lastError: null,
                  updatedAt: now,
                }).where(and(
                  eq(financialOperations.tenantId, decoded.tenantId),
                  eq(financialOperations.id, operation.id),
                )),
              "accounting.postgresql_ledger.submit",
            )
          }
          yield* database.query(
            (db) =>
              db.update(financialOperations).set({
                status: "accepted",
                engineAcceptedAt: acceptedAt,
                rejectionReason: null,
                recoveryReason: null,
                observedEngine: "postgresql",
                lastError: null,
                updatedAt: now,
              }).where(and(
                eq(financialOperations.tenantId, decoded.tenantId),
                eq(financialOperations.id, operation.id),
              )),
            "accounting.postgresql_ledger.accept",
          )
          yield* database.query(
            (db) =>
              db.update(journalEntries).set({
                status: operation.operationType === "journal_reverse" ? "reversed" : "posted",
                reversesEntryId: operation.operationType === "journal_reverse"
                  ? operation.sourceJournalId
                  : null,
                postedAt: now,
                updatedAt: now,
              }).where(and(
                eq(journalEntries.tenantId, decoded.tenantId),
                eq(journalEntries.id, operation.journalId),
              )),
            "accounting.postgresql_ledger.journal",
          )
          for (
            const [position, id] of pairLines(decoded.lines).map((_, index) =>
              transferId(decoded, index)
            ).entries()
          ) {
            yield* database.query(
              (db) =>
                db.update(financialOperationTransfers).set({
                  engineTransferId: id,
                  status: "accepted",
                  observedTimestamp: acceptedAt,
                  updatedAt: now,
                }).where(and(
                  eq(financialOperationTransfers.tenantId, decoded.tenantId),
                  eq(financialOperationTransfers.operationId, operation.id),
                  eq(financialOperationTransfers.position, position),
                )),
              "accounting.postgresql_ledger.transfer",
            )
          }
          return acceptedOutcome(decoded, {
            ...operation,
            status: "accepted",
            engineAcceptedAt: acceptedAt,
            submittedAt: operation.submittedAt ?? now,
          })
        }),
        "accounting.postgresql_ledger.post",
      )
    }).pipe(
      Effect.catchIf(
        (error) => error instanceof DatabaseFailure,
        () => Effect.succeed(unknownOutcome("unknown", "response_lost")),
      ),
    )

  const reconcileJournal = (input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(PostFinancialJournalInput)(input)
      const validation = validateJournal(decoded)
      if (validation !== undefined) return validation
      const pairs = pairLines(decoded.lines)
      if (
        pairs.length === 0 || pairs.some((pair) => pair.debitAccountId === pair.creditAccountId)
      ) {
        return {
          _tag: "rejected" as const,
          operationId: decoded.operationId,
          reason: "constraint_violation" as const,
        }
      }
      const [operation] = yield* readOperation(database, decoded, false)
      if (operation === undefined) return unknownOutcome(decoded.operationId, "not_found")
      if (!operationMatches(operation, decoded)) {
        return {
          _tag: "manual_recovery" as const,
          operationId: decoded.operationId,
          reason: "mapping_mismatch" as const,
        }
      }
      if (operation.status === "rejected") {
        return {
          ...toRejected(operation.rejectionReason),
          operationId: decoded.operationId,
        }
      }
      if (operation.status === "manual_recovery") {
        return {
          _tag: "manual_recovery" as const,
          operationId: decoded.operationId,
          reason: operation.recoveryReason === "conflicting_replay"
            ? "conflicting_replay" as const
            : "reconciliation_required" as const,
        }
      }
      if (operation.status !== "accepted" && operation.status !== "reconciled") {
        return unknownOutcome(decoded.operationId, "not_found")
      }
      const persistedLines = yield* readJournalLines(
        database,
        decoded.tenantId,
        operation.journalId,
      )
      if (!journalLinesMatch(persistedLines, decoded)) {
        return {
          _tag: "manual_recovery" as const,
          operationId: decoded.operationId,
          reason: "conflicting_replay" as const,
        }
      }
      const transfers = yield* readTransfers(database, decoded.tenantId, operation.id)
      if (
        !transferRowsMatch(transfers, decoded) || transfers.some((row) => row.status !== "accepted")
      ) {
        return {
          _tag: "manual_recovery" as const,
          operationId: decoded.operationId,
          reason: "mapping_mismatch" as const,
        }
      }
      const [journal] = yield* database.query(
        (db) =>
          db.select({ status: journalEntries.status }).from(journalEntries).where(and(
            eq(journalEntries.tenantId, decoded.tenantId),
            eq(journalEntries.id, operation.journalId),
          )),
        "accounting.postgresql_ledger.reconcile_journal",
      )
      const expectedStatus = operation.operationType === "journal_reverse" ? "reversed" : "posted"
      if (journal?.status !== expectedStatus) {
        return {
          _tag: "manual_recovery" as const,
          operationId: decoded.operationId,
          reason: "mapping_mismatch" as const,
        }
      }
      return acceptedOutcome(decoded, operation)
    }).pipe(
      Effect.catchIf(
        (error) => error instanceof DatabaseFailure,
        () => Effect.succeed(unknownOutcome("unknown", "unavailable")),
      ),
    )

  const getBalance = (input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(GetFinancialBalanceInput)(input)
      const [account] = yield* database.query(
        (db) =>
          db.select({ id: accounts.id }).from(accounts).where(and(
            eq(accounts.tenantId, decoded.tenantId),
            eq(accounts.id, decoded.accountId),
          )),
        "accounting.postgresql_ledger.balance.account",
      )
      if (account === undefined) return { _tag: "not_found" as const, accountId: decoded.accountId }
      const rows = yield* readPostedLines(database, decoded, [decoded.accountId])
      const balance = balancesFrom(rows).get(decoded.accountId) ?? {
        debitsMinor: 0n,
        creditsMinor: 0n,
      }
      return {
        _tag: "available" as const,
        accountId: decoded.accountId,
        mappingVersion: decoded.mappingVersion,
        debitsPendingMinor: "0",
        debitsPostedMinor: balance.debitsMinor.toString(),
        creditsPendingMinor: "0",
        creditsPostedMinor: balance.creditsMinor.toString(),
      }
    }).pipe(
      Effect.catchIf(
        (error) => error instanceof DatabaseFailure,
        () =>
          Effect.succeed({
            _tag: "unknown" as const,
            accountId: "unknown",
            reason: "unavailable" as const,
          }),
      ),
    )

  return {
    authority: "postgresql" as const,
    createExecutionAccount,
    postJournal,
    reconcileJournal,
    expectedTransferIds,
    getBalance,
  } satisfies FinancialLedgerPort
})

export const makePostgresqlFinancialLedgerLayer = Layer.effect(
  FinancialLedgerPort,
  makePostgresqlFinancialLedger,
)
