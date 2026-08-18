export interface SourceFile {
  readonly path: string
  readonly source: string
}

const normalizePath = (path: string) => path.replaceAll("\\", "/")

export const extractModuleSpecifiers = (source: string): readonly string[] => {
  const specifiers = new Set<string>()
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/gs,
    /\bexport\s+(?:type\s+)?(?:\*|\{[\s\S]*?\})\s+from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]!)
  }
  return [...specifiers]
}

const canonicalCycle = (cycle: readonly string[]) => {
  const nodes = cycle.slice(0, -1)
  const rotations = nodes.map((_, index) => [...nodes.slice(index), ...nodes.slice(0, index)])
  return rotations.map((rotation) => rotation.join(" -> ")).toSorted()[0]!
}

export const analyzePackageDependencies = (
  files: readonly SourceFile[],
  packageNames: readonly string[],
): readonly string[] => {
  const packages = new Set(packageNames)
  const graph = new Map(packageNames.map((name) => [name, new Set<string>()]))
  const edges = new Map<string, string>()
  const failures: string[] = []

  for (const file of files) {
    const path = normalizePath(file.path)
    const containingPackage = path.match(/^packages\/([^/]+)\//)?.[1]
    const sourcePackage = path.match(/^packages\/([^/]+)\/(?:mod\.tsx?|src\/)/)?.[1]

    for (const specifier of extractModuleSpecifiers(file.source)) {
      let targetPackage: string | undefined
      let targetPath: string | undefined
      const alias = specifier.match(/^@ritsei\/([^/]+)(?:\/(.+))?$/)

      if (alias !== null) {
        targetPackage = alias[1]
        targetPath = alias[2]
      } else if (specifier.startsWith(".")) {
        const resolved = decodeURIComponent(
          new URL(specifier, `file:///${path}`).pathname.slice(1),
        )
        const target = resolved.match(/^packages\/([^/]+)\/(.+)$/)
        if (target !== null) {
          targetPackage = target[1]
          targetPath = target[2]
        }
      }

      if (targetPackage === undefined) continue
      if (!packages.has(targetPackage)) {
        failures.push(`${path}: import references unknown package ${targetPackage}`)
        continue
      }
      if (containingPackage === targetPackage) continue
      if (targetPath !== undefined && targetPath !== "mod.ts") {
        failures.push(
          `${path}: cross-package import ${
            JSON.stringify(specifier)
          } must use packages/${targetPackage}/mod.ts`,
        )
      }
      if (sourcePackage === undefined) continue

      graph.get(sourcePackage)?.add(targetPackage)
      edges.set(
        `${sourcePackage}\0${targetPackage}`,
        `${path} imports ${JSON.stringify(specifier)}`,
      )
    }
  }

  const state = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  const cycles = new Map<string, readonly string[]>()

  const visit = (name: string) => {
    state.set(name, 1)
    stack.push(name)
    for (const target of [...(graph.get(name) ?? [])].toSorted()) {
      if ((state.get(target) ?? 0) === 0) visit(target)
      else if (state.get(target) === 1) {
        const cycle = [...stack.slice(stack.indexOf(target)), target]
        cycles.set(canonicalCycle(cycle), cycle)
      }
    }
    stack.pop()
    state.set(name, 2)
  }

  for (const name of packageNames.toSorted()) {
    if ((state.get(name) ?? 0) === 0) visit(name)
  }

  for (const cycle of [...cycles.values()].toSorted((a, b) => a.join().localeCompare(b.join()))) {
    const details = cycle.slice(0, -1).map((source, index) => {
      const target = cycle[index + 1]!
      return `  ${source} -> ${target}: ${edges.get(`${source}\0${target}`) ?? "unknown import"}`
    })
    failures.push(`package dependency cycle: ${cycle.join(" -> ")}\n${details.join("\n")}`)
  }

  return failures.toSorted()
}

const collectSourceFiles = async (directory: string): Promise<readonly SourceFile[]> => {
  const files: SourceFile[] = []

  const visit = async (path: string) => {
    for await (const entry of Deno.readDir(path)) {
      const child = `${path}/${entry.name}`
      if (entry.isDirectory) await visit(child)
      else if (entry.isFile && /\.tsx?$/.test(entry.name)) {
        files.push({ path: child, source: await Deno.readTextFile(child) })
      }
    }
  }

  try {
    await visit(directory)
  } catch (cause) {
    if (!(cause instanceof Deno.errors.NotFound)) throw cause
  }
  return files
}

export const checkPackageDependencies = async (): Promise<readonly string[]> => {
  const packageNames: string[] = []
  for await (const entry of Deno.readDir("packages")) {
    if (!entry.isDirectory) continue
    try {
      if ((await Deno.stat(`packages/${entry.name}/mod.ts`)).isFile) packageNames.push(entry.name)
    } catch (cause) {
      if (!(cause instanceof Deno.errors.NotFound)) throw cause
    }
  }

  const files = (await Promise.all(
    ["apps", "packages", "tests", "tooling"].map(collectSourceFiles),
  )).flat()
  return analyzePackageDependencies(files, packageNames)
}

if (import.meta.main) {
  const failures = await checkPackageDependencies()
  if (failures.length > 0) {
    console.error(failures.join("\n"))
    Deno.exit(1)
  }
  console.log("package dependencies valid")
}
