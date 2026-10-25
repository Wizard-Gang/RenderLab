import { BundleError } from "./errors";

// Strict JSON for manifests (RFC 8259 over UTF-8). JSON.parse would silently take the last of two duplicate members,
// drop a byte-order mark's meaning and accept lone surrogates, so two readers could see different manifests in the
// same bytes. This parser refuses each of those instead, and bounds nesting depth.

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export const MAX_JSON_DEPTH = 64;

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const ESCAPES: Readonly<Record<string, string>> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

/** Parses `bytes` as one JSON value; `file` names the entry in every error. */
export function parseJson(bytes: Uint8Array, file: string): JsonValue {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new BundleError("json.bom", file, "a byte-order mark is not allowed");
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    throw new BundleError("json.utf8", file, "the bytes are not valid UTF-8");
  }
  let at = 0;
  const fail = (code: "json.syntax" | "json.surrogate" | "json.duplicate-key" | "json.depth", message: string): never => {
    throw new BundleError(code, file, `${message} at character ${at}`);
  };
  const space = () => {
    while (at < text.length && (text[at] === " " || text[at] === "\t" || text[at] === "\n" || text[at] === "\r")) at += 1;
  };
  const expect = (char: string) => {
    if (text[at] !== char) fail("json.syntax", `expected ${JSON.stringify(char)}`);
    at += 1;
  };
  const hex4 = (): number => {
    const digits = text.slice(at, at + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(digits)) fail("json.syntax", "a \\u escape needs four hex digits");
    at += 4;
    return Number.parseInt(digits, 16);
  };
  const string = (): string => {
    expect('"');
    let out = "";
    for (;;) {
      if (at >= text.length) fail("json.syntax", "unterminated string");
      const char = text[at]!;
      const code = char.charCodeAt(0);
      if (char === '"') {
        at += 1;
        return out;
      }
      if (code < 0x20) fail("json.syntax", "control characters must be escaped");
      if (char !== "\\") {
        out += char;
        at += 1;
        continue;
      }
      const escape = text[at + 1] ?? "";
      at += 2;
      if (escape !== "u") {
        const value = ESCAPES[escape];
        if (value === undefined) fail("json.syntax", `unknown escape \\${escape}`);
        out += value;
        continue;
      }
      const unit = hex4();
      if (unit >= 0xdc00 && unit <= 0xdfff) fail("json.surrogate", "a low surrogate has no high surrogate");
      if (unit >= 0xd800 && unit <= 0xdbff) {
        if (text[at] !== "\\" || text[at + 1] !== "u") fail("json.surrogate", "a high surrogate has no low surrogate");
        at += 2;
        const low = hex4();
        if (low < 0xdc00 || low > 0xdfff) fail("json.surrogate", "a high surrogate has no low surrogate");
        out += String.fromCharCode(unit, low);
      } else {
        out += String.fromCharCode(unit);
      }
    }
  };
  const value = (depth: number): JsonValue => {
    if (depth > MAX_JSON_DEPTH) fail("json.depth", `nesting exceeds ${MAX_JSON_DEPTH} levels`);
    space();
    const char = text[at];
    if (char === "{") {
      at += 1;
      const object: Record<string, JsonValue> = {};
      space();
      if (text[at] === "}") {
        at += 1;
        return object;
      }
      for (;;) {
        space();
        const key = string();
        if (Object.hasOwn(object, key)) fail("json.duplicate-key", `member ${JSON.stringify(key)} appears twice`);
        space();
        expect(":");
        // defineProperty keeps a "__proto__" member an ordinary own property.
        Object.defineProperty(object, key, { value: value(depth + 1), enumerable: true, writable: true, configurable: true });
        space();
        if (text[at] === "}") {
          at += 1;
          return object;
        }
        expect(",");
      }
    }
    if (char === "[") {
      at += 1;
      const array: JsonValue[] = [];
      space();
      if (text[at] === "]") {
        at += 1;
        return array;
      }
      for (;;) {
        array.push(value(depth + 1));
        space();
        if (text[at] === "]") {
          at += 1;
          return array;
        }
        expect(",");
      }
    }
    if (char === '"') return string();
    for (const [word, literal] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(word, at)) {
        at += word.length;
        return literal;
      }
    }
    NUMBER.lastIndex = at;
    const match = NUMBER.exec(text);
    if (!match) return fail("json.syntax", "expected a value");
    at += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) fail("json.syntax", "the number is out of range");
    return number;
  };
  const result = value(0);
  space();
  if (at !== text.length) fail("json.syntax", "unexpected data after the value");
  return result;
}
