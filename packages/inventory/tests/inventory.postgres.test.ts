import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { Sql } from "postgres"

import { makeAuthService } from "../../auth/mod.ts"
import {
  AuthorizationService,
  type AuthorizationServiceShape,
  makeAuthorizationTestLayer,
} from "../../authorization/mod.ts"
import { makePartyService } from "../../party/mod.ts"
import {
  makeInventoryService,
  StockTransferDifferentLegalEntity,
  StockUnavailable,
  WarehouseBranchNotFound,
} from "../mod.ts"
import { type DatabaseService, makePostgresDatabase, runMigrations } from "../../kernel/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")
const principal = { identityId: "inventory-transfer-integration", sessionId: "session" }
const capabilities = [
  "party.create",
  "party.legal_entity.create",
  "party.branch.create",
  "inventory.warehouse.create",
  "inventory.item.create",
  "inventory.stock.receive",
  "inventory.stock.transfer.create",
  "inventory.stock.transfer.confirm",
  "inventory.stock.transfer.complete",
] as const

type BalanceRow = {
  readonly warehouse_id: string
  readonly item_id: string
  readonly on_hand: string
  readonly reserved: string
}

const readBalances = (client: Sql, tenantId: string) =>
  client<BalanceRow[]>`
    select warehouse_id, item_id, on_hand::text, reserved::text
    from inventory.stock_balances
    where tenant_id = ${tenantId}
    order by warehouse_id, item_id
  `

const createLegalEntityScope = (
  database: DatabaseService,
  authorization: AuthorizationServiceShape,
  tenantId: string,
  name: string,
) =>
  Effect.gen(function* () {
    const party = makePartyService(database, authorization)
    const organization = yield* party.create({
      principal,
      tenantId,
      kind: "organization",
      name: `${name} Organization`,
    })
    const legalEntity = yield* party.createLegalEntity({
      principal,
      tenantId,
      organizationPartyId: organization.id,
    })
    const branch = yield* party.createBranch({
      principal,
      tenantId,
      legalEntityId: legalEntity.id,
      name: `${name} Branch`,
      timezone: "Asia/Jakarta",
    })
    return { legalEntity, branch }
  })

it.effect.skipIf(databaseUrl === undefined)(
  "moves transfer lines only at confirmation and completion",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const auth = makeAuthService(database)
        const tenant = yield* auth.createTenant({ slug: `transfer-${crypto.randomUUID()}` })
        const authorizationLayer = makeAuthorizationTestLayer(
          capabilities.map((capability) => ({
            identityId: principal.identityId,
            tenantId: tenant.id,
            capability,
          })),
        )
        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService
          const scope = yield* createLegalEntityScope(
            database,
            authorization,
            tenant.id,
            "Transfer",
          )
          const inventory = makeInventoryService(database, authorization)
          const source = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: scope.legalEntity.id,
            primaryBranchId: scope.branch.id,
            name: "Source",
          })
          const destination = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: scope.legalEntity.id,
            name: "Destination",
          })
          const widget = yield* inventory.createItem({
            principal,
            tenantId: tenant.id,
            sku: "WIDGET",
            name: "Widget",
          })
          const cable = yield* inventory.createItem({
            principal,
            tenantId: tenant.id,
            sku: "CABLE",
            name: "Cable",
          })
          yield* inventory.receiveStock({
            principal,
            tenantId: tenant.id,
            warehouseId: source.id,
            itemId: widget.id,
            quantity: "10",
          })
          yield* inventory.receiveStock({
            principal,
            tenantId: tenant.id,
            warehouseId: source.id,
            itemId: cable.id,
            quantity: "8",
          })

          const transfer = yield* inventory.createTransfer({
            principal,
            tenantId: tenant.id,
            sourceWarehouseId: source.id,
            destinationWarehouseId: destination.id,
            lines: [
              { itemId: widget.id, quantity: "4" },
              { itemId: cable.id, quantity: "3" },
            ],
          })
          const beforeConfirm = yield* Effect.promise(() => readBalances(client, tenant.id))
          assert.deepStrictEqual(
            beforeConfirm.map(({ warehouse_id, item_id, on_hand }) => ({
              warehouse_id,
              item_id,
              on_hand,
            })),
            [
              { warehouse_id: source.id, item_id: cable.id, on_hand: "8" },
              { warehouse_id: source.id, item_id: widget.id, on_hand: "10" },
            ].toSorted((a, b) =>
              `${a.warehouse_id}:${a.item_id}`.localeCompare(`${b.warehouse_id}:${b.item_id}`)
            ),
          )

          yield* inventory.confirmTransfer({
            principal,
            tenantId: tenant.id,
            transferId: transfer.id,
          })
          yield* inventory.confirmTransfer({
            principal,
            tenantId: tenant.id,
            transferId: transfer.id,
          })
          const afterConfirm = yield* Effect.promise(() => readBalances(client, tenant.id))
          assert.deepStrictEqual(
            afterConfirm.map(({ warehouse_id, item_id, on_hand }) => ({
              warehouse_id,
              item_id,
              on_hand,
            })),
            [
              { warehouse_id: source.id, item_id: cable.id, on_hand: "5" },
              { warehouse_id: source.id, item_id: widget.id, on_hand: "6" },
            ].toSorted((a, b) =>
              `${a.warehouse_id}:${a.item_id}`.localeCompare(`${b.warehouse_id}:${b.item_id}`)
            ),
          )

          yield* inventory.completeTransfer({
            principal,
            tenantId: tenant.id,
            transferId: transfer.id,
          })
          yield* inventory.completeTransfer({
            principal,
            tenantId: tenant.id,
            transferId: transfer.id,
          })
          const afterComplete = yield* Effect.promise(() => readBalances(client, tenant.id))
          assert.deepStrictEqual(
            afterComplete.map(({ warehouse_id, item_id, on_hand }) => ({
              warehouse_id,
              item_id,
              on_hand,
            })).toSorted((a, b) =>
              `${a.warehouse_id}:${a.item_id}`.localeCompare(`${b.warehouse_id}:${b.item_id}`)
            ),
            [
              { warehouse_id: destination.id, item_id: cable.id, on_hand: "3" },
              { warehouse_id: destination.id, item_id: widget.id, on_hand: "4" },
              { warehouse_id: source.id, item_id: cable.id, on_hand: "5" },
              { warehouse_id: source.id, item_id: widget.id, on_hand: "6" },
            ].toSorted((a, b) =>
              `${a.warehouse_id}:${a.item_id}`.localeCompare(`${b.warehouse_id}:${b.item_id}`)
            ),
          )
        }).pipe(Effect.provide(authorizationLayer))
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "rolls back every source deduction when one transfer line is unavailable",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const auth = makeAuthService(database)
        const tenant = yield* auth.createTenant({ slug: `transfer-${crypto.randomUUID()}` })
        const authorizationLayer = makeAuthorizationTestLayer(
          capabilities.map((capability) => ({
            identityId: principal.identityId,
            tenantId: tenant.id,
            capability,
          })),
        )
        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService
          const scope = yield* createLegalEntityScope(
            database,
            authorization,
            tenant.id,
            "Rollback",
          )
          const inventory = makeInventoryService(database, authorization)
          const source = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: scope.legalEntity.id,
            primaryBranchId: scope.branch.id,
            name: "Source",
          })
          const destination = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: scope.legalEntity.id,
            name: "Destination",
          })
          const widget = yield* inventory.createItem({
            principal,
            tenantId: tenant.id,
            sku: "WIDGET",
            name: "Widget",
          })
          const cable = yield* inventory.createItem({
            principal,
            tenantId: tenant.id,
            sku: "CABLE",
            name: "Cable",
          })
          yield* inventory.receiveStock({
            principal,
            tenantId: tenant.id,
            warehouseId: source.id,
            itemId: widget.id,
            quantity: "10",
          })
          yield* inventory.receiveStock({
            principal,
            tenantId: tenant.id,
            warehouseId: source.id,
            itemId: cable.id,
            quantity: "1",
          })
          const transfer = yield* inventory.createTransfer({
            principal,
            tenantId: tenant.id,
            sourceWarehouseId: source.id,
            destinationWarehouseId: destination.id,
            lines: [
              { itemId: widget.id, quantity: "2" },
              { itemId: cable.id, quantity: "2" },
            ],
          })

          const error = yield* Effect.flip(inventory.confirmTransfer({
            principal,
            tenantId: tenant.id,
            transferId: transfer.id,
          }))
          assert.instanceOf(error, StockUnavailable)
          const balances = yield* Effect.promise(() => readBalances(client, tenant.id))
          assert.deepStrictEqual(
            balances.map(({ warehouse_id, item_id, on_hand }) => ({
              warehouse_id,
              item_id,
              on_hand,
            })).toSorted((a, b) =>
              `${a.warehouse_id}:${a.item_id}`.localeCompare(`${b.warehouse_id}:${b.item_id}`)
            ),
            [
              { warehouse_id: source.id, item_id: cable.id, on_hand: "1" },
              { warehouse_id: source.id, item_id: widget.id, on_hand: "10" },
            ].toSorted((a, b) =>
              `${a.warehouse_id}:${a.item_id}`.localeCompare(`${b.warehouse_id}:${b.item_id}`)
            ),
          )
        }).pipe(Effect.provide(authorizationLayer))
      })),
)

it.effect.skipIf(databaseUrl === undefined)(
  "enforces warehouse legal entity and branch scope",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const auth = makeAuthService(database)
        const tenant = yield* auth.createTenant({ slug: `warehouse-${crypto.randomUUID()}` })
        const authorizationLayer = makeAuthorizationTestLayer(
          capabilities.map((capability) => ({
            identityId: principal.identityId,
            tenantId: tenant.id,
            capability,
          })),
        )
        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService
          const sourceScope = yield* createLegalEntityScope(
            database,
            authorization,
            tenant.id,
            "Source",
          )
          const destinationScope = yield* createLegalEntityScope(
            database,
            authorization,
            tenant.id,
            "Destination",
          )
          const inventory = makeInventoryService(database, authorization)

          const invalidWarehouse = yield* Effect.flip(inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: sourceScope.legalEntity.id,
            primaryBranchId: destinationScope.branch.id,
            name: "Invalid Branch Scope",
          }))
          assert.instanceOf(invalidWarehouse, WarehouseBranchNotFound)

          const source = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: sourceScope.legalEntity.id,
            primaryBranchId: sourceScope.branch.id,
            name: "Source Warehouse",
          })
          const destination = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: destinationScope.legalEntity.id,
            primaryBranchId: destinationScope.branch.id,
            name: "Destination Warehouse",
          })
          const error = yield* Effect.flip(inventory.createTransfer({
            principal,
            tenantId: tenant.id,
            sourceWarehouseId: source.id,
            destinationWarehouseId: destination.id,
            lines: [{ itemId: "item-not-needed", quantity: "1" }],
          }))
          assert.instanceOf(error, StockTransferDifferentLegalEntity)
        }).pipe(Effect.provide(authorizationLayer))
      })),
)
