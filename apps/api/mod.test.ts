import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as OpenApi from "effect/unstable/httpapi/OpenApi"

import { EclipseApi } from "./api.ts"

it.effect("derives routing and OpenAPI from the Effect HttpApi contract", () =>
  Effect.sync(() => {
    const specification = OpenApi.fromApi(EclipseApi)

    assert.strictEqual(specification.info.title, "EclipseERP API")
    assert.ok(specification.paths["/health"]?.get)
    assert.ok(specification.paths["/identities"]?.post)
    assert.ok(specification.paths["/sales/orders"]?.post)
    assert.ok(specification.paths["/inventory/reservations"]?.post)
    assert.ok(specification.paths["/accounting/journals"]?.post)
    assert.ok(specification.components.securitySchemes.bearer)
  }))
