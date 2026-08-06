import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { AuthService, CreateTenantInput, Principal, Tenant } from "../../packages/auth/mod.ts"
import { AuthorizationService, Capability } from "../../packages/authorization/mod.ts"
import {
  AccountingConfiguration,
  AccountingService,
  ConfigureLegalEntityInput,
} from "../../packages/accounting/mod.ts"
import {
  Branch,
  CreateBranchInput,
  CreateLegalEntityInput,
  CreatePartyInput,
  LegalEntity,
  Party,
  PartyService,
} from "../../packages/party/mod.ts"
import { CreateWarehouseInput, InventoryService, Warehouse } from "../../packages/inventory/mod.ts"

const NonBlankString = Schema.String.check(Schema.isPattern(/\S/))

export const BootstrapTenantInput = Schema.Struct({
  principal: Principal,
  slug: NonBlankString,
  timezone: Schema.optionalKey(NonBlankString),
  organizationName: NonBlankString,
  branchName: NonBlankString,
  branchTimezone: Schema.optionalKey(NonBlankString),
  localTaxRegistration: Schema.optionalKey(NonBlankString),
  dedicatedJournalCode: Schema.optionalKey(NonBlankString),
  warehouseName: NonBlankString,
  baseCurrency: Schema.String,
  precision: Schema.Int,
  fiscalYearStartMonth: Schema.Int,
  postingEnabled: Schema.Boolean,
})

export const BootstrapTenantResult = Schema.Struct({
  tenant: Tenant,
  organization: Party,
  legalEntity: LegalEntity,
  branch: Branch,
  accountingConfiguration: AccountingConfiguration,
  warehouse: Warehouse,
})

export type BootstrapTenantInput = Schema.Schema.Type<typeof BootstrapTenantInput>
export type BootstrapTenantResult = Schema.Schema.Type<typeof BootstrapTenantResult>

const bootstrapCapabilities = [
  "party.create",
  "party.legal_entity.create",
  "party.branch.create",
  "accounting.legal_entity.configure",
  "inventory.warehouse.create",
] as const satisfies readonly Capability[]

export const bootstrapTenant = (input: unknown) =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(BootstrapTenantInput)(input)
    const auth = yield* AuthService
    const authorization = yield* AuthorizationService
    const party = yield* PartyService
    const accounting = yield* AccountingService
    const inventory = yield* InventoryService

    // Tenant creation is a trusted bootstrap operation, not a self-service API command.
    const tenant = yield* auth.createTenant(
      {
        slug: decoded.slug,
        timezone: decoded.timezone,
      } satisfies Schema.Schema.Type<typeof CreateTenantInput>,
    )

    for (const capability of bootstrapCapabilities) {
      yield* authorization.grant({
        userAccountId: decoded.principal.userAccountId,
        tenantId: tenant.id,
        capability,
      })
    }

    const organization = yield* party.create(
      {
        principal: decoded.principal,
        tenantId: tenant.id,
        kind: "organization",
        name: decoded.organizationName,
      } satisfies Schema.Schema.Type<typeof CreatePartyInput>,
    )
    const legalEntity = yield* party.createLegalEntity(
      {
        principal: decoded.principal,
        tenantId: tenant.id,
        organizationId: organization.id,
      } satisfies Schema.Schema.Type<typeof CreateLegalEntityInput>,
    )
    const branch = yield* party.createBranch(
      {
        principal: decoded.principal,
        tenantId: tenant.id,
        legalEntityId: legalEntity.id,
        name: decoded.branchName,
        timezone: decoded.branchTimezone,
        localTaxRegistration: decoded.localTaxRegistration,
        dedicatedJournalCode: decoded.dedicatedJournalCode,
      } satisfies Schema.Schema.Type<typeof CreateBranchInput>,
    )
    const accountingConfiguration = yield* accounting.configureLegalEntity(
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
    const warehouse = yield* inventory.createWarehouse(
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
      organization,
      legalEntity,
      branch,
      accountingConfiguration,
      warehouse,
    } satisfies BootstrapTenantResult
  })
