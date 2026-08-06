import { assert, it } from "@effect/vitest"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"

import { WebCryptoLive } from "../mod.ts"

it.effect("provides cryptography through the Effect environment", () =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const digest = yield* crypto.digest("SHA-256", new TextEncoder().encode("hello"))
    const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")

    assert.strictEqual(
      hex,
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    )
    assert.strictEqual((yield* crypto.randomBytes(32)).length, 32)
  }).pipe(Effect.provide(WebCryptoLive)))
