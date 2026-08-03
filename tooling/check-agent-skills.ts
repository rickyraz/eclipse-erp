import { dirname, relative, resolve } from "@std/path"

const requiredHeadings = [
  "# Purpose",
  "# Use This Skill When",
  "# Do Not Use This Skill When",
  "# Required Context",
  "# Architecture Rules",
  "# Workflow",
  "# Deterministic Tools",
  "# Required Checks",
  "# Failure Conditions",
  "# Completion Criteria",
  "# Related Skills",
  "# References",
] as const

const unquote = (value: string) => {
  const trimmed = value.trim()
  return trimmed.length >= 2 &&
      ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ? trimmed.slice(1, -1)
    : trimmed
}

export const validateSkillDocument = (
  path: string,
  content: string,
  external: boolean,
): readonly string[] => {
  const failures: string[] = []
  const lines = content.split("\n")
  const frontmatterEnd = lines.slice(1).findIndex((line) => line.trim() === "---") + 1

  if (lines[0]?.trim() !== "---" || frontmatterEnd <= 0) {
    return [`${path}: missing YAML frontmatter`]
  }

  const frontmatter = lines.slice(1, frontmatterEnd)
  const name = frontmatter.find((line) => line.startsWith("name:"))?.slice("name:".length)
  const description = frontmatter.find((line) => line.startsWith("description:"))
    ?.slice("description:".length)
  const directoryName = normalizePath(dirname(path)).split("/").at(-1)

  if (name === undefined || unquote(name) !== directoryName) {
    failures.push(`${path}: frontmatter name must match directory ${directoryName}`)
  }
  if (description === undefined || unquote(description).trim().length < 40) {
    failures.push(`${path}: description must contain high-signal discovery context`)
  }
  if (/\/home\/|[A-Za-z]:\\/.test(content)) {
    failures.push(`${path}: use repository-relative references, not machine-specific paths`)
  }

  if (!external) {
    for (const heading of requiredHeadings) {
      if (!lines.includes(heading)) failures.push(`${path}: missing required heading ${heading}`)
    }
  }

  return failures
}

const normalizePath = (path: string) => path.replaceAll("\\", "/")

const collectSkillFiles = async (directory: string): Promise<readonly string[]> => {
  const files: string[] = []
  const visit = async (path: string) => {
    for await (const entry of Deno.readDir(path)) {
      const child = `${path}/${entry.name}`
      if (entry.isDirectory) await visit(child)
      else if (entry.isFile && entry.name === "SKILL.md") files.push(child)
    }
  }
  await visit(directory)
  return files.toSorted()
}

const validateLinks = async (path: string, content: string): Promise<readonly string[]> => {
  const failures: string[] = []
  const repositoryRoot = resolve(Deno.cwd())

  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const rawTarget = match[1]!.trim().replace(/^<|>$/g, "")
    if (/^(?:https?:|mailto:|#)/.test(rawTarget)) continue
    const target = decodeURIComponent(rawTarget.split("#", 1)[0]!.split("?", 1)[0]!)
    if (target === "") continue

    const resolved = resolve(dirname(path), target)
    if (relative(repositoryRoot, resolved).startsWith("..")) {
      failures.push(`${path}: link escapes the repository: ${rawTarget}`)
      continue
    }
    try {
      await Deno.stat(resolved)
    } catch (cause) {
      if (cause instanceof Deno.errors.NotFound) {
        failures.push(`${path}: broken relative link ${rawTarget}`)
      } else throw cause
    }
  }

  return failures
}

export const checkAgentSkills = async (): Promise<readonly string[]> => {
  const lock = JSON.parse(await Deno.readTextFile("skills-lock.json")) as {
    readonly skills?: Readonly<Record<string, unknown>>
  }
  const externalSkills = new Set(Object.keys(lock.skills ?? {}))
  const skillFiles = await collectSkillFiles(".agents/skills")
  const failures: string[] = []
  let repositoryNativeCount = 0

  for (const path of skillFiles) {
    const content = await Deno.readTextFile(path)
    const name = normalizePath(dirname(path)).split("/").at(-1)!
    const external = externalSkills.has(name)
    if (!external) repositoryNativeCount++
    failures.push(...validateSkillDocument(path, content, external))
    failures.push(...await validateLinks(path, content))
  }

  if (repositoryNativeCount === 0) failures.push("no repository-native skills found")
  return failures.toSorted()
}

if (import.meta.main) {
  const failures = await checkAgentSkills()
  if (failures.length > 0) {
    console.error(failures.join("\n"))
    Deno.exit(1)
  }
  console.log("agent skills valid")
}
