import { assert, describe, it } from "@effect/vitest"

import {
  buildCallGraph,
  extractExportedNames,
  extractImportedBindings,
} from "../../tooling/call-graph/check.ts"
import { validateSkillDocument } from "../../tooling/check-agent-skills.ts"
import { analyzePackageDependencies } from "../../tooling/dependency-graph/check.ts"

const skillHeadings = [
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
]

const validSkill = `---
name: example-workflow
description: "Use when an RITSEI change needs a repository-native example workflow."
---

${skillHeadings.join("\n\n")}
`

describe("repository tooling", () => {
  it("validates repository-native skill structure", () => {
    assert.deepStrictEqual(
      validateSkillDocument(
        ".agents/skills/example-workflow/SKILL.md",
        validSkill,
        false,
      ),
      [],
    )
    assert.isTrue(
      validateSkillDocument(
        ".agents/skills/example-workflow/SKILL.md",
        validSkill.replace("# Completion Criteria\n", ""),
        false,
      ).some((failure) => failure.includes("# Completion Criteria")),
    )
  })

  it("rejects cross-package internals and dependency cycles", () => {
    const failures = analyzePackageDependencies([
      { path: "packages/a/mod.ts", source: 'export { A } from "./src/service.ts"' },
      {
        path: "packages/a/src/service.ts",
        source: 'import { B } from "../../b/src/service.ts"',
      },
      { path: "packages/b/mod.ts", source: 'export { B } from "./src/service.ts"' },
      {
        path: "packages/b/src/service.ts",
        source: 'import { A } from "../../a/mod.ts"',
      },
    ], ["a", "b"])

    assert.isTrue(failures.some((failure) => failure.includes("must use packages/b/mod.ts")))
    assert.isTrue(failures.some((failure) => failure.includes("a -> b -> a")))
  })

  it("tracks direct local and public calls", () => {
    const source = `import { publicCall } from "../../b/mod.ts"

export const entry = () => {
  localCall()
  publicCall()
}

const localCall = () => undefined
`
    const imported = extractImportedBindings(source)
    assert.deepStrictEqual(imported.map(({ local, imported: name }) => ({ local, name })), [
      { local: "publicCall", name: "publicCall" },
    ])
    assert.deepStrictEqual(
      extractExportedNames('export { publicCall } from "./service.ts"').names,
      new Set(["publicCall"]),
    )

    const result = buildCallGraph(
      [{ path: "packages/a/src/service.ts", source }],
      [{
        path: "packages/a/src/service.ts",
        items: [{
          name: "entry",
          symbolType: "function",
          range: { byteOffset: { start: 0, end: source.length } },
        }, {
          name: "localCall",
          symbolType: "function",
          range: { byteOffset: { start: source.indexOf("const localCall"), end: source.length } },
        }],
      }],
      [{
        file: "packages/a/src/service.ts",
        callee: "localCall",
        range: {
          byteOffset: {
            start: source.indexOf("localCall()"),
            end: source.indexOf("localCall()") + 11,
          },
        },
      }, {
        file: "packages/a/src/service.ts",
        callee: "publicCall",
        range: {
          byteOffset: {
            start: source.indexOf("publicCall()"),
            end: source.indexOf("publicCall()") + 12,
          },
        },
      }],
      new Map([["b", { names: new Set(["publicCall"]), wildcard: false }]]),
    )

    assert.deepStrictEqual(result.failures, [])
    assert.isTrue(
      result.edges.some((edge) => edge.kind === "local" && edge.to.endsWith("#localCall")),
    )
    assert.isTrue(result.edges.some((edge) => edge.kind === "public" && edge.to === "b:publicCall"))
  })

  it("rejects a direct call to a non-public export", () => {
    const source = 'import { privateCall } from "../../b/mod.ts"\nprivateCall()'
    const result = buildCallGraph(
      [{ path: "packages/a/src/service.ts", source }],
      [{ path: "packages/a/src/service.ts", items: [] }],
      [{
        file: "packages/a/src/service.ts",
        callee: "privateCall",
        range: { byteOffset: { start: source.indexOf("privateCall()"), end: source.length } },
      }],
      new Map([["b", { names: new Set(["publicCall"]), wildcard: false }]]),
    )

    assert.isTrue(
      result.failures.some((failure) => failure.includes("non-public export b:privateCall")),
    )
  })
})
