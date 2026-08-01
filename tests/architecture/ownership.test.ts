import { checkOwnership } from "../../tooling/boundary-linter/check-ownership.ts"

Deno.test("schema ownership registry is valid", async () => {
  const failures = await checkOwnership()
  if (failures.length > 0) throw new Error(failures.join("\n"))
})
