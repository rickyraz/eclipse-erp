const ownershipFile = "db/ownership.toml"

const parseOwnership = (content: string) => {
  const schemas = new Map<string, string>()
  let inSchemas = false

  for (const [index, rawLine] of content.split("\n").entries()) {
    const line = rawLine.trim()
    if (line === "[schemas]") {
      inSchemas = true
      continue
    }
    if (line.startsWith("[") && line !== "[schemas]") inSchemas = false
    if (!inSchemas || line === "" || line.startsWith("#")) continue

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]+)"$/)
    if (!match) throw new Error(`${ownershipFile}:${index + 1}: invalid schema ownership entry`)

    const [, schema, owner] = match
    if (schemas.has(schema)) throw new Error(`duplicate schema owner: ${schema}`)
    schemas.set(schema, owner)
  }

  if (schemas.size === 0) throw new Error(`${ownershipFile}: no schemas registered`)
  return schemas
}

export const checkOwnership = async (): Promise<readonly string[]> => {
  const schemas = parseOwnership(await Deno.readTextFile(ownershipFile))
  const failures: string[] = []
  const owners = new Set<string>()

  for (const [schema, owner] of schemas) {
    if (owners.has(owner)) failures.push(`multiple schemas use owner ${owner}`)
    owners.add(owner)

    try {
      const info = await Deno.stat(owner)
      if (!info.isDirectory) failures.push(`${schema}: owner is not a directory: ${owner}`)
      await Deno.stat(`${owner}/mod.ts`)
    } catch {
      failures.push(`${schema}: owner must contain a public mod.ts: ${owner}`)
    }
  }

  async function checkMigrations(directory: string): Promise<void> {
    for await (const entry of Deno.readDir(directory)) {
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory) {
        await checkMigrations(path)
        continue
      }
      if (!entry.isFile || !entry.name.endsWith(".sql")) continue

      const sql = await Deno.readTextFile(path)
      const owner = sql.match(/^\s*--\s*owner:\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/m)?.[1]
      if (!owner) {
        failures.push(`${path}: SQL migrations require a -- owner: <schema> header`)
      } else if (!schemas.has(owner)) {
        failures.push(`${path}: unknown schema owner ${owner}`)
      }
    }
  }

  await checkMigrations("db/migrations")
  return failures
}

if (import.meta.main) {
  const failures = await checkOwnership()
  if (failures.length > 0) {
    console.error(failures.join("\n"))
    Deno.exit(1)
  }
  console.log("schema ownership valid")
}
