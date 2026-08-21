import { assert, it } from "@effect/vitest"

import { ApiConflict, ApiForbidden, ApiNotFound, ApiServiceUnavailable } from "./api.ts"
import { toCoreApiError } from "./handlers.ts"

it("maps closed-world core failures to stable HTTP errors", () => {
  const forbidden = toCoreApiError({ _tag: "AuthorizationDenied" })
  assert.instanceOf(forbidden, ApiForbidden)

  const notFound = toCoreApiError({ _tag: "SalesOrderNotFound" })
  assert.instanceOf(notFound, ApiNotFound)
  assert.strictEqual(notFound.code, "SalesOrderNotFound")

  const conflict = toCoreApiError({ _tag: "StockUnavailable" })
  assert.instanceOf(conflict, ApiConflict)
  assert.strictEqual(conflict.code, "StockUnavailable")

  const invalidRequest = toCoreApiError({ _tag: "SchemaError" })
  assert.instanceOf(invalidRequest, ApiConflict)
  assert.strictEqual(invalidRequest.code, "invalid_request")

  const unavailable = toCoreApiError({ _tag: "DatabaseFailure" })
  assert.instanceOf(unavailable, ApiServiceUnavailable)
})
