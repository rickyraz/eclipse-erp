import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { AuthorizationDenied, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import { makePartyTestLayer, PartyCapabilities, PartyService } from "../../party/mod.ts"
import {
  makeProcurementTestLayer,
  ProcurementCapabilities,
  ProcurementService,
  SupplierAccountAlreadyExists,
  SupplierAccountNotFound,
  SupplierRelationshipNotEligible,
} from "../mod.ts"

const principal = { userAccountId: "procurement-admin", sessionId: "session" }
const tenantId = "00000000-0000-4000-8000-000000000001"
const capabilities = [
  PartyCapabilities.partyCreate,
  PartyCapabilities.legalEntityCreate,
  PartyCapabilities.partyRoleAssign,
  PartyCapabilities.partyRelationshipCreate,
  PartyCapabilities.partyRelationshipRead,
  ProcurementCapabilities.supplierAccountCreate,
  ProcurementCapabilities.purchaseOrderCreate,
] as const

const withProcurement = <A, E>(
  program: Effect.Effect<A, E, PartyService | ProcurementService>,
  granted: ReadonlyArray<(typeof capabilities)[number]> = capabilities,
) => {
  const authorization = makeAuthorizationTestLayer(
    granted.map((capability) => ({
      userAccountId: principal.userAccountId,
      tenantId,
      capability,
    })),
  )
  const party = makePartyTestLayer().pipe(Layer.provide(authorization))
  const procurement = makeProcurementTestLayer().pipe(
    Layer.provide(Layer.merge(authorization, party)),
  )
  return Effect.provide(program, Layer.merge(party, procurement))
}

const createRelationship = (kind: "supplier" | "customer") =>
  Effect.gen(function* () {
    const party = yield* PartyService
    const owner = yield* party.create({
      principal,
      tenantId,
      kind: "organization",
      name: "Buying Legal Entity",
    })
    const legalEntity = yield* party.createLegalEntity({
      principal,
      tenantId,
      organizationId: owner.id,
    })
    const counterparty = yield* party.create({
      principal,
      tenantId,
      kind: "organization",
      name: `${kind} counterparty`,
    })
    yield* party.assignRole({
      principal,
      tenantId,
      partyId: counterparty.id,
      role: kind,
    })
    return yield* party.createRelationship({
      principal,
      tenantId,
      partyId: counterparty.id,
      legalEntityId: legalEntity.id,
      kind,
    })
  })

const createSupplierAccount = Effect.gen(function* () {
  const procurement = yield* ProcurementService
  const relationship = yield* createRelationship("supplier")
  return yield* procurement.createSupplierAccount({
    principal,
    tenantId,
    supplierRelationshipId: relationship.id,
  })
})

describe("procurement contract", () => {
  it.effect("creates one supplier account for an active supplier relationship", () =>
    withProcurement(Effect.gen(function* () {
      const procurement = yield* ProcurementService
      const relationship = yield* createRelationship("supplier")
      const input = {
        principal,
        tenantId,
        supplierRelationshipId: relationship.id,
      }
      const account = yield* procurement.createSupplierAccount(input)

      assert.strictEqual(account.tenantId, tenantId)
      assert.strictEqual(account.supplierRelationshipId, relationship.id)
      assert.strictEqual(account.partyId, relationship.partyId)
      assert.strictEqual(account.legalEntityId, relationship.legalEntityId)
      assert.instanceOf(
        yield* Effect.flip(procurement.createSupplierAccount(input)),
        SupplierAccountAlreadyExists,
      )
    })))

  it.effect("rejects missing or non-supplier relationships", () =>
    withProcurement(Effect.gen(function* () {
      const procurement = yield* ProcurementService
      const customerRelationship = yield* createRelationship("customer")

      assert.instanceOf(
        yield* Effect.flip(procurement.createSupplierAccount({
          principal,
          tenantId,
          supplierRelationshipId: customerRelationship.id,
        })),
        SupplierRelationshipNotEligible,
      )
      assert.instanceOf(
        yield* Effect.flip(procurement.createSupplierAccount({
          principal,
          tenantId,
          supplierRelationshipId: "00000000-0000-4000-8000-000000000099",
        })),
        SupplierRelationshipNotEligible,
      )
    })))

  it.effect("creates a draft purchase order with an exact derived total", () =>
    withProcurement(Effect.gen(function* () {
      const procurement = yield* ProcurementService
      const supplierAccount = yield* createSupplierAccount
      const lines = [
        {
          itemId: "00000000-0000-4000-8000-000000000010",
          quantity: "3",
          unitPrice: "12.34",
        },
        {
          itemId: "00000000-0000-4000-8000-000000000011",
          quantity: "2",
          unitPrice: "0.01",
        },
      ]
      const order = yield* procurement.createPurchaseOrder({
        principal,
        tenantId,
        supplierAccountId: supplierAccount.id,
        lines,
      })

      assert.strictEqual(order.status, "draft")
      assert.strictEqual(order.total, "37.04")
      assert.deepStrictEqual(order.lines, lines)
    })))

  it.effect("maps a missing supplier account", () =>
    withProcurement(Effect.gen(function* () {
      const procurement = yield* ProcurementService
      assert.instanceOf(
        yield* Effect.flip(procurement.createPurchaseOrder({
          principal,
          tenantId,
          supplierAccountId: "00000000-0000-4000-8000-000000000099",
          lines: [{
            itemId: "00000000-0000-4000-8000-000000000010",
            quantity: "1",
            unitPrice: "1.00",
          }],
        })),
        SupplierAccountNotFound,
      )
    })))

  it.effect("validates purchase order lines and derived totals", () =>
    withProcurement(Effect.gen(function* () {
      const procurement = yield* ProcurementService
      const supplierAccount = yield* createSupplierAccount
      const create = (lines: ReadonlyArray<unknown>) =>
        procurement.createPurchaseOrder({
          principal,
          tenantId,
          supplierAccountId: supplierAccount.id,
          lines,
        })

      for (
        const lines of [
          [],
          [{ itemId: "not-a-uuid", quantity: "1", unitPrice: "1.00" }],
          [{
            itemId: "00000000-0000-4000-8000-000000000010",
            quantity: "0",
            unitPrice: "1.00",
          }],
          [{
            itemId: "00000000-0000-4000-8000-000000000010",
            quantity: "1",
            unitPrice: "-1.00",
          }],
          [{
            itemId: "00000000-0000-4000-8000-000000000010",
            quantity: "9223372036854775808",
            unitPrice: "0.00",
          }],
          [{
            itemId: "00000000-0000-4000-8000-000000000010",
            quantity: "9223372036854775807",
            unitPrice: "999999999999999999.99",
          }],
        ]
      ) {
        assert.instanceOf(yield* Effect.flip(create(lines)), Schema.SchemaError)
      }
    })))

  it.effect("denies purchase order creation by default", () =>
    withProcurement(
      Effect.gen(function* () {
        const procurement = yield* ProcurementService
        const supplierAccount = yield* createSupplierAccount
        assert.instanceOf(
          yield* Effect.flip(procurement.createPurchaseOrder({
            principal,
            tenantId,
            supplierAccountId: supplierAccount.id,
            lines: [{
              itemId: "00000000-0000-4000-8000-000000000010",
              quantity: "1",
              unitPrice: "1.00",
            }],
          })),
          AuthorizationDenied,
        )
      }),
      capabilities.filter((capability) =>
        capability !== ProcurementCapabilities.purchaseOrderCreate
      ),
    ))

  it.effect("requires both procurement creation and Party relationship-read authority", () =>
    withProcurement(
      Effect.gen(function* () {
        const procurement = yield* ProcurementService
        const relationship = yield* createRelationship("supplier")
        assert.instanceOf(
          yield* Effect.flip(procurement.createSupplierAccount({
            principal,
            tenantId,
            supplierRelationshipId: relationship.id,
          })),
          AuthorizationDenied,
        )
      }),
      capabilities.filter((capability) =>
        capability !== ProcurementCapabilities.supplierAccountCreate
      ),
    ).pipe(
      Effect.andThen(
        withProcurement(
          Effect.gen(function* () {
            const procurement = yield* ProcurementService
            const relationship = yield* createRelationship("supplier")
            assert.instanceOf(
              yield* Effect.flip(procurement.createSupplierAccount({
                principal,
                tenantId,
                supplierRelationshipId: relationship.id,
              })),
              AuthorizationDenied,
            )
          }),
          capabilities.filter((capability) =>
            capability !== PartyCapabilities.partyRelationshipRead
          ),
        ),
      ),
    ))
})
