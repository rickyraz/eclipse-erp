export {
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
  SalesService,
} from "./src/service.ts"
export type {
  Customer as CustomerType,
  Quotation as QuotationType,
  SalesOrder as SalesOrderType,
  SalesService as SalesServiceShape,
} from "./src/service.ts"
