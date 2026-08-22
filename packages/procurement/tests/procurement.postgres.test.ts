import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { makeAuthService } from "../../auth/mod.ts"
import { AuthorizationService, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import { makeUserAccountService, UserAccountService } from "../../identity/mod.ts"
import {
  Database,
  DatabaseFailure,
  makePostgresDatabase,
  runMigrations,
  WebCryptoLive,
} from "../../kernel/mod.ts"
import { makePartyService, PartyCapabilities, PartyService } from "../../party/mod.ts"
import {
  makeProcurementService,
  ProcurementCapabilities,
  SupplierAccountAlreadyExists,
  SupplierAccountNotFound,
  SupplierRelationshipNotEligible,
} from "../mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")
const principal = { userAccountId: "procurement-postgres", sessionId: "session" }
const postgresFailure = (effect: () => Promise<unknown>) =>
  Effect.tryPromise({ try: effect, catch: (cause) => cause }).pipe(Effect.flip)
const capabilities = [
  PartyCapabilities.partyCreate,
  PartyCapabilities.legalEntityCreate,
  PartyCapabilities.partyRoleAssign,
  PartyCapabilities.partyRelationshipCreate,
  PartyCapabilities.partyRelationshipRead,
  ProcurementCapabilities.supplierAccountCreate,
  ProcurementCapabilities.purchaseOrderCreate,
] as const

it.effect.skipIf(databaseUrl === undefined)(
  "enforces supplier relationship scope and uniqueness in PostgreSQL",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const userAccountService = yield* makeUserAccountService.pipe(
          Effect.provideService(Database, database),
        )
        const auth = yield* makeAuthService.pipe(
          Effect.provideService(Database, database),
          Effect.provide(WebCryptoLive),
          Effect.provideService(UserAccountService, userAccountService),
        )
        const tenant = yield* auth.createTenant({ slug: `procurement-${crypto.randomUUID()}` })
        const otherTenant = yield* auth.createTenant({
          slug: `procurement-other-${crypto.randomUUID()}`,
        })
        const authorizationLayer = makeAuthorizationTestLayer(
          [tenant.id, otherTenant.id].flatMap((tenantId) =>
            capabilities.map((capability) => ({
              userAccountId: principal.userAccountId,
              tenantId,
              capability,
            }))
          ),
        )

        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService
          const party = yield* makePartyService.pipe(
            Effect.provideService(Database, database),
            Effect.provideService(AuthorizationService, authorization),
          )
          const procurement = yield* Effect.provide(
            makeProcurementService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              Layer.succeed(AuthorizationService, authorization),
              Layer.succeed(PartyService, party),
            ),
          )

          const createSupplierRelationship = (scopeTenantId: string) =>
            Effect.gen(function* () {
              const owner = yield* party.create({
                principal,
                tenantId: scopeTenantId,
                kind: "organization",
                name: "Buying Legal Entity",
              })
              const legalEntity = yield* party.createLegalEntity({
                principal,
                tenantId: scopeTenantId,
                organizationId: owner.id,
              })
              const supplier = yield* party.create({
                principal,
                tenantId: scopeTenantId,
                kind: "organization",
                name: "Supplier",
              })
              yield* party.assignRole({
                principal,
                tenantId: scopeTenantId,
                partyId: supplier.id,
                role: "supplier",
              })
              return yield* party.createRelationship({
                principal,
                tenantId: scopeTenantId,
                partyId: supplier.id,
                legalEntityId: legalEntity.id,
                kind: "supplier",
              })
            })

          const relationship = yield* createSupplierRelationship(tenant.id)
          const otherRelationship = yield* createSupplierRelationship(otherTenant.id)
          const input = {
            principal,
            tenantId: tenant.id,
            supplierRelationshipId: relationship.id,
          }
          const account = yield* procurement.createSupplierAccount(input)
          assert.strictEqual(account.partyId, relationship.partyId)
          assert.strictEqual(account.legalEntityId, relationship.legalEntityId)
          assert.instanceOf(
            yield* Effect.flip(procurement.createSupplierAccount(input)),
            SupplierAccountAlreadyExists,
          )
          assert.instanceOf(
            yield* Effect.flip(procurement.createSupplierAccount({
              principal,
              tenantId: tenant.id,
              supplierRelationshipId: otherRelationship.id,
            })),
            SupplierRelationshipNotEligible,
          )

          const invalidScope = yield* postgresFailure(() =>
            client`
              insert into procurement.supplier_accounts (tenant_id, supplier_relationship_id)
              values (${tenant.id}, ${otherRelationship.id})
            `
          )
          assert.strictEqual((invalidScope as { code?: string }).code, "23503")
          assert.strictEqual(
            (invalidScope as { constraint_name?: string }).constraint_name,
            "supplier_accounts_tenant_supplier_relationship_fkey",
          )

          const otherAccount = yield* procurement.createSupplierAccount({
            principal,
            tenantId: otherTenant.id,
            supplierRelationshipId: otherRelationship.id,
          })
          const lines = [
            { itemId: crypto.randomUUID(), quantity: "3", unitPrice: "12.34" },
            { itemId: crypto.randomUUID(), quantity: "2", unitPrice: "0.01" },
          ]
          const order = yield* procurement.createPurchaseOrder({
            principal,
            tenantId: tenant.id,
            supplierAccountId: account.id,
            lines,
          })
          assert.strictEqual(order.total, "37.04")
          const persisted = yield* Effect.promise(() =>
            client<{
              id: string
              status: string
              total: string
              item_id: string
              quantity: string
              unit_price: string
            }[]>`
              select po.id, po.status, po.total, pol.item_id, pol.quantity, pol.unit_price
              from procurement.purchase_orders po
              join procurement.purchase_order_lines pol
                on pol.tenant_id = po.tenant_id and pol.purchase_order_id = po.id
              where po.tenant_id = ${tenant.id} and po.id = ${order.id}
              order by pol.item_id
            `
          )
          assert.strictEqual(persisted.length, 2)
          assert.isTrue(persisted.every((row) => row.status === "draft" && row.total === "37.04"))
          assert.deepStrictEqual(
            persisted.map(({ item_id, quantity, unit_price }) => ({
              itemId: item_id,
              quantity,
              unitPrice: unit_price,
            })),
            [...lines].sort((left, right) => left.itemId.localeCompare(right.itemId)),
          )

          assert.instanceOf(
            yield* Effect.flip(procurement.createPurchaseOrder({
              principal,
              tenantId: tenant.id,
              supplierAccountId: otherAccount.id,
              lines: [{ itemId: crypto.randomUUID(), quantity: "1", unitPrice: "1.00" }],
            })),
            SupplierAccountNotFound,
          )

          for (
            const [quantity, unitPrice, constraint] of [
              ["0", "1.00", "purchase_order_lines_quantity_check"],
              ["1", "-1.00", "purchase_order_lines_unit_price_check"],
            ] as const
          ) {
            const failure = yield* postgresFailure(() =>
              client`
                insert into procurement.purchase_order_lines
                  (tenant_id, purchase_order_id, item_id, quantity, unit_price)
                values (${tenant.id}, ${order.id}, ${crypto.randomUUID()}, ${quantity}, ${unitPrice})
              `
            )
            assert.strictEqual((failure as { code?: string }).code, "23514")
            assert.strictEqual(
              (failure as { constraint_name?: string }).constraint_name,
              constraint,
            )
          }

          const beforeRollback = yield* Effect.promise(() =>
            client<{ count: number }[]>`
              select count(*)::integer as count
              from procurement.purchase_orders
              where tenant_id = ${tenant.id} and supplier_account_id = ${account.id}
            `
          )
          yield* Effect.promise(() =>
            client`
              create function procurement.reject_test_purchase_order_line()
              returns trigger language plpgsql as $$
              begin
                raise exception 'injected purchase order line failure';
              end
              $$
            `
          )
          yield* Effect.promise(() =>
            client`
              create trigger reject_test_purchase_order_line
              before insert on procurement.purchase_order_lines
              for each row execute function procurement.reject_test_purchase_order_line()
            `
          )
          assert.instanceOf(
            yield* Effect.flip(procurement.createPurchaseOrder({
              principal,
              tenantId: tenant.id,
              supplierAccountId: account.id,
              lines: [{
                itemId: crypto.randomUUID(),
                quantity: "1",
                unitPrice: "1.00",
              }],
            })),
            DatabaseFailure,
          )
          const afterRollback = yield* Effect.promise(() =>
            client<{ count: number }[]>`
              select count(*)::integer as count
              from procurement.purchase_orders
              where tenant_id = ${tenant.id} and supplier_account_id = ${account.id}
            `
          )
          assert.strictEqual(afterRollback[0]?.count, beforeRollback[0]?.count)
        }).pipe(Effect.provide(authorizationLayer))
      })),
)
