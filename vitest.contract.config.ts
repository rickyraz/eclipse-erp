import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: [
      "packages/**/tests/**/*.test.{ts,tsx}",
      "tests/architecture/**/*.test.{ts,tsx}",
    ],
    setupFiles: ["./tooling/load-env.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    exclude: ["vendor/**", "node_modules/**"],
  },
})
