import "../../tooling/load-env.ts"
import * as Effect from "effect/Effect"
import postgres from "postgres"

import { runMigrations } from "../../packages/kernel/mod.ts"

export const migrate = (url: string) => {
  const client = postgres(url)
  return Effect.acquireUseRelease(
    Effect.succeed(client),
    (connection) => runMigrations(connection),
    (connection) => Effect.promise(() => connection.end()),
  )
}

if (import.meta.main) {
  const url = Deno.env.get("DATABASE_URL")
  if (url === undefined || url.trim() === "") {
    console.error("DATABASE_URL is required")
    Deno.exit(1)
  }

  const result = await Effect.runPromiseExit(migrate(url))
  if (result._tag === "Failure") {
    console.error(result.cause)
    Deno.exit(1)
  }

  console.log("Database migrations are up to date")
}
