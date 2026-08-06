import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { AuthService, makeAuthTestLayer, TenantAlreadyExists } from "../../packages/auth/mod.ts"
import {
  AuthorizationDenied,
  AuthorizationService,
  makeAuthorizationTestLayer,
} from "../../packages/authorization/mod.ts"
import { AccountingService, makeAccountingTestLayer } from "../../packages/accounting/mod.ts"
import {
  ExternalIdentifierAlreadyAssigned,
  LegalEntityNotFound,
  makePartyTestLayer,
  PartyService,
} from "../../packages/party/mod.ts"
import {
  InventoryService,
  makeInventoryTestLayer,
  StockTransferDifferentLegalEntity,
} from "../../packages/inventory/mod.ts"
import { bootstrapTenant } from "./bootstrap.ts"

const principal = { userAccountId: "bootstrap-admin", sessionId: "session" }
const input = {
  principal,
  slug: "acme",
  timezone: "Asia/Jakarta",
  organizationName: "ACME Indonesia",
  branchName: "Jakarta",
  branchTimezone: "Asia/Jakarta",
  localTaxRegistration: "TAX-JKT-001",
  dedicatedJournalCode: "JKT-OPS",
  warehouseName: "Jakarta Main",
  baseCurrency: "usd",
  precision: 2,
  fiscalYearStartMonth: 1,
  postingEnabled: true,
}

const withBootstrap = <A, E>(
  program: Effect.Effect<
    A,
    E,
    AuthService | AuthorizationService | PartyService | AccountingService | InventoryService
  >,
) => {
  const authorizationLayer = makeAuthorizationTestLayer()
  const businessLayers = Layer.mergeAll(
    makePartyTestLayer(),
    makeAccountingTestLayer(),
    makeInventoryTestLayer(),
  ).pipe(Layer.provide(authorizationLayer))
  return Effect.provide(
    program,
    Layer.mergeAll(makeAuthTestLayer(), authorizationLayer, businessLayers),
  )
}

it.effect("bootstraps the tenant scope vertical slice", () =>
  withBootstrap(Effect.gen(function* () {
    const result = yield* bootstrapTenant(input)

    assert.strictEqual(result.tenant.slug, "acme")
    assert.strictEqual(result.tenant.timezone, "Asia/Jakarta")
    assert.strictEqual(result.organization.kind, "organization")
    assert.strictEqual(result.legalEntity.organizationId, result.organization.id)
    assert.strictEqual(result.branch.legalEntityId, result.legalEntity.id)
    assert.strictEqual(result.branch.localTaxRegistration, "TAX-JKT-001")
    assert.strictEqual(result.branch.dedicatedJournalCode, "JKT-OPS")
    assert.strictEqual(result.accountingConfiguration.legalEntityId, result.legalEntity.id)
    assert.strictEqual(result.accountingConfiguration.baseCurrency, "USD")
    assert.strictEqual(result.warehouse.legalEntityId, result.legalEntity.id)
    assert.strictEqual(result.warehouse.primaryBranchId, result.branch.id)

    assert.instanceOf(
      yield* Effect.flip(bootstrapTenant(input)),
      TenantAlreadyExists,
    )
  })))

it.effect("preserves typed failure boundaries around the bootstrap result", () =>
  withBootstrap(Effect.gen(function* () {
    const auth = yield* AuthService
    const authorization = yield* AuthorizationService
    const party = yield* PartyService
    const inventory = yield* InventoryService
    const result = yield* bootstrapTenant(input)

    assert.instanceOf(
      yield* Effect.flip(party.create({
        principal: { userAccountId: "outsider", sessionId: "session" },
        tenantId: result.tenant.id,
        kind: "organization",
        name: "Unauthorized",
      })),
      AuthorizationDenied,
    )

    const otherTenant = yield* auth.createTenant({ slug: "other" })
    yield* authorization.grant({
      userAccountId: principal.userAccountId,
      tenantId: otherTenant.id,
      capability: "party.branch.create",
    })
    assert.instanceOf(
      yield* Effect.flip(party.createBranch({
        principal,
        tenantId: otherTenant.id,
        legalEntityId: result.legalEntity.id,
        name: "Cross Tenant",
      })),
      LegalEntityNotFound,
    )

    yield* authorization.grant({
      userAccountId: principal.userAccountId,
      tenantId: result.tenant.id,
      capability: "party.identifier.attach",
    })
    const identifier = {
      principal,
      tenantId: result.tenant.id,
      partyId: result.organization.id,
      provider: "registry",
      scheme: "account",
      scope: "global",
      value: "ACME-1",
    }
    yield* party.attachIdentifier(identifier)
    assert.instanceOf(
      yield* Effect.flip(party.attachIdentifier(identifier)),
      ExternalIdentifierAlreadyAssigned,
    )

    yield* authorization.grant({
      userAccountId: principal.userAccountId,
      tenantId: result.tenant.id,
      capability: "inventory.stock.transfer.create",
    })
    const otherWarehouse = yield* inventory.createWarehouse({
      principal,
      tenantId: result.tenant.id,
      legalEntityId: "other-legal-entity",
      name: "Other Entity Warehouse",
    })
    assert.instanceOf(
      yield* Effect.flip(inventory.createTransfer({
        principal,
        tenantId: result.tenant.id,
        sourceWarehouseId: result.warehouse.id,
        destinationWarehouseId: otherWarehouse.id,
        lines: [{ itemId: "missing", quantity: "1" }],
      })),
      StockTransferDifferentLegalEntity,
    )
  })))
