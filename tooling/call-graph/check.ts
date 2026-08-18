export interface ByteRange {
  readonly start: number
  readonly end: number
}

export interface SourceFile {
  readonly path: string
  readonly source: string
}

export interface OutlineItem {
  readonly name: string
  readonly symbolType: string
  readonly range: { readonly byteOffset: ByteRange }
}

export interface OutlineFile {
  readonly path: string
  readonly items: readonly OutlineItem[]
}

export interface CallMatch {
  readonly file: string
  readonly callee: string
  readonly range: { readonly byteOffset: ByteRange }
}

export interface PublicExports {
  readonly names: ReadonlySet<string>
  readonly wildcard: boolean
}

export interface CallGraphEdge {
  readonly from: string
  readonly to: string
  readonly kind: "local" | "public"
  readonly file: string
  readonly offset: number
}

export interface CallGraphResult {
  readonly edges: readonly CallGraphEdge[]
  readonly failures: readonly string[]
}

interface ImportBinding {
  readonly local: string
  readonly imported: string
  readonly kind: "named" | "namespace" | "default"
  readonly source: string
  readonly typeOnly: boolean
}

interface ResolvedImport {
  readonly binding: ImportBinding
  readonly packageName: string
}

const sourceRoots = ["apps", "packages", "tests", "tooling"] as const
const simpleName = /^[A-Za-z_$][\w$]*$/
const memberName = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/

const normalizePath = (path: string) => path.replaceAll("\\", "/")

const packageFromSpecifier = (file: string, specifier: string): string | undefined => {
  const alias = specifier.match(/^@ritsei\/([^/]+)$/)
  if (alias !== null) return alias[1]

  if (!specifier.startsWith(".")) return undefined
  const resolved = decodeURIComponent(
    new URL(specifier, `file:///${normalizePath(file)}`).pathname.slice(1),
  )
  return resolved.match(/^packages\/([^/]+)\/mod\.tsx?$/)?.[1]
}

const stripComments = (source: string) =>
  source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/.*$/gm, "")

export const extractExportedNames = (source: string): PublicExports => {
  const names = new Set<string>()
  let wildcard = false
  const clean = stripComments(source)

  for (
    const match of clean.matchAll(/\bexport\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+["'][^"']+["']/g)
  ) {
    for (const rawName of match[1]!.split(",")) {
      const item = rawName.trim().replace(/^type\s+/, "")
      if (item === "") continue
      names.add((item.split(/\s+as\s+/)[1] ?? item).trim())
    }
  }

  for (
    const match of clean.matchAll(
      /\bexport\s+(?:declare\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
    )
  ) {
    names.add(match[1]!)
  }

  wildcard = /\bexport\s+\*\s+from\s+["'][^"']+["']/.test(clean)

  return { names, wildcard }
}

export const extractImportedBindings = (source: string): readonly ImportBinding[] => {
  const bindings: ImportBinding[] = []
  const clean = stripComments(source)
  const pattern = /\bimport\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g

  for (const match of clean.matchAll(pattern)) {
    let clause = match[1]!.trim()
    const sourceSpecifier = match[2]!
    const clauseTypeOnly = clause.startsWith("type ")
    if (clauseTypeOnly) clause = clause.slice("type ".length).trim()

    const named = clause.match(/\{([\s\S]*)\}/)
    if (named !== null) {
      for (const rawName of named[1]!.split(",")) {
        let item = rawName.trim()
        if (item === "") continue
        const typeOnly = clauseTypeOnly || item.startsWith("type ")
        item = item.replace(/^type\s+/, "").trim()
        const [imported, local = importedName(imported)] = item.split(/\s+as\s+/).map((value) =>
          value.trim()
        )
        if (!imported || !local) continue
        bindings.push({ local, imported, kind: "named", source: sourceSpecifier, typeOnly })
      }
    }

    const namespace = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)
    if (namespace !== null) {
      bindings.push({
        local: namespace[1]!,
        imported: "*",
        kind: "namespace",
        source: sourceSpecifier,
        typeOnly: clauseTypeOnly,
      })
    }

    const defaultClause = clause.split(",")[0]!.trim()
    if (
      defaultClause !== "" &&
      simpleName.test(defaultClause) &&
      !defaultClause.startsWith("{") &&
      !defaultClause.startsWith("*")
    ) {
      bindings.push({
        local: defaultClause,
        imported: "default",
        kind: "default",
        source: sourceSpecifier,
        typeOnly: clauseTypeOnly,
      })
    }
  }

  return bindings
}

const importedName = (value: string | undefined) => value?.trim() ?? ""

const enclosingFunction = (
  call: CallMatch,
  outline: OutlineFile | undefined,
): string => {
  const candidates = (outline?.items ?? [])
    .filter((item) => item.symbolType === "function")
    .filter((item) => {
      const range = item.range.byteOffset
      return range.start <= call.range.byteOffset.start && range.end >= call.range.byteOffset.end
    })
    .toSorted((a, b) => {
      const aSize = a.range.byteOffset.end - a.range.byteOffset.start
      const bSize = b.range.byteOffset.end - b.range.byteOffset.start
      return aSize - bSize
    })

  return candidates[0]?.name ?? "<module>"
}

const edgeKey = (edge: CallGraphEdge) => `${edge.from}\0${edge.to}\0${edge.file}\0${edge.offset}`

export const buildCallGraph = (
  sources: readonly SourceFile[],
  outlines: readonly OutlineFile[],
  calls: readonly CallMatch[],
  publicExports: ReadonlyMap<string, PublicExports>,
): CallGraphResult => {
  const sourceByPath = new Map(sources.map((source) => [normalizePath(source.path), source]))
  const outlineByPath = new Map(outlines.map((outline) => [normalizePath(outline.path), outline]))
  const edges = new Map<string, CallGraphEdge>()
  const failures: string[] = []

  for (const call of calls) {
    const file = normalizePath(call.file)
    const source = sourceByPath.get(file)
    if (source === undefined) continue

    const from = `${file}#${enclosingFunction(call, outlineByPath.get(file))}`
    const importedBindings = extractImportedBindings(source.source)
      .map((binding): ResolvedImport | undefined => {
        if (binding.typeOnly) return undefined
        const packageName = packageFromSpecifier(file, binding.source)
        return packageName === undefined ? undefined : { binding, packageName }
      })
      .filter((value): value is ResolvedImport => value !== undefined)

    const localFunctions = new Set(
      (outlineByPath.get(file)?.items ?? [])
        .filter((item) => item.symbolType === "function")
        .map((item) => item.name),
    )

    let target: string | undefined
    let kind: CallGraphEdge["kind"] | undefined
    const direct = importedBindings.find(({ binding }) => binding.local === call.callee)
    const member = call.callee.match(memberName)
    const namespace = member === null
      ? undefined
      : importedBindings.find(({ binding }) =>
        binding.kind === "namespace" && binding.local === member[1]
      )

    if (simpleName.test(call.callee) && localFunctions.has(call.callee)) {
      target = `${file}#${call.callee}`
      kind = "local"
    } else if (direct !== undefined) {
      target = `${direct.packageName}:${direct.binding.imported}`
      kind = "public"
      const exports = publicExports.get(direct.packageName)
      if (exports === undefined) {
        failures.push(`${file}: cannot load public exports for package ${direct.packageName}`)
      } else if (!exports.wildcard && !exports.names.has(direct.binding.imported)) {
        failures.push(
          `${file}: call to non-public export ${direct.packageName}:${direct.binding.imported}`,
        )
      }
    } else if (namespace !== undefined && member !== null) {
      target = `${namespace.packageName}:${member[2]}`
      kind = "public"
      const exports = publicExports.get(namespace.packageName)
      if (exports === undefined) {
        failures.push(`${file}: cannot load public exports for package ${namespace.packageName}`)
      } else if (!exports.wildcard && !exports.names.has(member[2]!)) {
        failures.push(`${file}: call to non-public export ${namespace.packageName}:${member[2]}`)
      }
    }

    if (target === undefined || kind === undefined) continue
    const edge: CallGraphEdge = {
      from,
      to: target,
      kind,
      file,
      offset: call.range.byteOffset.start,
    }
    edges.set(edgeKey(edge), edge)
  }

  return {
    edges: [...edges.values()].toSorted((a, b) =>
      `${a.from}\0${a.to}\0${a.offset}`.localeCompare(`${b.from}\0${b.to}\0${b.offset}`)
    ),
    failures: [...new Set(failures)].toSorted(),
  }
}

const collectSourceFiles = async (directory: string): Promise<SourceFile[]> => {
  const files: SourceFile[] = []
  const visit = async (path: string): Promise<void> => {
    for await (const entry of Deno.readDir(path)) {
      const child = `${path}/${entry.name}`
      if (entry.isDirectory) await visit(child)
      else if (entry.isFile && /\.tsx?$/.test(entry.name)) {
        files.push({ path: normalizePath(child), source: await Deno.readTextFile(child) })
      }
    }
  }
  await visit(directory)
  return files
}

const runAstGrep = async (args: readonly string[]) => {
  const result = await new Deno.Command("ast-grep", {
    args: [...args, "--color=never"],
    stdout: "piped",
    stderr: "piped",
  }).output()
  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr).trim()
    throw new Error(`ast-grep failed: ${stderr}`)
  }
  return new TextDecoder().decode(result.stdout)
}

const parseJsonLines = <T>(output: string): T[] =>
  output.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as T)

const loadPublicExports = async (packages: readonly string[]) => {
  const result = new Map<string, PublicExports>()
  for (const packageName of packages) {
    const path = `packages/${packageName}/mod.ts`
    try {
      result.set(packageName, extractExportedNames(await Deno.readTextFile(path)))
    } catch (cause) {
      if (!(cause instanceof Deno.errors.NotFound)) throw cause
    }
  }
  return result
}

export const checkCallGraph = async (): Promise<CallGraphResult> => {
  const sources = (await Promise.all(sourceRoots.map(collectSourceFiles))).flat()
  const paths = [...sourceRoots]
  const outlineOutput = await runAstGrep([
    "outline",
    ...paths,
    "--json=stream",
    "--items",
    "structure",
    "--view",
    "signatures",
    "--type",
    "function",
  ])
  const [callOutput, serviceAccessOutput] = await Promise.all([
    runAstGrep([
      "run",
      "-l",
      "ts",
      "-p",
      "$F($$$ARGS)",
      ...paths,
      "--json=stream",
    ]),
    runAstGrep([
      "run",
      "-l",
      "ts",
      "-p",
      "yield* $F",
      ...paths,
      "--json=stream",
    ]),
  ])
  const outlines = parseJsonLines<OutlineFile>(outlineOutput)
  const rawCalls = [
    ...parseJsonLines<{
      readonly file: string
      readonly range: { readonly byteOffset: ByteRange }
      readonly metaVariables?: { readonly single?: { readonly F?: { readonly text?: string } } }
    }>(callOutput),
    ...parseJsonLines<{
      readonly file: string
      readonly range: { readonly byteOffset: ByteRange }
      readonly metaVariables?: { readonly single?: { readonly F?: { readonly text?: string } } }
    }>(serviceAccessOutput),
  ]
  const calls: CallMatch[] = rawCalls.flatMap((match) => {
    const callee = match.metaVariables?.single?.F?.text
    return callee !== undefined && (simpleName.test(callee) || memberName.test(callee))
      ? [{ file: match.file, callee, range: match.range }]
      : []
  })
  const packageNames = sources
    .map(({ path }) => path.match(/^packages\/([^/]+)\//)?.[1])
    .filter((name): name is string => name !== undefined)
  return buildCallGraph(
    sources,
    outlines,
    calls,
    await loadPublicExports([...new Set(packageNames)]),
  )
}

if (import.meta.main) {
  const report = await checkCallGraph()
  if (report.failures.length > 0) {
    console.error(report.failures.join("\n"))
    Deno.exit(1)
  }
  const publicEdges = report.edges.filter((edge) => edge.kind === "public").length
  const localEdges = report.edges.length - publicEdges
  console.log(
    `call graph valid: ${report.edges.length} tracked edges (${localEdges} local, ${publicEdges} public)`,
  )
}
