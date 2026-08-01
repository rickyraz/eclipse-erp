import postgres from "npm:postgres@3.4.7"

import { makePostgresDatabase, type PostgresClient } from "../../packages/kernel/mod.ts"

export const makeApiDatabase = (url: string) =>
  makePostgresDatabase(postgres(url) as unknown as PostgresClient)
