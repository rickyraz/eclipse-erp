import { assert, it } from "@effect/vitest"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"

import {
  FinancialVerificationKeyNotFound,
  FinancialVerificationKeyring,
  generateEd25519FinancialVerificationSigner,
  makeFinancialVerificationKeyring,
  WebCryptoLive,
} from "../mod.ts"

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
    const payload = new TextEncoder().encode("artifact-hash")
    const signature = yield* generated.signer.sign(payload)
    assert.strictEqual(generated.pair.privateKey.extractable, false)
    assert.isTrue(yield* generated.signer.verify(payload, signature))
    assert.isFalse(
      yield* generated.signer.verify(new TextEncoder().encode("different-hash"), signature),
    )
  }))

it.effect("verifies with multiple historical keys and fails closed for an unknown key", () =>
  Effect.gen(function* () {
    const oldKey = yield* generateEd25519FinancialVerificationSigner("old-key")
    const currentKey = yield* generateEd25519FinancialVerificationSigner("current-key")
    const payload = new TextEncoder().encode("artifact-hash")
    const signature = yield* oldKey.signer.sign(payload)
    yield* Effect.gen(function* () {
      const keyring = yield* FinancialVerificationKeyring
      assert.isTrue(yield* keyring.verify("old-key", payload, signature))
      assert.isFalse(yield* keyring.verify("current-key", payload, signature))
      assert.instanceOf(
        yield* Effect.flip(keyring.verify("missing-key", payload, signature)),
        FinancialVerificationKeyNotFound,
      )
    }).pipe(
      Effect.provide(makeFinancialVerificationKeyring([oldKey.signer, currentKey.signer])),
    )
  }))
