import { assert, it } from "@effect/vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import * as Effect from "effect/Effect"

import { identities } from "../../../db/schema/identity.ts"
import { quotations } from "../../../db/schema/sales.ts"

it.effect("applies the shared Drizzle schema primitives", () =>
  Effect.sync(() => {
    const identity = getTableConfig(identities)
    const quotation = getTableConfig(quotations)

    assert.strictEqual(identity.schema, "identity")
    assert.deepStrictEqual(
      identity.columns.map((column) => column.name),
      ["id", "email", "created_at", "updated_at"],
    )
    assert.strictEqual(identity.columns[0]?.getSQLType(), "uuid")
    assert.strictEqual(
      quotation.columns.find((column) => column.name === "total")?.getSQLType(),
      "numeric(14, 2)",
    )
    assert.deepStrictEqual(
      identity.uniqueConstraints.map((constraint) => constraint.name),
      ["identities_email_key"],
    )
  }))
