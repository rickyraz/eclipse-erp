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
  PurchaseOrderConfirmationIdempotencyConflict,
  PurchaseOrderInvalidState,
  PurchaseOrderNotFound,
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
  ProcurementCapabilities.purchaseOrderConfirm,
  ProcurementCapabilities.purchaseOrderRead,
  ProcurementCapabilities.purchaseOrderCancel,
] as const

it.effect.skipIf(databaseUrl === undefined)(
  "enforces Procurement supplier and purchase order invariants in PostgreSQL",
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
              line_id: string
              item_id: string
              quantity: string
              unit_price: string
            }[]>`
              select po.id, po.status, po.total, pol.id as line_id,
                pol.item_id, pol.quantity, pol.unit_price
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
            persisted.map(({ line_id, item_id, quantity, unit_price }) => ({
              id: line_id,
              itemId: item_id,
              quantity,
              unitPrice: unit_price,
            })),
            [...order.lines].sort((left, right) => left.itemId.localeCompare(right.itemId)),
          )
          assert.strictEqual(
            (yield* procurement.getPurchaseOrder({
              principal,
              tenantId: tenant.id,
              purchaseOrderId: order.id,
            })).status,
            "draft",
          )
          for (const operation of ["get", "confirm", "cancel"] as const) {
            const failure = yield* Effect.flip(
              operation === "get"
                ? procurement.getPurchaseOrder({
                  principal,
                  tenantId: otherTenant.id,
                  purchaseOrderId: order.id,
                })
                : operation === "confirm"
                ? procurement.confirmPurchaseOrder({
                  principal,
                  tenantId: otherTenant.id,
                  purchaseOrderId: order.id,
                  idempotencyKey: "cross-tenant-confirmation",
                })
                : procurement.cancelPurchaseOrder({
                  principal,
                  tenantId: otherTenant.id,
                  purchaseOrderId: order.id,
                }),
            )
            assert.instanceOf(failure, PurchaseOrderNotFound)
          }

          const confirmationInput = {
            principal,
            tenantId: tenant.id,
            purchaseOrderId: order.id,
            idempotencyKey: "purchase-order-confirmation",
          }
          const confirmed = yield* procurement.confirmPurchaseOrder(confirmationInput)
          const replayed = yield* procurement.confirmPurchaseOrder(confirmationInput)
          assert.strictEqual(confirmed.status, "confirmed")
          assert.isNotNull(confirmed.confirmedAt)
          assert.deepStrictEqual(replayed, confirmed)
          assert.deepStrictEqual(
            yield* procurement.getPurchaseOrder({
              principal,
              tenantId: tenant.id,
              purchaseOrderId: order.id,
            }),
            confirmed,
          )
          const confirmationRows = yield* Effect.promise(() =>
            client<{
              status: string
              confirmation_idempotency_key: string | null
              confirmed_at: Date | null
            }[]>`
              select status, confirmation_idempotency_key, confirmed_at
              from procurement.purchase_orders
              where tenant_id = ${tenant.id} and id = ${order.id}
            `
          )
          assert.strictEqual(confirmationRows[0]?.status, "confirmed")
          assert.strictEqual(
            confirmationRows[0]?.confirmation_idempotency_key,
            confirmationInput.idempotencyKey,
          )
          assert.isNotNull(confirmationRows[0]?.confirmed_at)

          const conflictingOrder = yield* procurement.createPurchaseOrder({
            principal,
            tenantId: tenant.id,
            supplierAccountId: account.id,
            lines: [{ itemId: crypto.randomUUID(), quantity: "1", unitPrice: "2.00" }],
          })
          assert.instanceOf(
            yield* Effect.flip(procurement.confirmPurchaseOrder({
              ...confirmationInput,
              purchaseOrderId: conflictingOrder.id,
            })),
            PurchaseOrderConfirmationIdempotencyConflict,
          )

          const concurrentOrder = yield* procurement.createPurchaseOrder({
            principal,
            tenantId: tenant.id,
            supplierAccountId: account.id,
            lines: [{ itemId: crypto.randomUUID(), quantity: "1", unitPrice: "3.00" }],
          })
          const concurrentInput = {
            principal,
            tenantId: tenant.id,
            purchaseOrderId: concurrentOrder.id,
            idempotencyKey: "concurrent-purchase-order-confirmation",
          }
          const concurrentResults = yield* Effect.all([
            procurement.confirmPurchaseOrder(concurrentInput),
            procurement.confirmPurchaseOrder(concurrentInput),
          ], { concurrency: "unbounded" })
          assert.strictEqual(concurrentResults[0].id, concurrentResults[1].id)
          assert.strictEqual(concurrentResults[0].confirmedAt, concurrentResults[1].confirmedAt)
          const concurrentCancellations = yield* Effect.all([
            procurement.cancelPurchaseOrder({
              principal,
              tenantId: tenant.id,
              purchaseOrderId: concurrentOrder.id,
            }),
            procurement.cancelPurchaseOrder({
              principal,
              tenantId: tenant.id,
              purchaseOrderId: concurrentOrder.id,
            }),
          ], { concurrency: "unbounded" })
          assert.strictEqual(concurrentCancellations[0].status, "cancelled")
          assert.deepStrictEqual(concurrentCancellations[0], concurrentCancellations[1])
          assert.instanceOf(
            yield* Effect.flip(procurement.confirmPurchaseOrder(concurrentInput)),
            PurchaseOrderInvalidState,
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

          const metadataOrder = yield* procurement.createPurchaseOrder({
            principal,
            tenantId: tenant.id,
            supplierAccountId: account.id,
            lines: [{ itemId: crypto.randomUUID(), quantity: "1", unitPrice: "4.00" }],
          })
          for (
            const mutation of [
              () =>
                client`
                  update procurement.purchase_orders
                  set confirmation_idempotency_key = 'orphaned-confirmation'
                  where tenant_id = ${tenant.id} and id = ${metadataOrder.id}
                `,
              () =>
                client`
                  update procurement.purchase_orders
                  set status = 'confirmed'
                  where tenant_id = ${tenant.id} and id = ${metadataOrder.id}
                `,
            ]
          ) {
            const failure = yield* postgresFailure(mutation)
            assert.strictEqual((failure as { code?: string }).code, "23514")
            assert.strictEqual(
              (failure as { constraint_name?: string }).constraint_name,
              "purchase_orders_confirmation_metadata_check",
            )
          }

          const invalidDraftCancellation = yield* postgresFailure(() =>
            client`
              update procurement.purchase_orders
              set status = 'cancelled',
                confirmation_idempotency_key = 'invalid-draft-cancellation',
                confirmed_at = now()
              where tenant_id = ${tenant.id} and id = ${metadataOrder.id}
            `
          )
          assert.strictEqual((invalidDraftCancellation as { code?: string }).code, "23514")
          assert.strictEqual(
            (invalidDraftCancellation as { constraint_name?: string }).constraint_name,
            "purchase_order_state_transition_check",
          )
          yield* procurement.confirmPurchaseOrder({
            principal,
            tenantId: tenant.id,
            purchaseOrderId: metadataOrder.id,
            idempotencyKey: "metadata-order-confirmation",
          })
          const tamperedCancellation = yield* postgresFailure(() =>
            client`
              update procurement.purchase_orders
              set status = 'cancelled', total = 5.00
              where tenant_id = ${tenant.id} and id = ${metadataOrder.id}
            `
          )
          assert.strictEqual((tamperedCancellation as { code?: string }).code, "23514")
          assert.strictEqual(
            (tamperedCancellation as { constraint_name?: string }).constraint_name,
            "purchase_order_confirmed_immutable",
          )

          for (const status of ["confirmed", "cancelled"] as const) {
            const nonDraftInsert = yield* postgresFailure(() =>
              client`
                insert into procurement.purchase_orders
                  (tenant_id, supplier_account_id, status, confirmation_idempotency_key,
                    confirmed_at, total)
                values (
                  ${tenant.id}, ${account.id}, ${status}, ${`direct-${status}`}, now(), 0
                )
              `
            )
            assert.strictEqual((nonDraftInsert as { code?: string }).code, "23514")
            assert.strictEqual(
              (nonDraftInsert as { constraint_name?: string }).constraint_name,
              "purchase_order_state_transition_check",
            )
          }

          const invalidTransition = yield* postgresFailure(() =>
            client`
              update procurement.purchase_orders
              set status = 'draft', confirmation_idempotency_key = null, confirmed_at = null
              where tenant_id = ${tenant.id} and id = ${order.id}
            `
          )
          assert.strictEqual((invalidTransition as { code?: string }).code, "23514")
          assert.strictEqual(
            (invalidTransition as { constraint_name?: string }).constraint_name,
            "purchase_order_state_transition_check",
          )

          const immutableHeader = yield* postgresFailure(() =>
            client`
              update procurement.purchase_orders set total = 38.04
              where tenant_id = ${tenant.id} and id = ${order.id}
            `
          )
          assert.strictEqual((immutableHeader as { code?: string }).code, "23514")
          assert.strictEqual(
            (immutableHeader as { constraint_name?: string }).constraint_name,
            "purchase_order_confirmed_immutable",
          )

          for (
            const mutation of [
              () =>
                client`
                  update procurement.purchase_order_lines set unit_price = 20.00
                  where tenant_id = ${tenant.id} and purchase_order_id = ${order.id}
                `,
              () =>
                client`
                  insert into procurement.purchase_order_lines
                    (tenant_id, purchase_order_id, item_id, quantity, unit_price)
                  values (${tenant.id}, ${order.id}, ${crypto.randomUUID()}, 1, 1.00)
                `,
              () =>
                client`
                  delete from procurement.purchase_order_lines
                  where tenant_id = ${tenant.id} and purchase_order_id = ${order.id}
                `,
            ]
          ) {
            const failure = yield* postgresFailure(mutation)
            assert.strictEqual((failure as { code?: string }).code, "23514")
            assert.strictEqual(
              (failure as { constraint_name?: string }).constraint_name,
              "purchase_order_confirmed_lines_immutable",
            )
          }

          const cancelled = yield* procurement.cancelPurchaseOrder({
            principal,
            tenantId: tenant.id,
            purchaseOrderId: order.id,
          })
          const replayedCancellation = yield* procurement.cancelPurchaseOrder({
            principal,
            tenantId: tenant.id,
            purchaseOrderId: order.id,
          })
          assert.strictEqual(cancelled.status, "cancelled")
          assert.strictEqual(cancelled.confirmedAt, confirmed.confirmedAt)
          assert.deepStrictEqual(replayedCancellation, cancelled)
          assert.deepStrictEqual(
            yield* procurement.getPurchaseOrder({
              principal,
              tenantId: tenant.id,
              purchaseOrderId: order.id,
            }),
            cancelled,
          )
          assert.instanceOf(
            yield* Effect.flip(procurement.confirmPurchaseOrder(confirmationInput)),
            PurchaseOrderInvalidState,
          )
          const cancellationRows = yield* Effect.promise(() =>
            client<{
              status: string
              confirmation_idempotency_key: string | null
              confirmed_at: Date | null
            }[]>`
              select status, confirmation_idempotency_key, confirmed_at
              from procurement.purchase_orders
              where tenant_id = ${tenant.id} and id = ${order.id}
            `
          )
          assert.strictEqual(cancellationRows[0]?.status, "cancelled")
          assert.strictEqual(
            cancellationRows[0]?.confirmation_idempotency_key,
            confirmationInput.idempotencyKey,
          )
          assert.strictEqual(
            cancellationRows[0]?.confirmed_at,
            confirmationRows[0]?.confirmed_at,
          )

          for (const status of ["draft", "confirmed"] as const) {
            const invalidCancelledTransition = yield* postgresFailure(() =>
              client`
                update procurement.purchase_orders set status = ${status}
                where tenant_id = ${tenant.id} and id = ${order.id}
              `
            )
            assert.strictEqual((invalidCancelledTransition as { code?: string }).code, "23514")
            assert.strictEqual(
              (invalidCancelledTransition as { constraint_name?: string }).constraint_name,
              "purchase_order_state_transition_check",
            )
          }

          for (
            const mutation of [
              () =>
                client`
                  update procurement.purchase_orders set total = 38.04
                  where tenant_id = ${tenant.id} and id = ${order.id}
                `,
              () =>
                client`
                  delete from procurement.purchase_orders
                  where tenant_id = ${tenant.id} and id = ${order.id}
                `,
            ]
          ) {
            const failure = yield* postgresFailure(mutation)
            assert.strictEqual((failure as { code?: string }).code, "23514")
            assert.strictEqual(
              (failure as { constraint_name?: string }).constraint_name,
              "purchase_order_confirmed_immutable",
            )
          }

          for (
            const mutation of [
              () =>
                client`
                  update procurement.purchase_order_lines set unit_price = 20.00
                  where tenant_id = ${tenant.id} and purchase_order_id = ${order.id}
                `,
              () =>
                client`
                  insert into procurement.purchase_order_lines
                    (tenant_id, purchase_order_id, item_id, quantity, unit_price)
                  values (${tenant.id}, ${order.id}, ${crypto.randomUUID()}, 1, 1.00)
                `,
              () =>
                client`
                  delete from procurement.purchase_order_lines
                  where tenant_id = ${tenant.id} and purchase_order_id = ${order.id}
                `,
            ]
          ) {
            const failure = yield* postgresFailure(mutation)
            assert.strictEqual((failure as { code?: string }).code, "23514")
            assert.strictEqual(
              (failure as { constraint_name?: string }).constraint_name,
              "purchase_order_confirmed_lines_immutable",
            )
          }

          const constraintOrder = yield* procurement.createPurchaseOrder({
            principal,
            tenantId: tenant.id,
            supplierAccountId: account.id,
            lines: [{ itemId: crypto.randomUUID(), quantity: "1", unitPrice: "5.00" }],
          })
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
                values (${tenant.id}, ${constraintOrder.id}, ${crypto.randomUUID()}, ${quantity}, ${unitPrice})
              `
            )
            assert.strictEqual((failure as { code?: string }).code, "23514")
            assert.strictEqual(
              (failure as { constraint_name?: string }).constraint_name,
              constraint,
            )
          }

          const [inconsistentOrder] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
              insert into procurement.purchase_orders (tenant_id, supplier_account_id, total)
              values (${tenant.id}, ${account.id}, 11.00)
              returning id
            `
          )
          yield* Effect.promise(() =>
            client`
              insert into procurement.purchase_order_lines
                (tenant_id, purchase_order_id, item_id, quantity, unit_price)
              values (${tenant.id}, ${inconsistentOrder!.id}, ${crypto.randomUUID()}, 1, 10.00)
            `
          )
          const inconsistentTotal = yield* postgresFailure(() =>
            client.begin(async (transaction) => {
              await transaction`
                update procurement.purchase_orders
                set status = 'confirmed',
                  confirmation_idempotency_key = 'inconsistent-confirmation',
                  confirmed_at = now()
                where tenant_id = ${tenant.id} and id = ${inconsistentOrder!.id}
              `
              await transaction`set constraints all immediate`
            })
          )
          assert.strictEqual((inconsistentTotal as { code?: string }).code, "23514")
          assert.strictEqual(
            (inconsistentTotal as { constraint_name?: string }).constraint_name,
            "purchase_order_confirmed_total_consistent",
          )

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
