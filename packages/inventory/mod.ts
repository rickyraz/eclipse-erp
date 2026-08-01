export {
  CreateItemInput,
  CreateWarehouseInput,
  InventoryReferenceNotFound,
  InventoryService,
  Item,
  ItemAlreadyExists,
  makeInventoryService,
  makeInventoryTestLayer,
  ReceiveStockInput,
  ReserveStockInput,
  StockBalance,
  StockReservation,
  StockUnavailable,
  Warehouse,
  WarehouseAlreadyExists,
} from "./src/service.ts"
export type {
  InventoryService as InventoryServiceShape,
  Item as ItemType,
  StockBalance as StockBalanceType,
  StockReservation as StockReservationType,
  Warehouse as WarehouseType,
} from "./src/service.ts"
