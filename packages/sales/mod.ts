export { SalesCapabilities } from "./src/capabilities.ts"
export {
  SalesConfirmOrderAction,
  SalesOrderConfirmedEvent,
  SalesOrderConfirmedEventPayload,
  SalesTypedActionCatalog,
  SalesTypedEventCatalog,
} from "./src/catalog.ts"

export {
  CancelOrderInput,
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
  SalesOrderLine,
  SalesOrderNotFound,
  SalesService,
} from "./src/service.ts"
export type {
  Customer as CustomerType,
  Quotation as QuotationType,
  SalesOrder as SalesOrderType,
  SalesOrderLine as SalesOrderLineType,
  SalesService as SalesServiceShape,
} from "./src/service.ts"
