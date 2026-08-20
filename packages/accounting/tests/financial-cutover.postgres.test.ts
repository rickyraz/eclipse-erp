import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/Encoding"
import * as Layer from "effect/Layer"

import {
  AccountingCapabilities,
  FinancialEngineCutoverBlocked,
  FinancialLedgerPort,
  FinancialReconciliationCheckpointEvidenceInvalid,
  FinancialVerificationArtifactInvalid,
  makeAccountingService,
  makeFinancialLedgerTestLayer,
  makeFinancialOperationService,
} from "../mod.ts"
import { makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import {
  Database,
  DatabaseFailure,
  DurableJobEnqueuer,
  FinancialVerificationSigner,
  generateEd25519FinancialVerificationSigner,
  makePostgresDatabase,
  runMigrations,
} from "../../kernel/mod.ts"
import { makeMessagingService, MessagingService } from "../../messaging/mod.ts"
import { makeProcessJobEnqueuer } from "../../process/mod.ts"
import { SalesService } from "../../sales/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"

const databaseUrl = Deno.env.get("DATABASE_URL")
const sales = {} as SalesService

it.effect.skipIf(databaseUrl === undefined)(
  "enforces the controlled cutover state machine",
  () =>
    withTemporaryDatabase(
      databaseUrl!,
      (client) =>
        Effect.gen(function* () {
          yield* runMigrations(client)
          const database = makePostgresDatabase(client)
          const [tenant] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${crypto.randomUUID()}) returning id
          `
          )
          const [organization] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
            insert into party.parties (tenant_id, kind, name)
            values (${tenant!.id}, 'organization', 'Cutover Organization') returning id
          `
          )
          const [legalEntity] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
            insert into party.legal_entities (tenant_id, organization_party_id)
            values (${tenant!.id}, ${organization!.id}) returning id
          `
          )
          yield* Effect.promise(() =>
            client`
            insert into accounting.legal_entity_accounting_configurations
              (tenant_id, legal_entity_id, base_currency, decimal_precision,
               fiscal_year_start_month, posting_enabled)
            values (${tenant!.id}, ${legalEntity!.id}, 'USD', 2, 1, true)
          `
          )
          yield* Effect.promise(() =>
            client`
            insert into accounting.accounts (tenant_id, code, name, type)
            values
              (${tenant!.id}, '1000', 'Cash', 'asset'),
              (${tenant!.id}, '4000', 'Revenue', 'revenue')
          `
          )
          const principal = {
            userAccountId: crypto.randomUUID(),
            sessionId: crypto.randomUUID(),
          }
          const generatedSigner = yield* generateEd25519FinancialVerificationSigner("test-key")
          const signer = yield* Effect.provide(
            Effect.service(FinancialVerificationSigner),
            generatedSigner.layer,
          )
          const authorization = makeAuthorizationTestLayer([{
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability: AccountingCapabilities.financialEngineActivate,
          }, {
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability: AccountingCapabilities.journalPost,
          }, {
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability: AccountingCapabilities.financialProjectionRebuild,
          }, {
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability: AccountingCapabilities.financialReconciliationCheckpoint,
          }, {
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability: AccountingCapabilities.financialEvidenceRecord,
          }])
          const messaging = yield* makeMessagingService.pipe(
            Effect.provideService(Database, database),
          )
          const service = yield* Effect.provide(
            makeAccountingService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              authorization,
              Layer.succeed(MessagingService, messaging),
              Layer.succeed(SalesService, sales),
              makeFinancialLedgerTestLayer(),
              generatedSigner.layer,
            ),
          )

          const prepared = yield* service.prepareTigerBeetleCutover({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
          })
          assert.strictEqual(prepared.status, "preparing_tigerbeetle")

          const evidence = {
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            kind: "cutover_rehearsal" as const,
            completeness: "bounded" as const,
            scope: `tenant:${tenant!.id}/legal-entity:${legalEntity!.id}`,
            schemaVersion: 1,
            mappingVersion: 1,
            currency: "USD",
            sourceWatermark: "postgres:test:1",
            targetWatermark: "tigerbeetle:test:1",
            sourceSnapshotRef: "postgres:test-snapshot",
            targetSnapshotRef: "tigerbeetle:test-snapshot",
            operationSetHash: "0".repeat(64),
            accountBalanceHash: "1".repeat(64),
            transferSetHash: "2".repeat(64),
            projectionHash: "3".repeat(64),
            sourceDebitMinor: "100",
            sourceCreditMinor: "100",
            targetDebitMinor: "100",
            targetCreditMinor: "100",
            accountCount: 2,
            operationCount: 1,
            transferCount: 2,
            mismatchCount: 1,
            startedAt: "2026-08-18T00:00:00.000Z",
            completedAt: "2026-08-18T00:01:00.000Z",
          }
          const rejected = yield* service.recordFinancialVerificationArtifact({
            principal,
            tenantId: tenant!.id,
            evidence,
          })
          assert.strictEqual(rejected.status, "rejected")
          assert.strictEqual(rejected.signatureAlgorithm, "Ed25519")
          const rejectedSignature = yield* Effect.fromResult(
            Encoding.decodeBase64Url(rejected.signature),
          )
          assert.strictEqual(
            yield* signer.verify(
              new TextEncoder().encode(rejected.artifactHash),
              rejectedSignature,
            ),
            true,
          )
          const artifactMutation = yield* Effect.flip(Effect.tryPromise({
            try: () =>
              client`
              update accounting.financial_verification_artifacts
              set scope = 'mutated'
              where tenant_id = ${tenant!.id} and id = ${rejected.id}
            `,
            catch: (cause) => cause,
          }))
          assert.strictEqual(
            (artifactMutation as { constraint_name?: string }).constraint_name,
            "financial_verification_artifacts_immutable",
          )
          const blocked = yield* Effect.flip(service.approveTigerBeetleCutover({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            evidenceArtifactId: rejected.id,
          }))
          assert.instanceOf(blocked, FinancialVerificationArtifactInvalid)
          assert.strictEqual(blocked.reason, "mismatch")
          const wrongCurrency = yield* Effect.flip(service.recordFinancialVerificationArtifact({
            principal,
            tenantId: tenant!.id,
            evidence: { ...evidence, currency: "EUR", mismatchCount: 0 },
          }))
          assert.instanceOf(wrongCurrency, FinancialVerificationArtifactInvalid)
          assert.strictEqual(wrongCurrency.reason, "scope_mismatch")

          const verified = yield* service.recordFinancialVerificationArtifact({
            principal,
            tenantId: tenant!.id,
            evidence: { ...evidence, mismatchCount: 0 },
          })
          const [forged] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
              insert into accounting.financial_verification_artifacts (
                tenant_id, legal_entity_id, artifact_hash, signature_algorithm,
                signing_key_id, signature, status, kind, completeness, scope,
                schema_version, mapping_version, currency, source_watermark,
                target_watermark, source_snapshot_ref, target_snapshot_ref,
                operation_set_hash, account_balance_hash, transfer_set_hash,
                projection_hash, source_debit_minor, source_credit_minor,
                target_debit_minor, target_credit_minor, account_count,
                operation_count, transfer_count, mismatch_count,
                producer_principal_id, started_at, completed_at
              )
              select tenant_id, legal_entity_id, artifact_hash, signature_algorithm,
                signing_key_id, 'not-a-signature', 'verified', kind, completeness, scope,
                schema_version, mapping_version, currency, source_watermark,
                target_watermark, source_snapshot_ref, target_snapshot_ref,
                operation_set_hash, account_balance_hash, transfer_set_hash,
                projection_hash, source_debit_minor, source_credit_minor,
                target_debit_minor, target_credit_minor, account_count,
                operation_count, transfer_count, 0, producer_principal_id,
                started_at, completed_at
              from accounting.financial_verification_artifacts
              where id = ${verified.id}
              returning id
            `
          )
          const forgedApproval = yield* Effect.flip(service.approveTigerBeetleCutover({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            evidenceArtifactId: forged!.id,
          }))
          assert.instanceOf(forgedApproval, FinancialVerificationArtifactInvalid)
          assert.strictEqual(forgedApproval.reason, "unsigned")
          yield* Effect.promise(() =>
            client`
              update accounting.legal_entity_accounting_configurations
              set base_currency = 'EUR'
              where tenant_id = ${tenant!.id} and legal_entity_id = ${legalEntity!.id}
            `
          )
          const driftedApproval = yield* Effect.flip(service.approveTigerBeetleCutover({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            evidenceArtifactId: verified.id,
          }))
          assert.instanceOf(driftedApproval, FinancialVerificationArtifactInvalid)
          assert.strictEqual(driftedApproval.reason, "scope_mismatch")
          yield* Effect.promise(() =>
            client`
              update accounting.legal_entity_accounting_configurations
              set base_currency = 'USD'
              where tenant_id = ${tenant!.id} and legal_entity_id = ${legalEntity!.id}
            `
          )

          const approved = yield* service.approveTigerBeetleCutover({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            evidenceArtifactId: verified.id,
          })
          assert.strictEqual(approved.status, "approved")
          assert.strictEqual(approved.approvedBy, principal.userAccountId)

          const activated = yield* service.activateTigerBeetleCutover({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
          })
          assert.strictEqual(activated.status, "tigerbeetle")
          assert.strictEqual(activated.activatedBy, principal.userAccountId)

          const idempotent = yield* service.activateTigerBeetleCutover({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
          })
          assert.deepStrictEqual(idempotent, activated)

          const [configuration] = yield* Effect.promise(() =>
            client<{ financial_engine: string }[]>`
            select financial_engine
            from accounting.legal_entity_accounting_configurations
            where tenant_id = ${tenant!.id} and legal_entity_id = ${legalEntity!.id}
          `
          )
          assert.strictEqual(configuration!.financial_engine, "tigerbeetle")

          yield* Effect.promise(() =>
            client`
              insert into accounting.accounting_periods
                (tenant_id, legal_entity_id, starts_on, ends_on, status)
              values (${tenant!.id}, ${legalEntity!.id}, '1900-01-01', '2100-12-31', 'open')
            `
          )
          const accountRows = yield* Effect.promise(() =>
            client<{ id: string; code: string }[]>`
              select id, code from accounting.accounts
              where tenant_id = ${tenant!.id}
              order by code
            `
          )
          const jobs = yield* makeProcessJobEnqueuer.pipe(
            Effect.provideService(Database, database),
          )
          const operationLedger = makeFinancialLedgerTestLayer()
          const operationLedgerService = yield* Effect.provide(
            Effect.service(FinancialLedgerPort),
            operationLedger,
          )
          const operationDependencies = Layer.mergeAll(
            Layer.succeed(Database, database),
            authorization,
            Layer.succeed(MessagingService, messaging),
            Layer.succeed(DurableJobEnqueuer, jobs),
            Layer.succeed(SalesService, sales),
            Layer.succeed(FinancialLedgerPort, operationLedgerService),
          )
          const operationService = yield* Effect.provide(
            makeFinancialOperationService,
            operationDependencies,
          )
          const operationInput = {
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            operationId: `cutover-operation-${crypto.randomUUID()}`,
            reference: `cutover-reference-${crypto.randomUUID()}`,
            currency: "USD",
            mappingVersion: 1,
            lines: [
              {
                accountId: accountRows.find((account) => account.code === "1000")!.id,
                debit: "12.50",
                credit: "0",
              },
              {
                accountId: accountRows.find((account) => account.code === "4000")!.id,
                debit: "0",
                credit: "12.50",
              },
            ],
            correlationId: `cutover-correlation-${crypto.randomUUID()}`,
          }
          const operation = yield* operationService.createJournalIntent(operationInput)
          const accepted = yield* operationService.submitFinancialOperation({
            tenantId: tenant!.id,
            operationId: operation.operationId,
          })
          assert.strictEqual(accepted.status, "reconciled")
          yield* Effect.promise(() =>
            client`
              delete from accounting.financial_operation_transfers
              where tenant_id = ${tenant!.id} and operation_id = ${operation.id}
            `
          )
          const missingProjectionCheckpoint = yield* operationService
            .reconcileFinancialCheckpoint({
              principal,
              tenantId: tenant!.id,
              legalEntityId: legalEntity!.id,
              recoveryWatermark: `missing-projection-${crypto.randomUUID()}`,
              sourceWatermark: "postgres:missing-projection",
              targetWatermark: "tigerbeetle:missing-projection",
              sourceSnapshotRef: "postgres:missing-projection-snapshot",
              targetSnapshotRef: "tigerbeetle:missing-projection-snapshot",
              evidenceArtifactId: null,
            })
          assert.strictEqual(missingProjectionCheckpoint.status, "blocked")
          assert.isAbove(missingProjectionCheckpoint.mismatchCount, 0)
          yield* Effect.promise(() =>
            client`
              delete from messaging.event_outbox
              where tenant_id = ${tenant!.id} and id = (
                select reconciled_event_id
                from accounting.financial_operations
                where tenant_id = ${tenant!.id} and id = ${operation.id}
              )
            `
          )
          const rebuilt = yield* operationService.rebuildFinancialProjections({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
          })
          assert.isAtLeast(rebuilt.rebuiltOperations, 1)
          const checkpoint = yield* operationService.reconcileFinancialCheckpoint({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            recoveryWatermark: `cutover-recovery-${crypto.randomUUID()}`,
            sourceWatermark: "postgres:test:1",
            targetWatermark: "tigerbeetle:test:1",
            sourceSnapshotRef: "postgres:test-snapshot",
            targetSnapshotRef: "tigerbeetle:test-snapshot",
            evidenceArtifactId: verified.id,
          })
          assert.strictEqual(checkpoint.status, "verified")
          const mappingMismatchArtifact = yield* service.recordFinancialVerificationArtifact({
            principal,
            tenantId: tenant!.id,
            evidence: {
              ...evidence,
              mappingVersion: 2,
              mismatchCount: 0,
              sourceWatermark: "postgres:mapping-artifact",
              targetWatermark: "tigerbeetle:mapping-artifact",
              sourceSnapshotRef: "postgres:mapping-artifact-snapshot",
              targetSnapshotRef: "tigerbeetle:mapping-artifact-snapshot",
            },
          })
          assert.strictEqual(mappingMismatchArtifact.status, "verified")
          const mappingMismatchCheckpoint = yield* Effect.flip(
            operationService.reconcileFinancialCheckpoint({
              principal,
              tenantId: tenant!.id,
              legalEntityId: legalEntity!.id,
              recoveryWatermark: `mapping-artifact-${crypto.randomUUID()}`,
              sourceWatermark: "postgres:mapping-artifact",
              targetWatermark: "tigerbeetle:mapping-artifact",
              sourceSnapshotRef: "postgres:mapping-artifact-snapshot",
              targetSnapshotRef: "tigerbeetle:mapping-artifact-snapshot",
              evidenceArtifactId: mappingMismatchArtifact.id,
            }),
          )
          assert.instanceOf(
            mappingMismatchCheckpoint,
            FinancialReconciliationCheckpointEvidenceInvalid,
          )
          assert.strictEqual(mappingMismatchCheckpoint.reason, "mapping_version_mismatch")

          let failReceipt = true
          const failingMessaging = {
            ...messaging,
            append: (event: unknown) =>
              failReceipt
                ? Effect.fail(
                  new DatabaseFailure({
                    operation: "financial-cutover.test.receipt",
                    cause: null,
                  }),
                )
                : messaging.append(event),
          } as typeof messaging
          const failingService = yield* Effect.provide(
            makeFinancialOperationService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              authorization,
              Layer.succeed(MessagingService, failingMessaging),
              Layer.succeed(DurableJobEnqueuer, jobs),
              Layer.succeed(SalesService, sales),
              Layer.succeed(FinancialLedgerPort, operationLedgerService),
            ),
          )
          const failedInput = {
            ...operationInput,
            operationId: `cutover-draft-${crypto.randomUUID()}`,
            reference: `cutover-draft-${crypto.randomUUID()}`,
          }
          yield* failingService.createJournalIntent(failedInput)
          const receiptFailure = yield* Effect.flip(failingService.submitFinancialOperation({
            tenantId: tenant!.id,
            operationId: failedInput.operationId,
          }))
          assert.instanceOf(receiptFailure, DatabaseFailure)
          const [failedState] = yield* Effect.promise(() =>
            client<{
              status: string
              journal_status: string
              transfer_status: string
            }[]>`
              select operation.status, journal.status as journal_status,
                transfer.status as transfer_status
              from accounting.financial_operations operation
              join accounting.journal_entries journal
                on journal.tenant_id = operation.tenant_id and journal.id = operation.journal_id
              join accounting.financial_operation_transfers transfer
                on transfer.tenant_id = operation.tenant_id and transfer.operation_id = operation.id
              where operation.tenant_id = ${tenant!.id}
                and operation.operation_id = ${failedInput.operationId}
            `
          )
          assert.deepStrictEqual(failedState, {
            status: "accepted",
            journal_status: "draft",
            transfer_status: "unresolved",
          })
          const draftCheckpoint = yield* failingService.reconcileFinancialCheckpoint({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            recoveryWatermark: `draft-journal-${crypto.randomUUID()}`,
            sourceWatermark: "postgres:draft-journal",
            targetWatermark: "tigerbeetle:draft-journal",
            sourceSnapshotRef: "postgres:draft-journal-snapshot",
            targetSnapshotRef: "tigerbeetle:draft-journal-snapshot",
            evidenceArtifactId: null,
          })
          assert.strictEqual(draftCheckpoint.status, "blocked")
          assert.isAbove(draftCheckpoint.mismatchCount, 0)
          failReceipt = false
          const recovered = yield* failingService.submitFinancialOperation({
            tenantId: tenant!.id,
            operationId: failedInput.operationId,
          })
          assert.strictEqual(recovered.status, "reconciled")
          yield* Effect.promise(() =>
            client`
              update accounting.financial_operation_transfers
              set status = 'manual_recovery'
              where tenant_id = ${tenant!.id} and operation_id = ${operation.id}
            `
          )
          const quarantinedTransferCheckpoint = yield* operationService
            .reconcileFinancialCheckpoint(
              {
                principal,
                tenantId: tenant!.id,
                legalEntityId: legalEntity!.id,
                recoveryWatermark: `quarantined-transfer-${crypto.randomUUID()}`,
                sourceWatermark: "postgres:quarantined-transfer",
                targetWatermark: "tigerbeetle:quarantined-transfer",
                sourceSnapshotRef: "postgres:quarantined-transfer-snapshot",
                targetSnapshotRef: "tigerbeetle:quarantined-transfer-snapshot",
                evidenceArtifactId: null,
              },
            )
          assert.strictEqual(quarantinedTransferCheckpoint.status, "blocked")
          assert.isAbove(quarantinedTransferCheckpoint.mismatchCount, 0)

          const balanceMismatchLedger = {
            ...operationLedgerService,
            getBalance: (input: unknown) =>
              operationLedgerService.getBalance(input).pipe(
                Effect.map((outcome) =>
                  outcome._tag === "available"
                    ? {
                      ...outcome,
                      debitsPostedMinor: (BigInt(outcome.debitsPostedMinor) + 1n).toString(),
                    }
                    : outcome
                ),
              ),
          }
          const balanceMismatchService = yield* Effect.provide(
            makeFinancialOperationService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              authorization,
              Layer.succeed(MessagingService, messaging),
              Layer.succeed(DurableJobEnqueuer, jobs),
              Layer.succeed(SalesService, sales),
              Layer.succeed(FinancialLedgerPort, balanceMismatchLedger),
            ),
          )
          const balanceMismatchCheckpoint = yield* balanceMismatchService
            .reconcileFinancialCheckpoint({
              principal,
              tenantId: tenant!.id,
              legalEntityId: legalEntity!.id,
              recoveryWatermark: `balance-mismatch-${crypto.randomUUID()}`,
              sourceWatermark: "postgres:balance-mismatch",
              targetWatermark: "tigerbeetle:balance-mismatch",
              sourceSnapshotRef: "postgres:balance-mismatch-snapshot",
              targetSnapshotRef: "tigerbeetle:balance-mismatch-snapshot",
              evidenceArtifactId: null,
            })
          assert.strictEqual(balanceMismatchCheckpoint.status, "blocked")
          assert.isAbove(balanceMismatchCheckpoint.mismatchCount, 0)
          const provenanceMismatch = yield* Effect.flip(
            operationService.reconcileFinancialCheckpoint({
              principal,
              tenantId: tenant!.id,
              legalEntityId: legalEntity!.id,
              recoveryWatermark: `provenance-mismatch-${crypto.randomUUID()}`,
              sourceWatermark: "postgres:wrong",
              targetWatermark: "tigerbeetle:test:1",
              sourceSnapshotRef: "postgres:test-snapshot",
              targetSnapshotRef: "tigerbeetle:test-snapshot",
              evidenceArtifactId: verified.id,
            }),
          )
          assert.instanceOf(provenanceMismatch, FinancialReconciliationCheckpointEvidenceInvalid)
          assert.strictEqual(provenanceMismatch.reason, "provenance_mismatch")
          yield* Effect.promise(() =>
            client`
              update accounting.legal_entity_accounting_configurations
              set base_currency = 'EUR'
              where tenant_id = ${tenant!.id} and legal_entity_id = ${legalEntity!.id}
            `
          )
          const driftedCheckpoint = yield* Effect.flip(
            operationService.reconcileFinancialCheckpoint({
              principal,
              tenantId: tenant!.id,
              legalEntityId: legalEntity!.id,
              recoveryWatermark: `currency-drift-${crypto.randomUUID()}`,
              sourceWatermark: "postgres:test:1",
              targetWatermark: "tigerbeetle:test:1",
              sourceSnapshotRef: "postgres:test-snapshot",
              targetSnapshotRef: "tigerbeetle:test-snapshot",
              evidenceArtifactId: verified.id,
            }),
          )
          assert.instanceOf(driftedCheckpoint, FinancialReconciliationCheckpointEvidenceInvalid)
          assert.strictEqual(driftedCheckpoint.reason, "scope_mismatch")
          yield* Effect.promise(() =>
            client`
              update accounting.legal_entity_accounting_configurations
              set base_currency = 'USD'
              where tenant_id = ${tenant!.id} and legal_entity_id = ${legalEntity!.id}
            `
          )
          const mixedMappingOperation = yield* operationService.createJournalIntent({
            ...operationInput,
            operationId: `cutover-mapping-v2-${crypto.randomUUID()}`,
            reference: `cutover-mapping-v2-${crypto.randomUUID()}`,
            mappingVersion: 2,
          })
          const mixedMappingAccepted = yield* operationService.submitFinancialOperation({
            tenantId: tenant!.id,
            operationId: mixedMappingOperation.operationId,
          })
          assert.strictEqual(mixedMappingAccepted.status, "reconciled")
          const mixedMappingCheckpoint = yield* Effect.flip(
            operationService.reconcileFinancialCheckpoint({
              principal,
              tenantId: tenant!.id,
              legalEntityId: legalEntity!.id,
              recoveryWatermark: `mixed-mapping-${crypto.randomUUID()}`,
              sourceWatermark: "postgres:mixed-mapping",
              targetWatermark: "tigerbeetle:mixed-mapping",
              sourceSnapshotRef: "postgres:mixed-mapping-snapshot",
              targetSnapshotRef: "tigerbeetle:mixed-mapping-snapshot",
              evidenceArtifactId: null,
            }),
          )
          assert.instanceOf(
            mixedMappingCheckpoint,
            FinancialReconciliationCheckpointEvidenceInvalid,
          )
          assert.strictEqual(mixedMappingCheckpoint.reason, "mapping_version_mismatch")

          const [otherOrganization] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
            insert into party.parties (tenant_id, kind, name)
            values (${tenant!.id}, 'organization', 'Second Cutover Organization') returning id
          `
          )
          const [otherEntity] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
            insert into party.legal_entities (tenant_id, organization_party_id)
            values (${tenant!.id}, ${otherOrganization!.id}) returning id
          `
          )
          yield* Effect.promise(() =>
            client`
            insert into accounting.legal_entity_accounting_configurations
              (tenant_id, legal_entity_id, base_currency, decimal_precision,
               fiscal_year_start_month, posting_enabled)
            values (${tenant!.id}, ${otherEntity!.id}, 'USD', 2, 1, true)
          `
          )
          const otherPrepared = yield* service.prepareTigerBeetleCutover({
            principal,
            tenantId: tenant!.id,
            legalEntityId: otherEntity!.id,
          })
          assert.strictEqual(otherPrepared.status, "preparing_tigerbeetle")
          const otherEvidence = {
            ...evidence,
            legalEntityId: otherEntity!.id,
            scope: `tenant:${tenant!.id}/legal-entity:${otherEntity!.id}`,
            sourceWatermark: "postgres:manual-recovery-approval",
            targetWatermark: "tigerbeetle:manual-recovery-approval",
            sourceSnapshotRef: "postgres:manual-recovery-approval-snapshot",
            targetSnapshotRef: "tigerbeetle:manual-recovery-approval-snapshot",
            sourceDebitMinor: "0",
            sourceCreditMinor: "0",
            targetDebitMinor: "0",
            targetCreditMinor: "0",
            accountCount: 0,
            operationCount: 0,
            transferCount: 0,
            mismatchCount: 0,
          }
          const otherArtifact = yield* service.recordFinancialVerificationArtifact({
            principal,
            tenantId: tenant!.id,
            evidence: otherEvidence,
          })
          assert.strictEqual(otherArtifact.status, "verified")
          const [otherPeriod] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
              insert into accounting.accounting_periods
                (tenant_id, legal_entity_id, starts_on, ends_on, status)
              values (${tenant!.id}, ${otherEntity!.id}, '1900-01-01', '2100-12-31', 'open')
              returning id
            `
          )
          const [otherJournal] = yield* Effect.promise(() =>
            client<{ id: string }[]>`
              insert into accounting.journal_entries (tenant_id, reference, status)
              values (${tenant!.id}, 'manual-recovery-approval-journal', 'draft')
              returning id
            `
          )
          yield* Effect.promise(() =>
            client`
              insert into accounting.financial_operations (
                tenant_id, legal_entity_id, period_id, operation_id, operation_type,
                journal_id, reference, currency, mapping_version, engine, engine_verified,
                request_fingerprint, actor_principal_id, actor_session_id, status,
                recovery_reason, observed_engine, last_error
              ) values (
                ${tenant!.id}, ${otherEntity!.id}, ${otherPeriod!.id},
                'manual-recovery-approval-operation', 'journal_post', ${otherJournal!.id},
                'manual-recovery-approval-reference', 'USD', 1, 'tigerbeetle', true,
                'manual-recovery-approval-fingerprint', ${principal.userAccountId},
                ${principal.sessionId}, 'manual_recovery', 'mapping_mismatch',
                'tigerbeetle', 'manual-recovery-approval-test'
              )
            `
          )
          const manualRecoveryCheckpoint = yield* operationService.reconcileFinancialCheckpoint({
            principal,
            tenantId: tenant!.id,
            legalEntityId: otherEntity!.id,
            recoveryWatermark: `manual-recovery-checkpoint-${crypto.randomUUID()}`,
            sourceWatermark: "postgres:manual-recovery-checkpoint",
            targetWatermark: "tigerbeetle:manual-recovery-checkpoint",
            sourceSnapshotRef: "postgres:manual-recovery-checkpoint-snapshot",
            targetSnapshotRef: "tigerbeetle:manual-recovery-checkpoint-snapshot",
            evidenceArtifactId: null,
          })
          assert.strictEqual(manualRecoveryCheckpoint.status, "blocked")
          assert.isAbove(manualRecoveryCheckpoint.mismatchCount, 0)
          const manualRecoveryApproval = yield* Effect.flip(
            service.approveTigerBeetleCutover({
              principal,
              tenantId: tenant!.id,
              legalEntityId: otherEntity!.id,
              evidenceArtifactId: otherArtifact.id,
            }),
          )
          assert.instanceOf(manualRecoveryApproval, FinancialEngineCutoverBlocked)
          assert.strictEqual(manualRecoveryApproval.reason, "unresolved_operations")

          const bypass = yield* Effect.flip(Effect.tryPromise({
            try: () =>
              client`
            update accounting.legal_entity_accounting_configurations
            set financial_engine = 'tigerbeetle'
            where tenant_id = ${tenant!.id} and legal_entity_id = ${otherEntity!.id}
          `,
            catch: (cause) => cause,
          }))
          assert.strictEqual(
            (bypass as { constraint_name?: string }).constraint_name,
            "legal_entity_accounting_engine_activation_gate_check",
          )
        }),
    ),
)
