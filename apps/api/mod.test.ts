import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { makeApiHandler } from "./mod.ts"
import { makeIdentityTestLayer } from "../../packages/identity/mod.ts"

describe("API", () => {
  const handler = makeApiHandler(makeIdentityTestLayer())

  it.effect("responds to health checks", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() => handler(new Request("http://localhost/health")))
      assert.strictEqual(response.status, 200)
      assert.deepStrictEqual(yield* Effect.promise(() => response.json()), { status: "ok" })
    }))

  it.effect("creates identities through the public service", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        handler(
          new Request("http://localhost/identities", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: "  API@Example.COM " }),
          }),
        )
      )
      assert.strictEqual(response.status, 201)
      assert.deepStrictEqual(yield* Effect.promise(() => response.json()), {
        id: "1",
        email: "api@example.com",
      })
    }))
})
