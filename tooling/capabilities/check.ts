import {
  CapabilityDefinitions,
  CapabilityIds,
  isCapabilityIdShape,
  isKnownCapability,
} from "../../packages/authorization/mod.ts"

const ownerDeclarations = [
  ["authorization", "packages/authorization/src/capabilities.ts"],
  ["identity", "packages/identity/src/capabilities.ts"],
  ["party", "packages/party/src/capabilities.ts"],
  ["sales", "packages/sales/src/capabilities.ts"],
  ["inventory", "packages/inventory/src/capabilities.ts"],
  ["accounting", "packages/accounting/src/capabilities.ts"],
  ["process", "packages/process/src/capabilities.ts"],
] as const

const sourceRoots = ["apps", "packages", "tests"] as const
const directCapabilityPattern = /capability\s*:\s*["']([^"']+)["']/g
const ownerObjectPattern = /export const \w+Capabilities = \{([\s\S]*?)\} as const/g
const ownerDeclarationPattern = /:\s*["']([^"']+)["']/g

const readTypeScriptFiles = async (root: string): Promise<string[]> => {
  const files: string[] = []
  for await (const entry of Deno.readDir(root)) {
    const path = `${root}/${entry.name}`
    if (entry.isDirectory) {
      files.push(...await readTypeScriptFiles(path))
    } else if (entry.isFile && path.endsWith(".ts")) {
      files.push(path)
    }
  }
  return files
}

const failures: string[] = []
const catalogIds = new Set<string>(CapabilityIds)
const definitionIds = new Set(CapabilityDefinitions.map((definition) => definition.id))

if (catalogIds.size !== CapabilityIds.length) {
  failures.push("CapabilityIds contains duplicate identifiers")
}
if (definitionIds.size !== CapabilityDefinitions.length) {
  failures.push("CapabilityDefinitions contains duplicate identifiers")
}

for (const id of CapabilityIds) {
  if (!isCapabilityIdShape(id)) failures.push(`invalid capability shape: ${id}`)
  if (!definitionIds.has(id)) failures.push(`missing capability definition: ${id}`)
}

for (const definition of CapabilityDefinitions) {
  const segments = definition.id.split(".")
  const resource = segments.length === 2 ? segments[0] : segments[1]
  const verb = segments.at(-1)
  if (definition.owner !== segments[0]) {
    failures.push(`owner mismatch: ${definition.id} -> ${definition.owner}`)
  }
  if (definition.resource !== resource || definition.verb !== verb) {
    failures.push(`metadata mismatch: ${definition.id}`)
  }
}

for (const [owner, path] of ownerDeclarations) {
  const source = await Deno.readTextFile(path)
  const declared = [...source.matchAll(ownerObjectPattern)].flatMap((object) =>
    [...object[1]!.matchAll(ownerDeclarationPattern)].map((match) => match[1]!)
  )
  for (const id of declared) {
    if (!catalogIds.has(id)) failures.push(`${path} declares unknown capability: ${id}`)
    if (!id.startsWith(`${owner}.`)) failures.push(`${path} declares foreign capability: ${id}`)
  }
}

const declaredByOwner = new Set<string>()
for (const [, path] of ownerDeclarations) {
  const source = await Deno.readTextFile(path)
  for (const object of source.matchAll(ownerObjectPattern)) {
    for (const match of object[1]!.matchAll(ownerDeclarationPattern)) declaredByOwner.add(match[1]!)
  }
}
for (const id of CapabilityIds) {
  if (!declaredByOwner.has(id)) failures.push(`capability has no owner declaration: ${id}`)
}

for (const root of sourceRoots) {
  for (const path of await readTypeScriptFiles(root)) {
    const source = await Deno.readTextFile(path)
    for (const match of source.matchAll(directCapabilityPattern)) {
      const value = match[1]!
      if (!isKnownCapability(value)) {
        failures.push(`${path} uses non-canonical capability: ${value}`)
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"))
  Deno.exit(1)
}

console.log(`Capability catalog valid: ${CapabilityIds.length} identifiers`)
