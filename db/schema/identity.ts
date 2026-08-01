import { pgSchema, text, unique } from "drizzle-orm/pg-core"

import { createdAt, id, updatedAt } from "./common.ts"

export const identitySchema = pgSchema("identity")

export const identities = identitySchema.table(
  "identities",
  {
    id: id(),
    email: text("email").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [unique("identities_email_key").on(table.email)],
)
