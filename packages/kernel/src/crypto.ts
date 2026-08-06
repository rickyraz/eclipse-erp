import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PlatformError from "effect/PlatformError"

const randomBytes = (size: number) => {
  const bytes = new Uint8Array(size)
  for (let offset = 0; offset < bytes.length; offset += 65_536) {
    globalThis.crypto.getRandomValues(bytes.subarray(offset, offset + 65_536))
  }
  return bytes
}

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
