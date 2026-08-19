import * as Layer from "effect/Layer"
import type { Sql } from "postgres"

import {
  AccountingService,
  FinancialLedgerPort,
  FinancialOperationServiceLive,
  makeAccountingService,
  makePostgresqlFinancialLedgerLayer,
} from "../packages/accounting/mod.ts"
import { AuthService, makeAuthService } from "../packages/auth/mod.ts"
import { AuthorizationService, makeAuthorizationService } from "../packages/authorization/mod.ts"
import { makeUserAccountService, UserAccountService } from "../packages/identity/mod.ts"
import {
  DurableJobEnqueuer,
  makeTigerBeetleFinancialLedger,
  PostgresDatabaseLive,
  WebCryptoLive,
} from "../packages/kernel/mod.ts"
import { makeMessagingService, MessagingService } from "../packages/messaging/mod.ts"
import { makePartyService, PartyService } from "../packages/party/mod.ts"
import { makeSalesService, SalesService } from "../packages/sales/mod.ts"
import { InventoryService, makeInventoryService } from "../packages/inventory/mod.ts"
import {
  makeProcessJobEnqueuer,
  makeProcessService,
  ProcessService,
} from "../packages/process/mod.ts"
import type { FinancialVerificationSignerService } from "../packages/kernel/mod.ts"
import type { RitseiRuntimeConfiguration } from "./runtime-config.ts"

export const makeFinancialLedgerLayer = (
  database: ReturnType<typeof PostgresDatabaseLive>,
  configuration: RitseiRuntimeConfiguration,
) => {
  if (configuration.financialAuthority === "postgresql") {
    return makePostgresqlFinancialLedgerLayer.pipe(Layer.provide(database))
  }
  return Layer.effect(
    FinancialLedgerPort,
    makeTigerBeetleFinancialLedger(configuration.tigerBeetle),
  )
}

export const serviceLayers = (
  client: Sql,
  configuration: RitseiRuntimeConfiguration,
  financialSigner?: Layer.Layer<FinancialVerificationSignerService>,
) => {
  const database = PostgresDatabaseLive(client)
  const financialLedger = makeFinancialLedgerLayer(database, configuration)

  const userAccount = Layer.effect(UserAccountService, makeUserAccountService).pipe(
    Layer.provide(database),
  )

  const auth = Layer.effect(AuthService, makeAuthService).pipe(
    Layer.provide(Layer.mergeAll(database, WebCryptoLive, userAccount)),
  )

  const authorization = Layer.effect(AuthorizationService, makeAuthorizationService).pipe(
    Layer.provide(database),
  )

  const businessRequirements = Layer.merge(database, authorization)

  const party = Layer.effect(PartyService, makePartyService).pipe(
    Layer.provide(businessRequirements),
  )

  const messaging = Layer.effect(MessagingService, makeMessagingService).pipe(
    Layer.provide(database),
  )

  const sales = Layer.effect(SalesService, makeSalesService).pipe(
    Layer.provide(Layer.merge(businessRequirements, messaging)),
  )

  const inventory = Layer.effect(InventoryService, makeInventoryService).pipe(
    Layer.provide(Layer.merge(businessRequirements, messaging)),
  )

  const accountingRequirements = financialSigner === undefined
    ? Layer.mergeAll(businessRequirements, messaging, sales, financialLedger)
    : Layer.mergeAll(businessRequirements, messaging, sales, financialLedger, financialSigner)
  const accounting = Layer.effect(AccountingService, makeAccountingService).pipe(
    Layer.provide(accountingRequirements),
  )

  const jobEnqueuer = Layer.effect(DurableJobEnqueuer, makeProcessJobEnqueuer).pipe(
    Layer.provide(database),
  )

  const financialOperations = FinancialOperationServiceLive.pipe(
    Layer.provide(Layer.mergeAll(
      businessRequirements,
      messaging,
      sales,
      jobEnqueuer,
      financialLedger,
    )),
  )

  const process = Layer.effect(ProcessService, makeProcessService).pipe(
    Layer.provide(Layer.mergeAll(businessRequirements, sales, inventory, accounting, messaging)),
  )

  return Layer.mergeAll(
    userAccount,
    auth,
    authorization,
    party,
    sales,
    inventory,
    accounting,
    financialOperations,
    jobEnqueuer,
    messaging,
    process,
  )
}
