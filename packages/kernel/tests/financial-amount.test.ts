import { assert, describe, it } from "@effect/vitest"
import * as Schema from "effect/Schema"

import {
  FINANCIAL_LEDGER_MAX_MINOR,
  FINANCIAL_MAJOR_MAX,
  FinancialMajorAmount,
  majorToMinor,
  minorToMajor,
} from "../mod.ts"

describe("exact financial amount boundary", () => {
  it("represents the 500 trillion target without a JavaScript number", () => {
    const minor = majorToMinor("500000000000000.00", 2)
    assert.deepStrictEqual(minor, { ok: true, value: "50000000000000000" })
    assert.deepStrictEqual(minorToMajor("50000000000000000", 2), {
      ok: true,
      value: "500000000000000.00",
    })
  })

  it("supports caller-supplied zero, two, and three digit exponents exactly", () => {
    assert.deepStrictEqual(majorToMinor("42", 0), { ok: true, value: "42" })
    assert.deepStrictEqual(minorToMajor("42", 0), { ok: true, value: "42" })
    assert.deepStrictEqual(majorToMinor("12.34", 2), { ok: true, value: "1234" })
    assert.deepStrictEqual(minorToMajor("1234", 2), { ok: true, value: "12.34" })
    assert.deepStrictEqual(majorToMinor("12.345", 3), { ok: true, value: "12345" })
    assert.deepStrictEqual(minorToMajor("12345", 3), { ok: true, value: "12.345" })
  })

  it("rejects rounding, malformed amounts, and U128 overflow", () => {
    assert.deepStrictEqual(majorToMinor("1.001", 2), {
      ok: false,
      reason: "fractional_precision",
    })
    assert.deepStrictEqual(majorToMinor("1e2", 2), {
      ok: false,
      reason: "invalid_format",
    })
    assert.deepStrictEqual(minorToMajor((FINANCIAL_LEDGER_MAX_MINOR + 1n).toString(), 2), {
      ok: false,
      reason: "overflow",
    })
    assert.deepStrictEqual(majorToMinor((FINANCIAL_LEDGER_MAX_MINOR + 1n).toString(), 0), {
      ok: false,
      reason: "overflow",
    })
  })

  it("accepts the supported major boundary and rejects the old 12-digit boundary", () => {
    assert.isTrue(Schema.is(FinancialMajorAmount)(FINANCIAL_MAJOR_MAX))
    assert.isTrue(Schema.is(FinancialMajorAmount)("500000000000000.00"))
    assert.isFalse(Schema.is(FinancialMajorAmount)("1000000000000000000.00"))
    assert.isFalse(Schema.is(FinancialMajorAmount)("100000000000000000000.00"))
  })
})
