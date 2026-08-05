import { existsSync } from "node:fs"
import process from "node:process"

const envFile = existsSync(".env.local") ? ".env.local" : existsSync(".env") ? ".env" : undefined

if (envFile) process.loadEnvFile(envFile)
