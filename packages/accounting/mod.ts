export { AccountingCapabilities } from "./src/capabilities.ts"

export {
  Account,
  AccountAlreadyExists,
  AccountingConfiguration,
  AccountingConfigurationAlreadyExists,
  AccountingLegalEntityNotFound,
  AccountingService,
  AccountNotFound,
  ConfigureLegalEntityInput,
  CreateAccountInput,
  InvalidJournalLine,
  JournalEntry,
  JournalIdempotencyConflict,
  JournalLine,
  JournalReferenceAlreadyExists,
  makeAccountingService,
  makeAccountingTestLayer,
  PostJournalInput,
  UnbalancedJournal,
} from "./src/service.ts"
export type {
  Account as AccountType,
  AccountingConfiguration as AccountingConfigurationType,
  AccountingService as AccountingServiceShape,
  JournalEntry as JournalEntryType,
  JournalLine as JournalLineType,
} from "./src/service.ts"
