import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { checkOwnership } from "../../tooling/boundary-linter/check-ownership.ts"

it.effect("schema ownership registry is valid", () =>
  Effect.gen(function* () {
    const failures = yield* Effect.promise(() => checkOwnership())
    assert.deepStrictEqual(failures, [])
  }))
