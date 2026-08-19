import * as Schema from "effect/Schema"

/**
 * PostgreSQL keeps one extra precision boundary above this domain boundary.
 * NUMERIC(24, 2) can store up to 22 integer digits; the public ERP amount
 * contract intentionally supports 18 integer digits and two fractional digits.
 */
export const FINANCIAL_MAJOR_MAX = "999999999999999999.99"
export const FINANCIAL_MAJOR_MAX_INTEGER_DIGITS = 18
export const FINANCIAL_MAJOR_SCALE = 2
export const FINANCIAL_LEDGER_MAX_MINOR = (1n << 128n) - 1n

/** Exact, non-negative major-unit amounts used by ERP/API contracts. */
export const FinancialMajorAmount = Schema.String.check(
  Schema.isPattern(/^\d{1,18}(\.\d{1,2})?$/),
)
export type FinancialMajorAmount = Schema.Schema.Type<typeof FinancialMajorAmount>

export type FinancialAmountFailureReason =
  | "invalid_format"
  | "fractional_precision"
  | "invalid_exponent"
  | "overflow"

export type FinancialAmountResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: FinancialAmountFailureReason }

const decimalPattern = /^(\d+)(?:\.(\d+))?$/
const minorPattern = /^(0|[1-9]\d*)$/

const invalid = (reason: FinancialAmountFailureReason): FinancialAmountResult<never> => ({
  ok: false,
  reason,
})

const validExponent = (exponent: number) =>
  Number.isSafeInteger(exponent) && exponent >= 0 && exponent <= 38

/** Convert an exact decimal major amount to an exact U128-compatible minor amount. */
export const majorToMinor = (
  value: string,
  exponent: number,
): FinancialAmountResult<string> => {
  if (!validExponent(exponent)) return invalid("invalid_exponent")

  const match = decimalPattern.exec(value)
  if (match === null) return invalid("invalid_format")

  const whole = match[1]!
  const fraction = (match[2] ?? "").replace(/0+$/, "")
  if (fraction.length > exponent) return invalid("fractional_precision")

  const scale = 10n ** BigInt(exponent)
  const minor = BigInt(whole) * scale + BigInt(fraction.padEnd(exponent, "0") || "0")
  if (minor > FINANCIAL_LEDGER_MAX_MINOR) return invalid("overflow")

  return { ok: true, value: minor.toString() }
}

/** Convert a schema-validated major amount to bigint at an invariant boundary. */
export const requireExactMajorToMinor = (value: string, exponent: number): bigint => {
  const result = majorToMinor(value, exponent)
  if (!result.ok) throw new RangeError(`financial amount conversion failed: ${result.reason}`)
  return BigInt(result.value)
}

/** Convert an exact U128-compatible minor amount to a fixed-scale major string. */
export const minorToMajor = (
  value: string,
  exponent: number,
): FinancialAmountResult<string> => {
  if (!validExponent(exponent)) return invalid("invalid_exponent")
  if (!minorPattern.test(value)) return invalid("invalid_format")

  const minor = BigInt(value)
  if (minor > FINANCIAL_LEDGER_MAX_MINOR) return invalid("overflow")
  if (exponent === 0) return { ok: true, value: minor.toString() }

  const digits = minor.toString().padStart(exponent + 1, "0")
  const point = digits.length - exponent
  return {
    ok: true,
    value: `${digits.slice(0, point)}.${digits.slice(point)}`,
  }
}
