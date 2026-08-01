import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { runMigrations } from "../../kernel/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")

const postgresFailure = (effect: () => Promise<unknown>) =>
  Effect.tryPromise({ try: effect, catch: (cause) => cause }).pipe(Effect.flip)

it.effect.skipIf(databaseUrl === undefined)(
  "enforces balanced and immutable posted journals in PostgreSQL",
  () =>
    withTemporaryDatabase(
      databaseUrl!,
      (client) =>
        Effect.gen(function* () {
          yield* runMigrations(client)

          const [tenant] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
              insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
            `
          )
          const accounts = yield* Effect.promise(() =>
            client<{ id: string }[]>`
              insert into accounting.accounts (tenant_id, code, name, type)
              values
                (${tenant!.id}, 'CASH', 'Cash', 'asset'),
                (${tenant!.id}, 'REVENUE', 'Revenue', 'revenue')
              returning id
            `
          )

          const unbalanced = yield* postgresFailure(() =>
            client.begin(async (transaction) => {
              const [entry] = await transaction<{ id: string }[]>`
                insert into accounting.journal_entries (tenant_id, reference)
                values (${tenant!.id}, 'UNBALANCED') returning id
              `
              await transaction`
                insert into accounting.journal_lines
                  (tenant_id, entry_id, account_id, debit, credit)
                values (${tenant!.id}, ${entry!.id}, ${accounts[0]!.id}, 10, 0)
              `
              await transaction`
                update accounting.journal_entries
                set status = 'posted', posted_at = now()
                where id = ${entry!.id}
              `
            })
          )
          assert.strictEqual((unbalanced as { code?: string }).code, "23514")
          assert.strictEqual(
            (unbalanced as { constraint_name?: string }).constraint_name,
            "journal_entries_balanced_check",
          )

          const [posted] = yield* Effect.promise(() =>
            client.begin(async (transaction) => {
              const [entry] = await transaction<{ id: string }[]>`
                insert into accounting.journal_entries (tenant_id, reference)
                values (${tenant!.id}, 'POSTED') returning id
              `
              await transaction`
                insert into accounting.journal_lines
                  (tenant_id, entry_id, account_id, debit, credit)
                values
                  (${tenant!.id}, ${entry!.id}, ${accounts[0]!.id}, 10, 0),
                  (${tenant!.id}, ${entry!.id}, ${accounts[1]!.id}, 0, 10)
              `
              await transaction`
                update accounting.journal_entries
                set status = 'posted', posted_at = now()
                where id = ${entry!.id}
              `
              return [entry]
            })
          )
          const immutable = yield* postgresFailure(() =>
            client`
              update accounting.journal_lines
              set debit = 20
              where entry_id = ${posted!.id} and debit > 0
            `
          )
          assert.strictEqual((immutable as { code?: string }).code, "55000")
        }),
    ),
)
