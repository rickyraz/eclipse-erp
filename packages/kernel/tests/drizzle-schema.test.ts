import { assert, it } from "@effect/vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import * as Effect from "effect/Effect"

import { identities } from "../../../db/schema/identity.ts"

it.effect("declares the identity table in its owned PostgreSQL schema", () =>
  Effect.sync(() => {
    const config = getTableConfig(identities)

    assert.strictEqual(config.schema, "identity")
    assert.strictEqual(config.name, "identities")
    assert.deepStrictEqual(
      config.columns.map((column) => column.name),
      ["id", "email", "created_at"],
    )
    assert.deepStrictEqual(
      config.uniqueConstraints.map((constraint) => constraint.name),
      ["identities_email_key"],
    )
  }))
