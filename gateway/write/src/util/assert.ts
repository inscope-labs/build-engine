/**
 * Small assertion helpers.
 *
 * These exist so that a failed invariant is loud and specific at the point where it happens,
 * rather than a wrong value that surfaces three layers away.
 */

/** Narrow a value to a non-null object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Throw if the condition is false. */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Throw if the value is null or undefined. */
export function assertPresent<T>(value: T | null | undefined, message: string): asserts value is T {
  if (value === null || value === undefined) throw new Error(message);
}

/**
 * Exhaustiveness check.
 *
 * Calling this in the `default` branch of a switch over a union makes the compiler complain when a
 * new member is added to the union and not handled, which is exactly when a forgotten case is
 * cheapest to notice.
 */
export function assertNever(value: never, message = "unhandled case"): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

/** Parse an integer that must be a non-negative integer written in decimal, with no sign. */
export function parseDecimalInt(value: string): number | null {
  if (!/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return null;
  return parsed;
}
