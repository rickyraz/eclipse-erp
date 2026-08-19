import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { makePostgresqlFinancialLedger } from "../mod.ts"
import { Database, makePostgresDatabase, runMigrations } from "../../kernel/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"
import {
  assertFinancialLedgerConformance,
  LARGE_FINANCIAL_MAJOR,
  LARGE_FINANCIAL_MINOR,
} from "../../../tests/support/financial-ledger-conformance.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")

it.effect.skipIf(databaseUrl === undefined)(
  "keeps PostgreSQL ledger operations idempotent and tenant-scoped",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
          insert into auth.tenants (slug) values (${`pg-ledger-${crypto.randomUUID()}`}) returning id
        `
        )
        const [party] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
          insert into party.parties (tenant_id, kind, name)
          values (${tenant!.id}, 'organization', 'PostgreSQL Ledger Test') returning id
        `
        )
        const [legalEntity] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
          insert into party.legal_entities (tenant_id, organization_party_id)
          values (${tenant!.id}, ${party!.id}) returning id
        `
        )
        const [period] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
          insert into accounting.accounting_periods
            (tenant_id, legal_entity_id, starts_on, ends_on, status)
          values (${tenant!.id}, ${legalEntity!.id}, '1900-01-01', '2100-12-31', 'open')
          returning id
        `
        )
        const [cash] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
          insert into accounting.accounts (tenant_id, code, name, type)
          values (${tenant!.id}, '1000', 'Cash', 'asset') returning id
        `
        )
        const [revenue] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
          insert into accounting.accounts (tenant_id, code, name, type)
          values (${tenant!.id}, '4000', 'Revenue', 'revenue') returning id
        `
        )
        const [journal] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
          insert into accounting.journal_entries (tenant_id, reference, status, posted_at)
          values (${tenant!.id}, 'PG-LEDGER-1', 'draft', null) returning id
        `
        )
        yield* Effect.promise(() =>
          client`
          insert into accounting.journal_lines
            (tenant_id, entry_id, account_id, debit, credit)
          values
            (${tenant!.id}, ${journal!.id}, ${cash!.id}, ${LARGE_FINANCIAL_MAJOR}, '0'),
            (${tenant!.id}, ${journal!.id}, ${revenue!.id}, '0', ${LARGE_FINANCIAL_MAJOR})
        `
        )
        const operationId = `pg-operation-${crypto.randomUUID()}`
        const [operation] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
          insert into accounting.financial_operations (
            tenant_id, legal_entity_id, period_id, operation_id, operation_type, journal_id,
            reference, currency, mapping_version, engine, engine_verified, request_fingerprint,
            actor_principal_id, actor_session_id, status, attempts, scheduled_at
          ) values (
            ${tenant!.id}, ${legalEntity!.id}, ${period!.id}, ${operationId}, 'journal_post',
            ${journal!.id}, 'PG-LEDGER-1', 'USD', 1, 'postgresql', true, 'fingerprint-1',
            'test-principal', 'test-session', 'intent', 0, now()
          ) returning id
        `
        )
        yield* Effect.promise(() =>
          client`
          insert into accounting.financial_operation_transfers (
            tenant_id, operation_id, position, debit_account_id, credit_account_id, amount_minor
          ) values (${tenant!.id}, ${operation!.id}, 0, ${cash!.id}, ${
            revenue!.id
          }, ${LARGE_FINANCIAL_MINOR})
        `
        )

        const ledger = yield* makePostgresqlFinancialLedger.pipe(
          Effect.provideService(Database, database),
        )
        const input = {
          tenantId: tenant!.id,
          legalEntityId: legalEntity!.id,
          operationId,
          journalId: journal!.id,
          reference: "PG-LEDGER-1",
          currency: "USD",
          mappingVersion: 1,
          lines: [
            { accountId: cash!.id, debitMinor: LARGE_FINANCIAL_MINOR, creditMinor: "0" },
            { accountId: revenue!.id, debitMinor: "0", creditMinor: LARGE_FINANCIAL_MINOR },
          ],
        }

        yield* assertFinancialLedgerConformance(ledger, input, "postgresql")

        const u128ConstraintFailure = yield* Effect.tryPromise({
          try: async () => {
            await client`
              insert into accounting.financial_operation_transfers (
                tenant_id, operation_id, position, debit_account_id, credit_account_id, amount_minor
              ) values (
                ${tenant!.id}, ${operation!.id}, 1, ${cash!.id}, ${revenue!.id},
                '340282366920938463463374607431768211456'
              )
            `
          },
          catch: (cause) => cause,
        }).pipe(Effect.flip)
        assert.ok(u128ConstraintFailure)

        assert.strictEqual(
          (yield* ledger.createExecutionAccount({
            ...input,
            accountId: cash!.id,
            balanceConstraint: "credits_must_not_exceed_debits",
          }))._tag,
          "accepted",
        )
        assert.strictEqual(
          (yield* ledger.createExecutionAccount({
            ...input,
            accountId: revenue!.id,
            balanceConstraint: "debits_must_not_exceed_credits",
          }))._tag,
          "accepted",
        )

        const first = yield* ledger.postJournal(input)
        assert.strictEqual(first._tag, "accepted")
        if (first._tag !== "accepted") return
        assert.strictEqual(first.transferCount, 1)
        assert.deepStrictEqual(first.transferIds, [
          `postgresql:v1:${tenant!.id}:${legalEntity!.id}:${operationId}:0`,
        ])
        assert.deepStrictEqual(yield* ledger.postJournal(input), first)
        assert.deepStrictEqual(
          yield* ledger.postJournal({
            ...input,
            lines: [
              { accountId: cash!.id, debitMinor: "49999999999999999", creditMinor: "0" },
              { accountId: revenue!.id, debitMinor: "0", creditMinor: "49999999999999999" },
            ],
          }),
          {
            _tag: "manual_recovery",
            operationId,
            reason: "conflicting_replay",
          },
        )
        assert.strictEqual((yield* ledger.reconcileJournal(input))._tag, "accepted")
        assert.deepStrictEqual(
          yield* ledger.getBalance({
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            accountId: cash!.id,
            currency: "USD",
            mappingVersion: 1,
          }),
          {
            _tag: "available",
            accountId: cash!.id,
            mappingVersion: 1,
            debitsPendingMinor: "0",
            debitsPostedMinor: LARGE_FINANCIAL_MINOR,
            creditsPendingMinor: "0",
            creditsPostedMinor: "0",
          },
        )
        assert.deepStrictEqual(
          yield* ledger.getBalance({
            tenantId: crypto.randomUUID(),
            legalEntityId: legalEntity!.id,
            accountId: cash!.id,
            currency: "USD",
            mappingVersion: 1,
          }),
          { _tag: "not_found", accountId: cash!.id },
        )

        const [storedOperation] = yield* Effect.promise(() =>
          client<
            { status: string; engine: string; observed_engine: string | null; attempts: number }[]
          >`
          select status, engine, observed_engine, attempts
          from accounting.financial_operations
          where tenant_id = ${tenant!.id} and id = ${operation!.id}
        `
        )
        assert.deepStrictEqual(storedOperation, {
          status: "accepted",
          engine: "postgresql",
          observed_engine: "postgresql",
          attempts: 1,
        })
        const [storedJournal] = yield* Effect.promise(() =>
          client<{ status: string }[]>`
          select status from accounting.journal_entries where tenant_id = ${tenant!.id} and id = ${
            journal!.id
          }
        `
        )
        assert.deepStrictEqual(storedJournal, { status: "posted" })
      })),
)
