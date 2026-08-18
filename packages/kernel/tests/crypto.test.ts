import { assert, it } from "@effect/vitest"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"

import { generateEd25519FinancialVerificationSigner, WebCryptoLive } from "../mod.ts"

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

it.effect("signs and verifies a readiness payload with an explicit key id", () =>
  Effect.gen(function* () {
    const generated = yield* generateEd25519FinancialVerificationSigner("test-key")
    const signature = yield* Effect.promise(() => generated.signer.sign("artifact-hash"))
    assert.isTrue(yield* Effect.promise(() => generated.signer.verify("artifact-hash", signature)))
    assert.isFalse(
      yield* Effect.promise(() => generated.signer.verify("different-hash", signature)),
    )
  }))
