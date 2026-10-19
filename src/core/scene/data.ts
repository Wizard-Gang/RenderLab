// Plain-data helpers. Records enter the store as validated plain data and are copied and frozen on entry, so a
// caller that keeps a reference can never change a store's state, and frozen records can be shared freely.
import { compareIds } from "../contracts/ids";

export function freezeCopy<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => freezeCopy(entry))) as T;
  if (typeof value === "object" && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) copy[key] = freezeCopy(entry);
    return Object.freeze(copy) as T;
  }
  return value;
}

/** JSON with object keys in code-unit order, so equal data always serializes to identical text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value).sort(compareIds);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`cannot serialize non-finite number ${value}`);
  return JSON.stringify(value) ?? "null";
}
