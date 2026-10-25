import { describe, expect, it } from "vitest";
import { BundleError, MAX_JSON_DEPTH, parseJson, type BundleErrorCode } from "../../src/assets";
import { text } from "./helpers";

const parse = (input: string | Uint8Array) => parseJson(typeof input === "string" ? text(input) : input, "doc.json");
const codeOf = (input: string | Uint8Array): BundleErrorCode | "ok" => {
  try {
    parse(input);
    return "ok";
  } catch (error) {
    if (error instanceof BundleError) return error.code;
    throw error;
  }
};

describe("parseJson", () => {
  it("reads RFC 8259 JSON as JSON.parse does", () => {
    const source = '{"a":[1,-2.5e3,true,false,null,"x\\u00e9\\ud83d\\ude00\\n\\/"],"b":{},"c":[]}';
    expect(parse(` \t\r\n${source}\n`)).toEqual(JSON.parse(source));
    expect(parse("0")).toBe(0);
  });

  it.each<[string, string | Uint8Array, BundleErrorCode]>([
    ["a byte-order mark", Uint8Array.of(0xef, 0xbb, 0xbf, 0x7b, 0x7d), "json.bom"],
    ["invalid UTF-8", Uint8Array.of(0x22, 0xff, 0x22), "json.utf8"],
    ["a duplicate member", '{"a":1,"a":2}', "json.duplicate-key"],
    ["a nested duplicate member", '{"a":{"b":1,"b":1}}', "json.duplicate-key"],
    ["a lone high surrogate", '"\\ud800x"', "json.surrogate"],
    ["a high surrogate before a non-surrogate", '"\\ud800\\u0041"', "json.surrogate"],
    ["a lone low surrogate", '"\\udc00"', "json.surrogate"],
    ["a trailing comma", "[1,]", "json.syntax"],
    ["a trailing object comma", '{"a":1,}', "json.syntax"],
    ["trailing data", "{} {}", "json.syntax"],
    ["an unescaped control character", '"a\u0001b"', "json.syntax"],
    ["an unknown escape", '"\\x41"', "json.syntax"],
    ["a leading zero", "01", "json.syntax"],
    ["an out-of-range number", "1e400", "json.syntax"],
    ["NaN", "NaN", "json.syntax"],
    ["single quotes", "{'a':1}", "json.syntax"],
    ["an unterminated string", '"abc', "json.syntax"],
    ["empty input", "", "json.syntax"],
    ["nesting deeper than the limit", `${"[".repeat(MAX_JSON_DEPTH + 2)}${"]".repeat(MAX_JSON_DEPTH + 2)}`, "json.depth"],
  ])("refuses %s", (_name, input, code) => {
    expect(codeOf(input)).toBe(code);
  });

  it("accepts nesting at the limit", () => {
    expect(codeOf(`${"[".repeat(MAX_JSON_DEPTH + 1)}${"]".repeat(MAX_JSON_DEPTH + 1)}`)).toBe("ok");
  });

  it("keeps a __proto__ member an ordinary own property", () => {
    const value = parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.hasOwn(value, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("names the file and position in its errors", () => {
    expect(() => parse('{"a":1,"a":2}')).toThrow(/^json\.duplicate-key at doc\.json: member "a" appears twice at character \d+$/);
  });
});
