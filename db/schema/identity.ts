import { pgSchema, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"

export const identitySchema = pgSchema("identity")

export const identities = identitySchema.table(
  "identities",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("identities_email_key").on(table.email)],
)
