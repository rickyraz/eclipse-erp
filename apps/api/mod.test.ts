import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as OpenApi from "effect/unstable/httpapi/OpenApi"
import * as Schema from "effect/Schema"

import { JournalLine } from "../../packages/accounting/mod.ts"
import { RitseiApi } from "./api.ts"

it.effect("accepts the exact large amount at the API journal boundary", () =>
  Effect.sync(() => {
    assert.isTrue(
      Schema.is(JournalLine)({
        accountId: "00000000-0000-4000-8000-000000000001",
        debit: "500000000000000.00",
        credit: "0.00",
      }),
    )
    assert.isFalse(
      Schema.is(JournalLine)({
        accountId: "00000000-0000-4000-8000-000000000001",
        debit: "1000000000000000000.00",
        credit: "0.00",
      }),
    )
  }))

it.effect("derives routing and OpenAPI from the Effect HttpApi contract", () =>
  Effect.sync(() => {
    const specification = OpenApi.fromApi(RitseiApi)

    assert.strictEqual(specification.info.title, "RITSEI API")
    assert.ok(specification.paths["/health"]?.get)
    assert.ok(specification.paths["/user-accounts"]?.post)
    assert.ok(specification.paths["/parties"]?.post)
    assert.ok(specification.paths["/parties/{id}/identifiers"]?.post)
    assert.ok(specification.paths["/parties/{id}/relationships"]?.post)
    assert.ok(specification.paths["/sales/orders"]?.post)
    assert.ok(specification.paths["/inventory/reservations"]?.post)
    assert.ok(specification.paths["/inventory/transfers"]?.post)
    assert.ok(specification.paths["/inventory/transfers/{id}/confirm"]?.post)
    assert.ok(specification.paths["/inventory/transfers/{id}/complete"]?.post)
    assert.ok(specification.paths["/accounting/legal-entities/{id}/configuration"]?.post)
    assert.ok(specification.paths["/accounting/journals"]?.post)
    assert.ok(specification.paths["/process/order-confirmations"]?.post)
    assert.ok(specification.paths["/process/order-cancellations"]?.post?.responses?.["201"])
    assert.ok(specification.paths["/process/order-fulfillments"]?.post?.responses?.["201"])
    assert.ok(specification.paths["/process/order-confirmations/recover"]?.post)
    assert.ok(specification.paths["/process/order-confirmations/manual-recovery"]?.post)
    assert.ok(specification.components.securitySchemes.bearer)
    assert.ok(specification.paths["/user-accounts"]?.get?.responses?.["503"])
    assert.ok(specification.paths["/tenant-memberships"]?.get)
    assert.ok(specification.paths["/tenant-memberships"]?.post)
    assert.ok(specification.paths["/tenant-memberships/{userAccountId}/suspend"]?.post)
    assert.ok(specification.paths["/tenant-memberships/{userAccountId}/activate"]?.post)
    assert.ok(specification.paths["/tenant-memberships/{userAccountId}"]?.delete)
  }))
