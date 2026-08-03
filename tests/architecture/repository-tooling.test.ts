import { assert, describe, it } from "@effect/vitest"

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
description: "Use when an EclipseERP change needs a repository-native example workflow."
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
})
