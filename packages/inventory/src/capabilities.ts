export const InventoryCapabilities = {
  warehouseCreate: "inventory.warehouse.create",
  itemCreate: "inventory.item.create",
  stockReceive: "inventory.stock.receive",
  stockAdjust: "inventory.stock.adjust",
  stockReserve: "inventory.stock.reserve",
  stockRelease: "inventory.stock.release",
  stockFulfill: "inventory.stock.fulfill",
  stockTransferCreate: "inventory.stock_transfer.create",
  stockTransferConfirm: "inventory.stock_transfer.confirm",
  stockTransferComplete: "inventory.stock_transfer.complete",
} as const
