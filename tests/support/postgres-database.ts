import * as Effect from "effect/Effect"
import postgres, { type Sql } from "postgres"

export const withTemporaryDatabase = <A, E, R>(
  databaseUrl: string,
  use: (client: Sql) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | unknown, R> => {
  const databaseName = `eclipse_test_${crypto.randomUUID().replaceAll("-", "")}`
  const targetUrl = new URL(databaseUrl)
  targetUrl.pathname = `/${databaseName}`

  return Effect.acquireUseRelease(
    Effect.sync(() => postgres(databaseUrl, { max: 1 })),
    (admin) =>
      Effect.acquireUseRelease(
        Effect.promise(async () => {
          await admin.unsafe(`create database "${databaseName}"`)
          return postgres(targetUrl.toString(), { max: 1 })
        }),
        use,
        (client) => Effect.promise(() => client.end()),
      ).pipe(
        Effect.ensuring(
          Effect.promise(() =>
            admin.unsafe(`drop database if exists "${databaseName}" with (force)`)
          ),
        ),
      ),
    (admin) => Effect.promise(() => admin.end()),
  )
}
