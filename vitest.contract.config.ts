import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: [
      "packages/**/tests/**/*.test.{ts,tsx}",
      "tests/architecture/**/*.test.{ts,tsx}",
    ],
    setupFiles: ["./tooling/load-env.ts"],
    exclude: ["vendor/**", "node_modules/**"],
  },
})
