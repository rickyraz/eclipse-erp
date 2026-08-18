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

export interface FinancialVerificationVerifierService {
  readonly algorithm: "Ed25519"
  readonly keyId: string
  readonly verify: (payload: string, signature: string) => Promise<boolean>
}

export interface FinancialVerificationSignerService extends FinancialVerificationVerifierService {
  readonly sign: (payload: string) => Promise<string>
}

export class FinancialVerificationKeyNotFound
  extends Schema.TaggedErrorClass<FinancialVerificationKeyNotFound>()(
    "FinancialVerificationKeyNotFound",
    { keyId: Schema.String },
  ) {}

export interface FinancialVerificationKeyringService {
  readonly verify: (
    keyId: string,
    payload: string,
    signature: string,
  ) => Effect.Effect<boolean, FinancialVerificationKeyNotFound>
}

export const FinancialVerificationSigner = Context.Service<FinancialVerificationSignerService>(
  "RITSEI/FinancialVerificationSigner",
)

export const FinancialVerificationKeyring = Context.Service<FinancialVerificationKeyringService>(
  "RITSEI/FinancialVerificationKeyring",
)

const ed25519 = { name: "Ed25519" } as AlgorithmIdentifier
const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
const fromBase64Url = (value: string) => {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "==="
  const binary = atob(padded.slice(0, padded.length - (padded.length % 4)))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

const makeEd25519FinancialVerificationSignerService = (
  keyId: string,
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): FinancialVerificationSignerService => ({
  algorithm: "Ed25519",
  keyId,
  sign: async (payload: string) =>
    base64Url(
      new Uint8Array(
        await globalThis.crypto.subtle.sign(
          ed25519,
          privateKey,
          new TextEncoder().encode(payload),
        ),
      ),
    ),
  verify: async (payload: string, signature: string) => {
    try {
      return await globalThis.crypto.subtle.verify(
        ed25519,
        publicKey,
        fromBase64Url(signature),
        new TextEncoder().encode(payload),
      )
    } catch {
      return false
    }
  },
})

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
      return Effect.tryPromise({
        try: () => verifier.verify(payload, signature),
        catch: () => false,
      }).pipe(Effect.catch(() => Effect.succeed(false)))
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

export const generateEd25519FinancialVerificationSigner = (keyId: string) =>
  Effect.promise(async () => {
    const pair = await globalThis.crypto.subtle.generateKey(
      ed25519,
      true,
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
