import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/Encoding"
import * as Layer from "effect/Layer"

import {
  AccountingCapabilities,
  FinancialVerificationArtifactInvalid,
  makeAccountingService,
  makeFinancialLedgerTestLayer,
  makeFinancialOperationService,
} from "../mod.ts"
import { makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import {
  Database,
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
          const operationService = yield* Effect.provide(
            makeFinancialOperationService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              authorization,
              Layer.succeed(MessagingService, messaging),
              Layer.succeed(DurableJobEnqueuer, jobs),
              Layer.succeed(SalesService, sales),
              operationLedger,
            ),
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
          yield* Effect.promise(() =>
            client`
              delete from messaging.event_outbox
              where tenant_id = ${tenant!.id} and id = ${operation.id}
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
            sourceWatermark: "postgres:cutover",
            targetWatermark: "tigerbeetle:cutover",
            sourceSnapshotRef: "postgres:cutover-snapshot",
            targetSnapshotRef: "tigerbeetle:cutover-snapshot",
            evidenceArtifactId: verified.id,
          })
          assert.strictEqual(checkpoint.status, "verified")

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
