import { sql } from "drizzle-orm"
import { customType, numeric, timestamp } from "drizzle-orm/pg-core"

export const uuidv7 = customType<{ data: string; notNull: true; default: true }>({
  dataType() {
    return "uuid"
  },
})

export const id = () => uuidv7("id").default(sql`uuidv7()`).primaryKey()
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
export const money = (name: string) => numeric(name, { precision: 14, scale: 2 }).notNull()
