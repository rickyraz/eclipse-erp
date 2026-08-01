import * as Effect from "effect/Effect"

import { IdentityAlreadyExists, IdentityService, makeIdentityTestLayer } from "../mod.ts"

const layer = makeIdentityTestLayer()

const run = <A>(program: Effect.Effect<A, unknown, IdentityService>) =>
  Effect.runPromise(Effect.provide(program, layer))

Deno.test("identity contract creates a normalized identity", async () => {
  const identity = await run(
    IdentityService.use((service) => service.create({ email: "  USER@Example.COM " })),
  )

  if (identity.email !== "user@example.com") throw new Error("email was not normalized")
  if (identity.id !== "1") throw new Error("test layer did not return a stable id")
})

Deno.test("identity contract rejects duplicate email", async () => {
  const email = `duplicate-${crypto.randomUUID()}@example.com`
  await run(IdentityService.use((service) => service.create({ email })))

  try {
    await run(IdentityService.use((service) => service.create({ email })))
    throw new Error("expected duplicate identity failure")
  } catch (error) {
    if (!(error instanceof IdentityAlreadyExists)) throw error
  }
})

Deno.test("identity contract rejects invalid input", async () => {
  try {
    await run(IdentityService.use((service) => service.create({ email: 42 })))
    throw new Error("expected schema failure")
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("email")) throw error
  }
})
