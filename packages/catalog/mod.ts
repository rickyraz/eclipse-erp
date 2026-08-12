import type * as Schema from "effect/Schema"

export type CatalogStability =
  | "PRIVATE"
  | "EXPERIMENTAL"
  | "PUBLIC"
  | "DEPRECATED"
  | "RETIRED"

export type ActionIdempotency = "required" | "inherent" | "unsupported"
export type ActionTransactionSemantics =
  | "local_atomic"
  | "coordination_only"
  | "durable_external_effect"

export type ActionCompensation =
  | { readonly kind: "action"; readonly actionId: string; readonly version: number }
  | { readonly kind: "none"; readonly recovery: "manual" }

export interface CompatibilityRange {
  readonly minimumVersion: number
  readonly maximumVersion: number
}

export interface DomainActionCatalogEntry {
  readonly kind: "DomainAction"
  readonly id: string
  readonly version: number
  readonly owningDomain: string
  readonly title: string
  readonly description: string
  readonly stability: CatalogStability
  readonly compatibilityRange: CompatibilityRange
  readonly inputSchema: Schema.Top
  readonly outputSchema: Schema.Top
  readonly errorSchemas: ReadonlyArray<Schema.Top>
  readonly requiredCapability: string
  readonly scope: ReadonlyArray<string>
  readonly idempotency: ActionIdempotency
  readonly transactionSemantics: ActionTransactionSemantics
  readonly timeoutPolicy: { readonly timeoutMs: number }
  readonly retryPolicy: { readonly maxAttempts: number }
  readonly compensation: ActionCompensation
}

export interface DomainEventCatalogEntry {
  readonly kind: "DomainEvent"
  readonly id: string
  readonly version: number
  readonly owningDomain: string
  readonly title: string
  readonly description: string
  readonly stability: CatalogStability
  readonly compatibilityRange: CompatibilityRange
  readonly payloadSchema: Schema.Top
  readonly scope: ReadonlyArray<string>
  readonly aggregateType: string
  readonly correlationFields: ReadonlyArray<string>
  readonly filterableFields: ReadonlyArray<string>
  readonly occurredAtSemantics: "owner_commit_time"
}

export type ActionCatalogEntry = DomainActionCatalogEntry
export type EventCatalogEntry = DomainEventCatalogEntry

export const defineActionCatalogEntry = <const Entry extends DomainActionCatalogEntry>(
  entry: Entry,
): Entry => entry

export const defineEventCatalogEntry = <const Entry extends DomainEventCatalogEntry>(
  entry: Entry,
): Entry => entry
