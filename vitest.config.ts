import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: [
      "apps/**/*.test.{ts,tsx}",
      "packages/**/*.test.{ts,tsx}",
      "tests/**/*.test.{ts,tsx}",
    ],
    exclude: ["vendor/**", "node_modules/**"],
  },
})
