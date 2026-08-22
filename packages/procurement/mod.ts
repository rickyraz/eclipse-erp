export { ProcurementCapabilities } from "./src/capabilities.ts"

export {
  CreatePurchaseOrderInput,
  CreateSupplierAccountInput,
  makeProcurementService,
  makeProcurementTestLayer,
  ProcurementService,
  PurchaseOrder,
  PurchaseOrderLine,
  SupplierAccount,
  SupplierAccountAlreadyExists,
  SupplierAccountNotFound,
  SupplierRelationshipNotEligible,
} from "./src/service.ts"
export type {
  ProcurementService as ProcurementServiceShape,
  PurchaseOrder as PurchaseOrderType,
  PurchaseOrderLine as PurchaseOrderLineType,
  SupplierAccount as SupplierAccountType,
} from "./src/service.ts"
