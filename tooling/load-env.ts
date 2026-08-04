import { existsSync } from "node:fs"
import process from "node:process"

const envFile = existsSync(".env") ? ".env" : existsSync(".env.local") ? ".env.local" : undefined

if (envFile) process.loadEnvFile(envFile)
