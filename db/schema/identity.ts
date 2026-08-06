import { pgSchema, text, unique } from "drizzle-orm/pg-core"

import { createdAt, id, updatedAt } from "./common.ts"

export const identitySchema = pgSchema("identity")

export const userAccounts = identitySchema.table(
  "user_accounts",
  {
    id: id(),
    email: text("email").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [unique("user_accounts_email_key").on(table.email)],
)
