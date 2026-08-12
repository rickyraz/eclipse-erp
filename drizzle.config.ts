import "./tooling/load-env.ts"
import { defineConfig } from "drizzle-kit"
import process from "node:process"

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL in .env / .env.local")
}

export default defineConfig({
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
  migrations: {
    schema: "system",
    table: "schema_migrations",
  },
  schemaFilter: [
    "identity",
    "party",
    "auth",
    "authorization",
    "sales",
    "inventory",
    "accounting",
    "process",
    "messaging",
  ],
  breakpoints: true,
  strict: true,
  verbose: true,
})
