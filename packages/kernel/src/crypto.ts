import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PlatformError from "effect/PlatformError"
import * as Schema from "effect/Schema"

const randomBytes = (size: number) => {
  const bytes = new Uint8Array(size)
  for (let offset = 0; offset < bytes.length; offset += 65_536) {
    globalThis.crypto.getRandomValues(bytes.subarray(offset, offset + 65_536))
  }
  return bytes
}

export class FinancialVerificationSigningFailure
  extends Schema.TaggedErrorClass<FinancialVerificationSigningFailure>()(
    "FinancialVerificationSigningFailure",
    { keyId: Schema.String },
  ) {}

export class FinancialVerificationVerificationFailure
  extends Schema.TaggedErrorClass<FinancialVerificationVerificationFailure>()(
    "FinancialVerificationVerificationFailure",
    { keyId: Schema.String },
  ) {}

export class FinancialVerificationKeyGenerationFailure
  extends Schema.TaggedErrorClass<FinancialVerificationKeyGenerationFailure>()(
    "FinancialVerificationKeyGenerationFailure",
    { keyId: Schema.String },
  ) {}

export interface FinancialVerificationVerifierService {
  readonly algorithm: "Ed25519"
  readonly keyId: string
  readonly verify: (
    payload: Uint8Array,
    signature: Uint8Array,
  ) => Effect.Effect<boolean, FinancialVerificationVerificationFailure>
}

export interface FinancialVerificationSignerService extends FinancialVerificationVerifierService {
  readonly sign: (
    payload: Uint8Array,
  ) => Effect.Effect<Uint8Array, FinancialVerificationSigningFailure>
}

export class FinancialVerificationKeyNotFound
  extends Schema.TaggedErrorClass<FinancialVerificationKeyNotFound>()(
    "FinancialVerificationKeyNotFound",
    { keyId: Schema.String },
  ) {}

export interface FinancialVerificationKeyringService {
  readonly verify: (
    keyId: string,
    payload: Uint8Array,
    signature: Uint8Array,
  ) => Effect.Effect<
    boolean,
    FinancialVerificationKeyNotFound | FinancialVerificationVerificationFailure
  >
}

export const FinancialVerificationSigner = Context.Service<FinancialVerificationSignerService>(
  "RITSEI/FinancialVerificationSigner",
)

export const FinancialVerificationKeyring = Context.Service<FinancialVerificationKeyringService>(
  "RITSEI/FinancialVerificationKeyring",
)

const ed25519 = { name: "Ed25519" } as AlgorithmIdentifier
/**
 * Local development/test adapter.
 *
 * TODO(financial-prod): replace this implementation in the production composition
 * with the selected custody adapter. It may be software-managed, KMS-backed, or
 * HSM-backed; the selected policy must protect the private key, provide required
 * audit/recovery controls, and preserve this signer port.
 */
const makeEd25519FinancialVerificationSignerService = (
  keyId: string,
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): FinancialVerificationSignerService => ({
  algorithm: "Ed25519",
  keyId,
  sign: (payload) =>
    Effect.tryPromise({
      try: async () =>
        new Uint8Array(
          await globalThis.crypto.subtle.sign(ed25519, privateKey, new Uint8Array(payload)),
        ),
      catch: () => new FinancialVerificationSigningFailure({ keyId }),
    }),
  verify: (payload, signature) =>
    Effect.tryPromise({
      try: () =>
        globalThis.crypto.subtle.verify(
          ed25519,
          publicKey,
          new Uint8Array(signature),
          new Uint8Array(payload),
        ),
      catch: () => new FinancialVerificationVerificationFailure({ keyId }),
    }),
})

/**
 * In-memory verifier registry for development and tests.
 *
 * TODO(financial-prod): replace this registry in the production composition
 * with a provider-backed public-key resolver that enforces key retention,
 * revocation, audit identity, and rotation policy.
 */
export const makeFinancialVerificationKeyring = (
  verifiers: readonly FinancialVerificationVerifierService[],
) => {
  const byKeyId = new Map(verifiers.map((verifier) => [verifier.keyId, verifier]))
  return Layer.succeed(FinancialVerificationKeyring, {
    verify: (keyId, payload, signature) => {
      const verifier = byKeyId.get(keyId)
      if (verifier === undefined) {
        return Effect.fail(new FinancialVerificationKeyNotFound({ keyId }))
      }
      return verifier.verify(payload, signature)
    },
  })
}

const makeFinancialVerificationSignerLayer = (signer: FinancialVerificationSignerService) =>
  Layer.mergeAll(
    Layer.succeed(FinancialVerificationSigner, signer),
    makeFinancialVerificationKeyring([signer]),
  )

export const makeEd25519FinancialVerificationSigner = (
  keyId: string,
  privateKey: CryptoKey,
  publicKey: CryptoKey,
) =>
  makeFinancialVerificationSignerLayer(
    makeEd25519FinancialVerificationSignerService(keyId, privateKey, publicKey),
  )

/**
 * Generates an extractability-disabled local key for tests and development.
 *
 * TODO(financial-prod): production key generation/registration belongs to the selected
 * custody lifecycle, not this helper. This helper must never be used as production custody.
 */
export const generateEd25519FinancialVerificationSigner = (keyId: string) =>
  Effect.tryPromise({
    try: async () => {
      const pair = await globalThis.crypto.subtle.generateKey(
        ed25519,
        false,
        ["sign", "verify"],
      ) as CryptoKeyPair
      const signer = makeEd25519FinancialVerificationSignerService(
        keyId,
        pair.privateKey,
        pair.publicKey,
      )
      return {
        pair,
        signer,
        layer: makeFinancialVerificationSignerLayer(signer),
      }
    },
    catch: () => new FinancialVerificationKeyGenerationFailure({ keyId }),
  })

const digest: Crypto.Crypto["digest"] = (algorithm, data) =>
  Effect.tryPromise({
    try: async () =>
      new Uint8Array(await globalThis.crypto.subtle.digest(algorithm, new Uint8Array(data))),
    catch: (cause) =>
      PlatformError.systemError({
        module: "Crypto",
        method: "digest",
        _tag: "Unknown",
        description: "Could not compute digest",
        cause,
      }),
  })

export const WebCryptoLive = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({ randomBytes, digest }),
)
