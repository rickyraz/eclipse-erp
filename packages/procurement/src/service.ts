import { and, eq } from "drizzle-orm"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  purchaseOrderLines,
  purchaseOrders,
  supplierAccounts,
} from "../../../db/schema/procurement.ts"
import { Principal } from "../../auth/mod.ts"
import { AuthorizationDenied, AuthorizationService } from "../../authorization/mod.ts"
import {
  Database,
  DatabaseFailure,
  FinancialMajorAmount,
  isDatabaseConstraint,
  requireExactMajorToMinor,
} from "../../kernel/mod.ts"
import { PartyService } from "../../party/mod.ts"
import { ProcurementCapabilities } from "./capabilities.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const IsoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const InstantString = Schema.String.check(
  Schema.isPattern(IsoTimestamp),
  Schema.makeFilter((value) => !Number.isNaN(new Date(value).getTime()), {
    expected: "an ISO 8601 timestamp with a timezone",
  }),
)
const Quantity = Schema.String.check(
  Schema.makeFilter(
    (value) => /^[1-9]\d*$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n,
    { expected: "a positive PostgreSQL bigint quantity" },
  ),
)

export const SupplierAccount = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  supplierRelationshipId: Uuid,
  partyId: Uuid,
  legalEntityId: Uuid,
})

export const PurchaseOrderLine = Schema.Struct({
  itemId: Uuid,
  quantity: Quantity,
  unitPrice: FinancialMajorAmount,
})

export const PurchaseOrderLineSnapshot = Schema.Struct({
  id: Uuid,
  itemId: Uuid,
  quantity: Quantity,
  unitPrice: FinancialMajorAmount,
})

export const PurchaseOrder = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  supplierAccountId: Uuid,
  status: Schema.Literals(["draft", "confirmed", "cancelled"]),
  confirmedAt: Schema.NullOr(InstantString),
  total: FinancialMajorAmount,
  lines: Schema.Array(PurchaseOrderLineSnapshot),
}).check(Schema.makeFilter(
  (order) =>
    (order.status === "draft" && order.confirmedAt === null) ||
    (order.status !== "draft" && order.confirmedAt !== null),
  { expected: "purchase order confirmation metadata consistent with status" },
))

export type SupplierAccount = Schema.Schema.Type<typeof SupplierAccount>
export type PurchaseOrderLine = Schema.Schema.Type<typeof PurchaseOrderLine>
export type PurchaseOrderLineSnapshot = Schema.Schema.Type<typeof PurchaseOrderLineSnapshot>
export type PurchaseOrder = Schema.Schema.Type<typeof PurchaseOrder>

export const CreateSupplierAccountInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  supplierRelationshipId: Uuid,
})

export const CreatePurchaseOrderInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  supplierAccountId: Uuid,
  lines: Schema.Array(PurchaseOrderLine).check(Schema.isMinLength(1)),
})

export const ConfirmPurchaseOrderInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  purchaseOrderId: Uuid,
  idempotencyKey: NonEmptyString,
})

export const GetPurchaseOrderInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  purchaseOrderId: Uuid,
})

export const CancelPurchaseOrderInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  purchaseOrderId: Uuid,
})

export class SupplierAccountAlreadyExists
  extends Schema.TaggedErrorClass<SupplierAccountAlreadyExists>()(
    "SupplierAccountAlreadyExists",
    {
      tenantId: Uuid,
      supplierRelationshipId: Uuid,
    },
  ) {}

export class SupplierRelationshipNotEligible
  extends Schema.TaggedErrorClass<SupplierRelationshipNotEligible>()(
    "SupplierRelationshipNotEligible",
    {
      tenantId: Uuid,
      supplierRelationshipId: Uuid,
    },
  ) {}

export class SupplierAccountNotFound extends Schema.TaggedErrorClass<SupplierAccountNotFound>()(
  "SupplierAccountNotFound",
  {
    tenantId: Uuid,
    supplierAccountId: Uuid,
  },
) {}

export class PurchaseOrderNotFound extends Schema.TaggedErrorClass<PurchaseOrderNotFound>()(
  "PurchaseOrderNotFound",
  {
    tenantId: Uuid,
    purchaseOrderId: Uuid,
  },
) {}

export class PurchaseOrderConfirmationIdempotencyConflict
  extends Schema.TaggedErrorClass<PurchaseOrderConfirmationIdempotencyConflict>()(
    "PurchaseOrderConfirmationIdempotencyConflict",
    {
      tenantId: Uuid,
      purchaseOrderId: Uuid,
      idempotencyKey: NonEmptyString,
    },
  ) {}

export class PurchaseOrderInvalidState
  extends Schema.TaggedErrorClass<PurchaseOrderInvalidState>()("PurchaseOrderInvalidState", {
    tenantId: Uuid,
    purchaseOrderId: Uuid,
    status: Schema.Literals(["draft", "confirmed", "cancelled"]),
  }) {}

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

export interface ProcurementService {
  readonly createSupplierAccount: (
    input: unknown,
  ) => Effect.Effect<
    SupplierAccount,
    SupplierAccountAlreadyExists | SupplierRelationshipNotEligible | CommonFailure
  >
  readonly createPurchaseOrder: (
    input: unknown,
  ) => Effect.Effect<PurchaseOrder, SupplierAccountNotFound | CommonFailure>
  readonly getPurchaseOrder: (
    input: unknown,
  ) => Effect.Effect<PurchaseOrder, PurchaseOrderNotFound | CommonFailure>
  readonly confirmPurchaseOrder: (
    input: unknown,
  ) => Effect.Effect<
    PurchaseOrder,
    | PurchaseOrderConfirmationIdempotencyConflict
    | PurchaseOrderInvalidState
    | PurchaseOrderNotFound
    | CommonFailure
  >
  readonly cancelPurchaseOrder: (
    input: unknown,
  ) => Effect.Effect<
    PurchaseOrder,
    PurchaseOrderInvalidState | PurchaseOrderNotFound | CommonFailure
  >
}

export const ProcurementService = Context.Service<ProcurementService>("RITSEI/ProcurementService")

type CreateSupplierAccount = Schema.Schema.Type<typeof CreateSupplierAccountInput>

const loadSupplierRelationship = (party: PartyService, input: CreateSupplierAccount) =>
  party.getRelationship({
    principal: input.principal,
    tenantId: input.tenantId,
    relationshipId: input.supplierRelationshipId,
  }).pipe(
    Effect.catchTag(
      "PartyRelationshipNotFound",
      () =>
        Effect.fail(
          new SupplierRelationshipNotEligible({
            tenantId: input.tenantId,
            supplierRelationshipId: input.supplierRelationshipId,
          }),
        ),
    ),
    Effect.flatMap((relationship) =>
      relationship.kind === "supplier" && relationship.active
        ? Effect.succeed(relationship)
        : Effect.fail(
          new SupplierRelationshipNotEligible({
            tenantId: input.tenantId,
            supplierRelationshipId: input.supplierRelationshipId,
          }),
        )
    ),
  )

const supplierAccountSelection = {
  id: supplierAccounts.id,
  tenantId: supplierAccounts.tenantId,
  supplierRelationshipId: supplierAccounts.supplierRelationshipId,
}

const purchaseOrderSelection = {
  id: purchaseOrders.id,
  tenantId: purchaseOrders.tenantId,
  supplierAccountId: purchaseOrders.supplierAccountId,
  status: purchaseOrders.status,
  confirmedAt: purchaseOrders.confirmedAt,
  total: purchaseOrders.total,
}

const purchaseOrderLineSelection = {
  id: purchaseOrderLines.id,
  itemId: purchaseOrderLines.itemId,
  quantity: purchaseOrderLines.quantity,
  unitPrice: purchaseOrderLines.unitPrice,
}

const toPurchaseOrder = (row: {
  readonly id: string
  readonly tenantId: string
  readonly supplierAccountId: string
  readonly status: "draft" | "confirmed" | "cancelled"
  readonly confirmedAt: Date | null
  readonly total: string
}, lines: ReadonlyArray<PurchaseOrderLineSnapshot>): PurchaseOrder => ({
  id: row.id,
  tenantId: row.tenantId,
  supplierAccountId: row.supplierAccountId,
  status: row.status,
  confirmedAt: row.confirmedAt?.toISOString() ?? null,
  total: row.total,
  lines,
})

const deriveTotal = (lines: ReadonlyArray<PurchaseOrderLine>): string => {
  const minor = lines.reduce(
    (total, line) => total + BigInt(line.quantity) * requireExactMajorToMinor(line.unitPrice, 2),
    0n,
  )
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`
}

export const makeProcurementService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  const party = yield* PartyService
  const clock = yield* Clock.Clock
  const now = () => new Date(clock.currentTimeMillisUnsafe())

  return {
    createSupplierAccount: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateSupplierAccountInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: ProcurementCapabilities.supplierAccountCreate,
        })
        const relationship = yield* loadSupplierRelationship(party, decoded)
        const rows = yield* database.query(
          (db) =>
            db.insert(supplierAccounts)
              .values({
                tenantId: decoded.tenantId,
                supplierRelationshipId: decoded.supplierRelationshipId,
              })
              .returning(supplierAccountSelection),
          "procurement.supplier_account.create",
        ).pipe(
          Effect.mapError((error) => {
            if (
              isDatabaseConstraint(error, "supplier_accounts_tenant_supplier_relationship_key")
            ) {
              return new SupplierAccountAlreadyExists({
                tenantId: decoded.tenantId,
                supplierRelationshipId: decoded.supplierRelationshipId,
              })
            }
            if (
              isDatabaseConstraint(
                error,
                "supplier_accounts_tenant_supplier_relationship_fkey",
                "23503",
              )
            ) {
              return new SupplierRelationshipNotEligible({
                tenantId: decoded.tenantId,
                supplierRelationshipId: decoded.supplierRelationshipId,
              })
            }
            return error
          }),
        )
        const account = rows[0]!
        return {
          ...account,
          partyId: relationship.partyId,
          legalEntityId: relationship.legalEntityId,
        }
      }),
    createPurchaseOrder: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreatePurchaseOrderInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: ProcurementCapabilities.purchaseOrderCreate,
        })
        const total = deriveTotal(decoded.lines)
        yield* Schema.decodeUnknownEffect(FinancialMajorAmount)(total)
        return yield* database.transaction(
          async (tx) => {
            const [order] = await tx.insert(purchaseOrders)
              .values({
                tenantId: decoded.tenantId,
                supplierAccountId: decoded.supplierAccountId,
                total,
              })
              .returning(purchaseOrderSelection)
            const lines = await tx.insert(purchaseOrderLines)
              .values(decoded.lines.map((line) => ({
                tenantId: decoded.tenantId,
                purchaseOrderId: order!.id,
                itemId: line.itemId,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
              })))
              .returning(purchaseOrderLineSelection)
            return toPurchaseOrder(order!, lines)
          },
          "procurement.purchase_order.create",
        ).pipe(
          Effect.mapError((error) =>
            isDatabaseConstraint(
                error,
                "purchase_orders_tenant_supplier_account_fkey",
                "23503",
              )
              ? new SupplierAccountNotFound({
                tenantId: decoded.tenantId,
                supplierAccountId: decoded.supplierAccountId,
              })
              : error
          ),
        )
      }),
    getPurchaseOrder: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(GetPurchaseOrderInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: ProcurementCapabilities.purchaseOrderRead,
        })
        const order = yield* database.transaction(
          async (tx) => {
            const [row] = await tx.select(purchaseOrderSelection)
              .from(purchaseOrders)
              .where(and(
                eq(purchaseOrders.tenantId, decoded.tenantId),
                eq(purchaseOrders.id, decoded.purchaseOrderId),
              ))
            if (row === undefined) return undefined
            const lines = await tx.select(purchaseOrderLineSelection)
              .from(purchaseOrderLines)
              .where(and(
                eq(purchaseOrderLines.tenantId, decoded.tenantId),
                eq(purchaseOrderLines.purchaseOrderId, row.id),
              ))
            return toPurchaseOrder(row, lines)
          },
          "procurement.purchase_order.get",
        )
        if (order === undefined) {
          return yield* Effect.fail(
            new PurchaseOrderNotFound({
              tenantId: decoded.tenantId,
              purchaseOrderId: decoded.purchaseOrderId,
            }),
          )
        }
        return order
      }),
    confirmPurchaseOrder: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ConfirmPurchaseOrderInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: ProcurementCapabilities.purchaseOrderConfirm,
        })
        const result = yield* database.transaction(
          async (tx) => {
            const [row] = await tx.select({
              ...purchaseOrderSelection,
              confirmationIdempotencyKey: purchaseOrders.confirmationIdempotencyKey,
            })
              .from(purchaseOrders)
              .where(and(
                eq(purchaseOrders.tenantId, decoded.tenantId),
                eq(purchaseOrders.id, decoded.purchaseOrderId),
              ))
              .for("update")
            if (row === undefined) return { _tag: "not-found" as const }
            const lines = await tx.select(purchaseOrderLineSelection)
              .from(purchaseOrderLines)
              .where(and(
                eq(purchaseOrderLines.tenantId, decoded.tenantId),
                eq(purchaseOrderLines.purchaseOrderId, row.id),
              ))
            const current = toPurchaseOrder(row, lines)
            if (row.status === "confirmed") {
              return row.confirmationIdempotencyKey === decoded.idempotencyKey
                ? { _tag: "existing" as const, order: current }
                : { _tag: "idempotency-conflict" as const }
            }
            if (row.status !== "draft") {
              return { _tag: "invalid-state" as const, status: row.status }
            }
            const confirmedAt = now()
            const [confirmed] = await tx.update(purchaseOrders)
              .set({
                status: "confirmed",
                confirmationIdempotencyKey: decoded.idempotencyKey,
                confirmedAt,
                updatedAt: confirmedAt,
              })
              .where(and(
                eq(purchaseOrders.tenantId, decoded.tenantId),
                eq(purchaseOrders.id, decoded.purchaseOrderId),
                eq(purchaseOrders.status, "draft"),
              ))
              .returning(purchaseOrderSelection)
            return { _tag: "confirmed" as const, order: toPurchaseOrder(confirmed!, lines) }
          },
          "procurement.purchase_order.confirm",
        ).pipe(
          Effect.mapError((error) =>
            isDatabaseConstraint(
                error,
                "purchase_orders_tenant_confirmation_idempotency_key",
              )
              ? new PurchaseOrderConfirmationIdempotencyConflict({
                tenantId: decoded.tenantId,
                purchaseOrderId: decoded.purchaseOrderId,
                idempotencyKey: decoded.idempotencyKey,
              })
              : error
          ),
        )
        if (result._tag === "not-found") {
          return yield* Effect.fail(
            new PurchaseOrderNotFound({
              tenantId: decoded.tenantId,
              purchaseOrderId: decoded.purchaseOrderId,
            }),
          )
        }
        if (result._tag === "idempotency-conflict") {
          return yield* Effect.fail(
            new PurchaseOrderConfirmationIdempotencyConflict({
              tenantId: decoded.tenantId,
              purchaseOrderId: decoded.purchaseOrderId,
              idempotencyKey: decoded.idempotencyKey,
            }),
          )
        }
        if (result._tag === "invalid-state") {
          return yield* Effect.fail(
            new PurchaseOrderInvalidState({
              tenantId: decoded.tenantId,
              purchaseOrderId: decoded.purchaseOrderId,
              status: result.status,
            }),
          )
        }
        return result.order
      }),
    cancelPurchaseOrder: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CancelPurchaseOrderInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: ProcurementCapabilities.purchaseOrderCancel,
        })
        const result = yield* database.transaction(
          async (tx) => {
            const [row] = await tx.select(purchaseOrderSelection)
              .from(purchaseOrders)
              .where(and(
                eq(purchaseOrders.tenantId, decoded.tenantId),
                eq(purchaseOrders.id, decoded.purchaseOrderId),
              ))
              .for("update")
            if (row === undefined) return { _tag: "not-found" as const }
            const lines = await tx.select(purchaseOrderLineSelection)
              .from(purchaseOrderLines)
              .where(and(
                eq(purchaseOrderLines.tenantId, decoded.tenantId),
                eq(purchaseOrderLines.purchaseOrderId, row.id),
              ))
            const current = toPurchaseOrder(row, lines)
            if (row.status === "cancelled") {
              return { _tag: "existing" as const, order: current }
            }
            if (row.status !== "confirmed") {
              return { _tag: "invalid-state" as const, status: row.status }
            }
            const [cancelled] = await tx.update(purchaseOrders)
              .set({ status: "cancelled", updatedAt: now() })
              .where(and(
                eq(purchaseOrders.tenantId, decoded.tenantId),
                eq(purchaseOrders.id, decoded.purchaseOrderId),
                eq(purchaseOrders.status, "confirmed"),
              ))
              .returning(purchaseOrderSelection)
            return { _tag: "cancelled" as const, order: toPurchaseOrder(cancelled!, lines) }
          },
          "procurement.purchase_order.cancel",
        )
        if (result._tag === "not-found") {
          return yield* Effect.fail(
            new PurchaseOrderNotFound({
              tenantId: decoded.tenantId,
              purchaseOrderId: decoded.purchaseOrderId,
            }),
          )
        }
        if (result._tag === "invalid-state") {
          return yield* Effect.fail(
            new PurchaseOrderInvalidState({
              tenantId: decoded.tenantId,
              purchaseOrderId: decoded.purchaseOrderId,
              status: result.status,
            }),
          )
        }
        return result.order
      }),
  } satisfies ProcurementService
})

export const makeProcurementTestLayer = () =>
  Layer.effect(
    ProcurementService,
    Effect.gen(function* () {
      const authorization = yield* AuthorizationService
      const party = yield* PartyService
      const clock = yield* Clock.Clock
      const now = () => new Date(clock.currentTimeMillisUnsafe())
      const storedSupplierAccounts = new Map<string, SupplierAccount>()
      const storedPurchaseOrders = new Map<string, PurchaseOrder>()
      const confirmationKeys = new Map<string, string>()
      const confirmationOrderIdsByKey = new Map<string, string>()

      return {
        createSupplierAccount: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(CreateSupplierAccountInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: ProcurementCapabilities.supplierAccountCreate,
            })
            const relationship = yield* loadSupplierRelationship(party, decoded)
            if (
              [...storedSupplierAccounts.values()].some((account) =>
                account.tenantId === decoded.tenantId &&
                account.supplierRelationshipId === decoded.supplierRelationshipId
              )
            ) {
              return yield* Effect.fail(
                new SupplierAccountAlreadyExists({
                  tenantId: decoded.tenantId,
                  supplierRelationshipId: decoded.supplierRelationshipId,
                }),
              )
            }
            const account: SupplierAccount = {
              id: crypto.randomUUID(),
              tenantId: decoded.tenantId,
              supplierRelationshipId: decoded.supplierRelationshipId,
              partyId: relationship.partyId,
              legalEntityId: relationship.legalEntityId,
            }
            storedSupplierAccounts.set(account.id, account)
            return account
          }),
        createPurchaseOrder: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(CreatePurchaseOrderInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: ProcurementCapabilities.purchaseOrderCreate,
            })
            const total = deriveTotal(decoded.lines)
            yield* Schema.decodeUnknownEffect(FinancialMajorAmount)(total)
            if (
              storedSupplierAccounts.get(decoded.supplierAccountId)?.tenantId !== decoded.tenantId
            ) {
              return yield* Effect.fail(
                new SupplierAccountNotFound({
                  tenantId: decoded.tenantId,
                  supplierAccountId: decoded.supplierAccountId,
                }),
              )
            }
            const order: PurchaseOrder = {
              id: crypto.randomUUID(),
              tenantId: decoded.tenantId,
              supplierAccountId: decoded.supplierAccountId,
              status: "draft",
              confirmedAt: null,
              total,
              lines: decoded.lines.map((line) => ({ id: crypto.randomUUID(), ...line })),
            }
            storedPurchaseOrders.set(order.id, order)
            return order
          }),
        getPurchaseOrder: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(GetPurchaseOrderInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: ProcurementCapabilities.purchaseOrderRead,
            })
            const order = storedPurchaseOrders.get(decoded.purchaseOrderId)
            if (order?.tenantId !== decoded.tenantId) {
              return yield* Effect.fail(
                new PurchaseOrderNotFound({
                  tenantId: decoded.tenantId,
                  purchaseOrderId: decoded.purchaseOrderId,
                }),
              )
            }
            return order
          }),
        confirmPurchaseOrder: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(ConfirmPurchaseOrderInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: ProcurementCapabilities.purchaseOrderConfirm,
            })
            const order = storedPurchaseOrders.get(decoded.purchaseOrderId)
            if (order?.tenantId !== decoded.tenantId) {
              return yield* Effect.fail(
                new PurchaseOrderNotFound({
                  tenantId: decoded.tenantId,
                  purchaseOrderId: decoded.purchaseOrderId,
                }),
              )
            }
            if (order.status === "confirmed") {
              if (confirmationKeys.get(order.id) !== decoded.idempotencyKey) {
                return yield* Effect.fail(
                  new PurchaseOrderConfirmationIdempotencyConflict({
                    tenantId: decoded.tenantId,
                    purchaseOrderId: decoded.purchaseOrderId,
                    idempotencyKey: decoded.idempotencyKey,
                  }),
                )
              }
              return order
            }
            if (order.status !== "draft") {
              return yield* Effect.fail(
                new PurchaseOrderInvalidState({
                  tenantId: decoded.tenantId,
                  purchaseOrderId: decoded.purchaseOrderId,
                  status: order.status,
                }),
              )
            }
            const confirmationKey = `${decoded.tenantId}:${decoded.idempotencyKey}`
            const existingOrderId = confirmationOrderIdsByKey.get(confirmationKey)
            if (existingOrderId !== undefined && existingOrderId !== order.id) {
              return yield* Effect.fail(
                new PurchaseOrderConfirmationIdempotencyConflict({
                  tenantId: decoded.tenantId,
                  purchaseOrderId: decoded.purchaseOrderId,
                  idempotencyKey: decoded.idempotencyKey,
                }),
              )
            }
            const confirmed: PurchaseOrder = {
              ...order,
              status: "confirmed",
              confirmedAt: now().toISOString(),
            }
            storedPurchaseOrders.set(order.id, confirmed)
            confirmationKeys.set(order.id, decoded.idempotencyKey)
            confirmationOrderIdsByKey.set(confirmationKey, order.id)
            return confirmed
          }),
        cancelPurchaseOrder: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(CancelPurchaseOrderInput)(input)
            yield* authorization.authorize({
              principal: decoded.principal,
              tenantId: decoded.tenantId,
              capability: ProcurementCapabilities.purchaseOrderCancel,
            })
            const order = storedPurchaseOrders.get(decoded.purchaseOrderId)
            if (order?.tenantId !== decoded.tenantId) {
              return yield* Effect.fail(
                new PurchaseOrderNotFound({
                  tenantId: decoded.tenantId,
                  purchaseOrderId: decoded.purchaseOrderId,
                }),
              )
            }
            if (order.status === "cancelled") return order
            if (order.status !== "confirmed") {
              return yield* Effect.fail(
                new PurchaseOrderInvalidState({
                  tenantId: decoded.tenantId,
                  purchaseOrderId: decoded.purchaseOrderId,
                  status: order.status,
                }),
              )
            }
            const cancelled: PurchaseOrder = { ...order, status: "cancelled" }
            storedPurchaseOrders.set(order.id, cancelled)
            return cancelled
          }),
      } satisfies ProcurementService
    }),
  )
