import { sql } from "drizzle-orm"
import { check, pgSchema, text, timestamp, unique } from "drizzle-orm/pg-core"

import { createdAt, id, updatedAt } from "./common.ts"

export const identitySchema = pgSchema("identity")

export const userAccounts = identitySchema.table(
  "user_accounts",
  {
    id: id(),
    email: text("email").notNull(),
    status: text("status").notNull().default("active"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    sessionInvalidatedAt: timestamp("session_invalidated_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("user_accounts_email_key").on(table.email),
    check("user_accounts_status_check", sql`${table.status} in ('active', 'disabled')`),
  ],
)
