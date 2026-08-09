export { SalesCapabilities } from "./src/capabilities.ts"

export {
  ConfirmOrderInput,
  CreateCustomerInput,
  CreateOrderInput,
  CreateQuotationInput,
  Customer,
  CustomerAlreadyExists,
  CustomerNotFound,
  makeSalesService,
  makeSalesTestLayer,
  Quotation,
  QuotationNotFound,
  SalesOrder,
  SalesOrderConfirmationIdempotencyConflict,
  SalesOrderInvalidState,
  SalesOrderNotFound,
  SalesService,
} from "./src/service.ts"
export type {
  Customer as CustomerType,
  Quotation as QuotationType,
  SalesOrder as SalesOrderType,
  SalesService as SalesServiceShape,
} from "./src/service.ts"
