import { AccountingRevenuePostedEvent } from "./events.ts"

export { AccountingRevenuePostedEvent, RevenuePostedEventPayload } from "./events.ts"

export const AccountingTypedActionCatalog = [] as const
export const AccountingTypedEventCatalog = [AccountingRevenuePostedEvent] as const
