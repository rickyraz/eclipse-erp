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
import { type BootstrapServices, bootstrapTenant } from "./bootstrap.ts"

const principal = { identityId: "bootstrap-admin", sessionId: "session" }
const input = {
  principal,
  slug: "acme",
  timezone: "Asia/Jakarta",
  organizationName: "ACME Indonesia",
  branchName: "Jakarta",
  branchTimezone: "Asia/Jakarta",
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
  return Effect.gen(function* () {
    const authorization = yield* AuthorizationService
    return yield* Effect.provide(
      program,
      Layer.mergeAll(
        makePartyTestLayer(authorization),
        makeAccountingTestLayer(authorization),
        makeInventoryTestLayer(authorization),
      ),
    )
  }).pipe(Effect.provide(Layer.merge(makeAuthTestLayer(), authorizationLayer)))
}

const services = Effect.gen(function* () {
  return {
    auth: yield* AuthService,
    authorization: yield* AuthorizationService,
    party: yield* PartyService,
    accounting: yield* AccountingService,
    inventory: yield* InventoryService,
  } satisfies BootstrapServices
})

it.effect("bootstraps the tenant scope vertical slice", () =>
  withBootstrap(Effect.gen(function* () {
    const resolved = yield* services
    const result = yield* bootstrapTenant(resolved, input)

    assert.strictEqual(result.tenant.slug, "acme")
    assert.strictEqual(result.tenant.timezone, "Asia/Jakarta")
    assert.strictEqual(result.organizationParty.kind, "organization")
    assert.strictEqual(result.legalEntity.organizationPartyId, result.organizationParty.id)
    assert.strictEqual(result.branch.legalEntityId, result.legalEntity.id)
    assert.strictEqual(result.accountingConfiguration.legalEntityId, result.legalEntity.id)
    assert.strictEqual(result.accountingConfiguration.baseCurrency, "USD")
    assert.strictEqual(result.warehouse.legalEntityId, result.legalEntity.id)
    assert.strictEqual(result.warehouse.primaryBranchId, result.branch.id)

    assert.instanceOf(
      yield* Effect.flip(bootstrapTenant(resolved, input)),
      TenantAlreadyExists,
    )
  })))

it.effect("preserves typed failure boundaries around the bootstrap result", () =>
  withBootstrap(Effect.gen(function* () {
    const resolved = yield* services
    const result = yield* bootstrapTenant(resolved, input)

    assert.instanceOf(
      yield* Effect.flip(resolved.party.create({
        principal: { identityId: "outsider", sessionId: "session" },
        tenantId: result.tenant.id,
        kind: "organization",
        name: "Unauthorized",
      })),
      AuthorizationDenied,
    )

    const otherTenant = yield* resolved.auth.createTenant({ slug: "other" })
    yield* resolved.authorization.grant({
      identityId: principal.identityId,
      tenantId: otherTenant.id,
      capability: "party.branch.create",
    })
    assert.instanceOf(
      yield* Effect.flip(resolved.party.createBranch({
        principal,
        tenantId: otherTenant.id,
        legalEntityId: result.legalEntity.id,
        name: "Cross Tenant",
      })),
      LegalEntityNotFound,
    )

    yield* resolved.authorization.grant({
      identityId: principal.identityId,
      tenantId: result.tenant.id,
      capability: "party.identifier.attach",
    })
    const identifier = {
      principal,
      tenantId: result.tenant.id,
      partyId: result.organizationParty.id,
      provider: "registry",
      scheme: "account",
      scope: "global",
      value: "ACME-1",
    }
    yield* resolved.party.attachIdentifier(identifier)
    assert.instanceOf(
      yield* Effect.flip(resolved.party.attachIdentifier(identifier)),
      ExternalIdentifierAlreadyAssigned,
    )

    yield* resolved.authorization.grant({
      identityId: principal.identityId,
      tenantId: result.tenant.id,
      capability: "inventory.stock.transfer.create",
    })
    const otherWarehouse = yield* resolved.inventory.createWarehouse({
      principal,
      tenantId: result.tenant.id,
      legalEntityId: "other-legal-entity",
      name: "Other Entity Warehouse",
    })
    assert.instanceOf(
      yield* Effect.flip(resolved.inventory.createTransfer({
        principal,
        tenantId: result.tenant.id,
        sourceWarehouseId: result.warehouse.id,
        destinationWarehouseId: otherWarehouse.id,
        lines: [{ itemId: "missing", quantity: "1" }],
      })),
      StockTransferDifferentLegalEntity,
    )
  })))
