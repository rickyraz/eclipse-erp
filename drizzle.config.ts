import { defineConfig } from "drizzle-kit"
import { existsSync } from "node:fs"
import process from "node:process"

const envFile = existsSync(".env") ? ".env" : existsSync(".env.local") ? ".env.local" : undefined

if (envFile) process.loadEnvFile(envFile)

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
    "auth",
    "authorization",
    "sales",
    "inventory",
    "accounting",
  ],
  breakpoints: true,
  strict: true,
  verbose: true,
})
