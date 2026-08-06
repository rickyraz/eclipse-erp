import "../../tooling/load-env.ts"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import postgres, { type Sql } from "postgres"

const Uuid = Schema.String.check(Schema.isPattern(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
))
const NonBlankString = Schema.String.check(Schema.isPattern(/\S/))

const WarehouseScope = Schema.Struct({
  tenantId: Uuid,
  warehouseId: Uuid,
  legalEntityId: Uuid,
  primaryBranchId: Schema.optionalKey(Schema.NullOr(Uuid)),
})

const StockTransferScope = Schema.Struct({
  tenantId: Uuid,
  transferId: Uuid,
  legalEntityId: Uuid,
})

const IdentifierScope = Schema.Struct({
  tenantId: Uuid,
  identifierId: Uuid,
  provider: NonBlankString,
  legalEntityId: Schema.optionalKey(Schema.NullOr(Uuid)),
})

export const P0BackfillInput = Schema.Struct({
  warehouseScopes: Schema.Array(WarehouseScope),
  stockTransferScopes: Schema.Array(StockTransferScope),
  identifierScopes: Schema.Array(IdentifierScope),
})

type P0Backfill = Schema.Schema.Type<typeof P0BackfillInput>

type Row = Readonly<Record<string, unknown>>

export class P0BackfillFailure extends Error {
  readonly _tag = "P0BackfillFailure"

  constructor(readonly detail: string) {
    super(detail)
  }
}

const key = (tenantId: string, id: string) => `${tenantId}:${id}`

const duplicateKeys = (values: readonly { tenantId: string; id: string }[]) => {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    const valueKey = key(value.tenantId, value.id)
    if (!seen.add(valueKey)) duplicates.add(valueKey)
  }
  return [...duplicates]
}

const assertExactCoverage = (
  resource: string,
  actualRows: readonly Row[],
  mappings: readonly { tenantId: string; id: string }[],
) => {
  const actual = new Set(actualRows.map((row) => key(String(row.tenant_id), String(row.id))))
  const provided = new Set(mappings.map((row) => key(row.tenantId, row.id)))
  const missing = [...actual].filter((value) => !provided.has(value))
  const unknown = [...provided].filter((value) => !actual.has(value))
  const duplicates = duplicateKeys(mappings)
  if (missing.length > 0 || unknown.length > 0 || duplicates.length > 0) {
    throw new P0BackfillFailure(
      `${resource} mapping must cover each row exactly once; missing=${missing.join(",")}; ` +
        `unknown=${unknown.join(",")}; duplicates=${duplicates.join(",")}`,
    )
  }
}

const normalize = (input: P0Backfill): P0Backfill => ({
  warehouseScopes: input.warehouseScopes.map((row) => ({
    ...row,
    primaryBranchId: row.primaryBranchId ?? null,
  })),
  stockTransferScopes: input.stockTransferScopes,
  identifierScopes: input.identifierScopes.map((row) => ({
    ...row,
    provider: row.provider.trim().toUpperCase(),
    legalEntityId: row.legalEntityId ?? null,
  })),
})

export const applyP0Backfill = (client: Sql, input: unknown) =>
  Effect.gen(function* () {
    const decoded = normalize(yield* Schema.decodeUnknownEffect(P0BackfillInput)(input))
    yield* Effect.tryPromise({
      try: () =>
        client.begin(async (tx) => {
          const warehouses = await tx.unsafe<Row[]>(
            `select tenant_id, id from inventory.warehouses order by tenant_id, id`,
          )
          const transfers = await tx.unsafe<Row[]>(
            `select tenant_id, id from inventory.stock_transfers order by tenant_id, id`,
          )
          const identifiers = await tx.unsafe<Row[]>(
            `select tenant_id, id from party.party_identifiers order by tenant_id, id`,
          )

          assertExactCoverage(
            "warehouse",
            warehouses,
            decoded.warehouseScopes.map((row) => ({
              tenantId: row.tenantId,
              id: row.warehouseId,
            })),
          )
          assertExactCoverage(
            "stock transfer",
            transfers,
            decoded.stockTransferScopes.map((row) => ({
              tenantId: row.tenantId,
              id: row.transferId,
            })),
          )
          assertExactCoverage(
            "identifier",
            identifiers,
            decoded.identifierScopes.map((row) => ({
              tenantId: row.tenantId,
              id: row.identifierId,
            })),
          )

          for (const row of decoded.warehouseScopes) {
            await tx.unsafe(
              `update inventory.warehouses
               set legal_entity_id = $1, primary_branch_id = $2, updated_at = now()
               where tenant_id = $3 and id = $4`,
              [row.legalEntityId, row.primaryBranchId ?? null, row.tenantId, row.warehouseId],
            )
          }

          for (const row of decoded.stockTransferScopes) {
            await tx.unsafe(
              `update inventory.stock_transfers
               set legal_entity_id = $1, updated_at = now()
               where tenant_id = $2 and id = $3`,
              [row.legalEntityId, row.tenantId, row.transferId],
            )
          }

          for (const row of decoded.identifierScopes) {
            await tx.unsafe(
              `update party.party_identifiers
               set provider = $1, legal_entity_id = $2, updated_at = now()
               where tenant_id = $3 and id = $4`,
              [row.provider, row.legalEntityId ?? null, row.tenantId, row.identifierId],
            )
          }
        }),
      catch: (cause) =>
        cause instanceof P0BackfillFailure
          ? cause
          : new P0BackfillFailure(cause instanceof Error ? cause.message : String(cause)),
    })
  })

const readInput = async (path: string) => JSON.parse(await Deno.readTextFile(path)) as unknown

if (import.meta.main) {
  const databaseUrl = Deno.env.get("DATABASE_URL")
  const inputPath = Deno.args[0] ?? Deno.env.get("P0_BACKFILL_FILE")
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    console.error("DATABASE_URL is required; .env.local is loaded automatically")
    Deno.exit(1)
  }
  if (inputPath === undefined || inputPath.trim() === "") {
    console.error("Usage: deno task migrate:p0-backfill -- <mapping.json>")
    Deno.exit(1)
  }

  const client = postgres(databaseUrl)
  const result = await Effect.runPromiseExit(
    Effect.tryPromise({ try: () => readInput(inputPath), catch: (cause) => cause }).pipe(
      Effect.flatMap((input) => applyP0Backfill(client, input)),
      Effect.ensuring(Effect.promise(() => client.end())),
    ),
  )
  if (result._tag === "Failure") {
    console.error(result.cause)
    Deno.exit(1)
  }
  console.log("P0 backfill completed")
}
