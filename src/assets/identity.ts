import { resourceId, type ResourceId } from "../core/contracts/ids";

// Content-addressed identity (specification §12.2). A resource is its bytes: equal bytes are one resource whichever
// bundle, path or scene they arrive from, so they load once and are shared. A digest proves which bytes these are; it
// never proves who published them.

export const SHA256 = /^[0-9a-f]{64}$/;

/** Lowercase hex SHA-256 through Web Crypto, which browsers and Node both provide. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** `sha256:<hex>`: the one resource ID for these bytes. */
export function contentId(sha256: string): ResourceId {
  if (!SHA256.test(sha256)) throw new TypeError(`${JSON.stringify(sha256)} is not a lowercase hex SHA-256 digest`);
  return resourceId(`sha256:${sha256}`);
}
