import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  type AuthServiceShape,
  CreateTenantInput,
  Principal,
  Tenant,
} from "../../packages/auth/mod.ts"
import { type AuthorizationServiceShape, Capability } from "../../packages/authorization/mod.ts"
import {
  AccountingConfiguration,
  type AccountingServiceShape,
  ConfigureLegalEntityInput,
} from "../../packages/accounting/mod.ts"
import {
  Branch,
  CreateBranchInput,
  CreateLegalEntityInput,
  CreatePartyInput,
  LegalEntity,
  Party,
  type PartyServiceShape,
} from "../../packages/party/mod.ts"
import {
  CreateWarehouseInput,
  type InventoryServiceShape,
  Warehouse,
} from "../../packages/inventory/mod.ts"

const NonBlankString = Schema.String.check(Schema.isPattern(/\S/))

export const BootstrapTenantInput = Schema.Struct({
  principal: Principal,
  slug: NonBlankString,
  timezone: Schema.optionalKey(NonBlankString),
  organizationName: NonBlankString,
  branchName: NonBlankString,
  branchTimezone: Schema.optionalKey(NonBlankString),
  warehouseName: NonBlankString,
  baseCurrency: Schema.String,
  precision: Schema.Int,
  fiscalYearStartMonth: Schema.Int,
  postingEnabled: Schema.Boolean,
})

export const BootstrapTenantResult = Schema.Struct({
  tenant: Tenant,
  organizationParty: Party,
  legalEntity: LegalEntity,
  branch: Branch,
  accountingConfiguration: AccountingConfiguration,
  warehouse: Warehouse,
})

export type BootstrapTenantInput = Schema.Schema.Type<typeof BootstrapTenantInput>
export type BootstrapTenantResult = Schema.Schema.Type<typeof BootstrapTenantResult>

export interface BootstrapServices {
  readonly auth: AuthServiceShape
  readonly authorization: AuthorizationServiceShape
  readonly party: PartyServiceShape
  readonly accounting: AccountingServiceShape
  readonly inventory: InventoryServiceShape
}

const bootstrapCapabilities = [
  "party.create",
  "party.legal_entity.create",
  "party.branch.create",
  "accounting.legal_entity.configure",
  "inventory.warehouse.create",
] as const satisfies readonly Capability[]

export const bootstrapTenant = (
  services: BootstrapServices,
  input: unknown,
) =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(BootstrapTenantInput)(input)

    // Tenant creation is a trusted bootstrap operation, not a self-service API command.
    const tenant = yield* services.auth.createTenant(
      {
        slug: decoded.slug,
        timezone: decoded.timezone,
      } satisfies Schema.Schema.Type<typeof CreateTenantInput>,
    )

    for (const capability of bootstrapCapabilities) {
      yield* services.authorization.grant({
        identityId: decoded.principal.identityId,
        tenantId: tenant.id,
        capability,
      })
    }

    const organizationParty = yield* services.party.create(
      {
        principal: decoded.principal,
        tenantId: tenant.id,
        kind: "organization",
        name: decoded.organizationName,
      } satisfies Schema.Schema.Type<typeof CreatePartyInput>,
    )
    const legalEntity = yield* services.party.createLegalEntity(
      {
        principal: decoded.principal,
        tenantId: tenant.id,
        organizationPartyId: organizationParty.id,
      } satisfies Schema.Schema.Type<typeof CreateLegalEntityInput>,
    )
    const branch = yield* services.party.createBranch(
      {
        principal: decoded.principal,
        tenantId: tenant.id,
        legalEntityId: legalEntity.id,
        name: decoded.branchName,
        timezone: decoded.branchTimezone,
      } satisfies Schema.Schema.Type<typeof CreateBranchInput>,
    )
    const accountingConfiguration = yield* services.accounting.configureLegalEntity(
      {
        principal: decoded.principal,
        tenantId: tenant.id,
        legalEntityId: legalEntity.id,
        baseCurrency: decoded.baseCurrency,
        precision: decoded.precision,
        fiscalYearStartMonth: decoded.fiscalYearStartMonth,
        postingEnabled: decoded.postingEnabled,
      } satisfies Schema.Schema.Type<typeof ConfigureLegalEntityInput>,
    )
    const warehouse = yield* services.inventory.createWarehouse(
      {
        principal: decoded.principal,
        tenantId: tenant.id,
        legalEntityId: legalEntity.id,
        primaryBranchId: branch.id,
        name: decoded.warehouseName,
      } satisfies Schema.Schema.Type<typeof CreateWarehouseInput>,
    )

    return {
      tenant,
      organizationParty,
      legalEntity,
      branch,
      accountingConfiguration,
      warehouse,
    } satisfies BootstrapTenantResult
  })
