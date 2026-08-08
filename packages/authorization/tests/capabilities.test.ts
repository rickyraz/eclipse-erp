import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  Capability,
  CapabilityDefinition,
  CapabilityDefinitions,
  CapabilityId,
  CapabilityIds,
  isCapabilityIdShape,
  LegacyCapabilityIds,
} from "../mod.ts"

describe("capability naming contract", () => {
  it("keeps the catalog unique and metadata-aligned", () => {
    assert.strictEqual(new Set(CapabilityIds).size, CapabilityIds.length)
    assert.strictEqual(
      new Set(CapabilityDefinitions.map((definition) => definition.id)).size,
      CapabilityDefinitions.length,
    )
    assert.deepStrictEqual(
      CapabilityDefinitions.map((definition) => definition.id),
      Array.from(CapabilityIds),
    )
    for (const definition of CapabilityDefinitions) {
      const segments = definition.id.split(".")
      assert.strictEqual(definition.owner, segments[0])
      assert.strictEqual(
        definition.resource,
        segments.length === 2 ? segments[0] : segments[1],
      )
      assert.strictEqual(definition.verb, segments.at(-1))
      assert.strictEqual(definition.version, 1)
      assert.strictEqual(definition.stability, "PUBLIC")
      assert.deepStrictEqual(definition.scope, ["tenant"])
    }
  })

  it("accepts canonical shapes and rejects broad or nested names", () => {
    assert.isTrue(isCapabilityIdShape("party.create"))
    assert.isTrue(isCapabilityIdShape("inventory.stock_transfer.confirm"))
    assert.isFalse(isCapabilityIdShape("user_account.write"))
    assert.isFalse(isCapabilityIdShape("inventory.stock.transfer.confirm"))
    assert.isFalse(isCapabilityIdShape("Party.Create"))
  })

  it.effect("keeps legacy identifiers outside the assignable capability schema", () =>
    Effect.gen(function* () {
      for (const legacy of LegacyCapabilityIds) {
        assert.strictEqual(
          (yield* Effect.flip(Schema.decodeUnknownEffect(Capability)(legacy)))._tag,
          "SchemaError",
        )
      }
      assert.strictEqual(
        yield* Schema.decodeUnknownEffect(Capability)("identity.user_account.read"),
        "identity.user_account.read",
      )
    }))

  it.effect("validates contributor-shaped identifiers at the schema boundary", () =>
    Effect.gen(function* () {
      assert.strictEqual(
        yield* Schema.decodeUnknownEffect(CapabilityId)("plugin_customer.submit"),
        "plugin_customer.submit",
      )
      assert.strictEqual(
        (yield* Effect.flip(Schema.decodeUnknownEffect(CapabilityId)("sales.customer.manage")))
          ._tag,
        "SchemaError",
      )
      const definition = yield* Schema.decodeUnknownEffect(CapabilityDefinition)({
        id: "plugin_customer.submit",
        owner: "plugin_customer",
        resource: "customer",
        verb: "submit",
        version: 1,
        stability: "EXPERIMENTAL",
        scope: ["tenant"],
      })
      assert.strictEqual(definition.owner, "plugin_customer")
      assert.strictEqual(definition.stability, "EXPERIMENTAL")
    }))
})
