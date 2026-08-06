import { assert, it } from "@effect/vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import * as Effect from "effect/Effect"

import { userAccounts } from "../../../db/schema/identity.ts"
import { quotations } from "../../../db/schema/sales.ts"

it.effect("applies the shared Drizzle schema primitives", () =>
  Effect.sync(() => {
    const userAccount = getTableConfig(userAccounts)
    const quotation = getTableConfig(quotations)

    assert.strictEqual(userAccount.schema, "identity")
    assert.deepStrictEqual(
      userAccount.columns.map((column) => column.name),
      ["id", "email", "created_at", "updated_at"],
    )
    assert.strictEqual(userAccount.columns[0]?.getSQLType(), "uuid")
    assert.strictEqual(
      quotation.columns.find((column) => column.name === "total")?.getSQLType(),
      "numeric(14, 2)",
    )
    assert.deepStrictEqual(
      userAccount.uniqueConstraints.map((constraint) => constraint.name),
      ["user_accounts_email_key"],
    )
  }))
