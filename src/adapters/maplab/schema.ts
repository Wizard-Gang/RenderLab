import type { JsonValue } from "../../assets";
import { canonicalJson } from "../../core";
import { jsonPath, MapLabError } from "./errors";

// An independent evaluator for the closed JSON Schema 2020-12 subset MapLab publishes in its schemas/ (specification
// §8.1 step 7). It is written from the dialect, not from MapLab code: a schema using any other keyword, a nested or
// non-local $ref, or an inexact multipleOf is refused when compiled, so nothing is validated by a rule it ignores.

export const DIALECT = "https://json-schema.org/draft/2020-12/schema";
const ANNOTATIONS = new Set(["$schema", "$id", "$comment", "title", "description", "default", "$defs"]);
const ASSERTIONS = new Set([
  "type", "const", "enum", "required", "properties", "additionalProperties", "propertyNames", "maxProperties",
  "prefixItems", "items", "minItems", "maxItems", "uniqueItems", "minimum", "maximum", "exclusiveMinimum",
  "exclusiveMaximum", "multipleOf", "pattern", "minLength", "maxLength", "oneOf", "$ref",
]);
const REF = /^#\/\$defs\/([A-Za-z0-9_-]+)$/;

type Node = boolean | { readonly [keyword: string]: JsonValue };
type JsonObject = { readonly [key: string]: JsonValue };
const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

export interface CompiledSchema {
  readonly name: string;
  readonly root: Node;
  readonly defs: Readonly<Record<string, Node>>;
  readonly patterns: ReadonlyMap<string, RegExp>;
}

export interface Violation {
  readonly keyword: string;
  readonly path: string;
}

export function compileSchema(schema: JsonValue, name: string): CompiledSchema {
  const bad = (message: string): never => {
    throw new TypeError(`${name}: ${message}; this evaluator reads only MapLab's JSON Schema 2020-12 subset`);
  };
  if (!isObject(schema) || schema.$schema !== DIALECT) bad("the root must declare JSON Schema 2020-12");
  const root = schema as JsonObject;
  const defs = (root.$defs === undefined ? {} : isObject(root.$defs) ? root.$defs : bad("$defs must be an object")) as Record<string, Node>;
  const patterns = new Map<string, RegExp>();
  const visit = (node: JsonValue, at: string): void => {
    if (typeof node === "boolean") return;
    if (!isObject(node)) return void bad(`a schema is expected at ${at}`);
    for (const [keyword, value] of Object.entries(node)) {
      if (!ANNOTATIONS.has(keyword) && !ASSERTIONS.has(keyword)) bad(`unsupported keyword ${keyword} at ${at}`);
      if ((keyword === "$defs" || keyword === "$schema") && at !== "#") bad(`nested ${keyword} at ${at}`);
      if (keyword === "$ref" && !(typeof value === "string" && Object.hasOwn(defs, REF.exec(value)?.[1] ?? ""))) bad(`non-local or unresolved $ref at ${at}`);
      if (keyword === "multipleOf" && !(typeof value === "number" && value > 0 && 2 ** Math.round(Math.log2(value)) === value)) bad(`inexact multipleOf at ${at}`);
      if (keyword === "pattern") {
        if (typeof value !== "string") bad(`pattern must be a string at ${at}`);
        else patterns.set(value, new RegExp(value, "u"));
      }
    }
    if (isObject(node.properties)) for (const [key, value] of Object.entries(node.properties)) visit(value, `${at}/properties/${key}`);
    if (Array.isArray(node.prefixItems)) node.prefixItems.forEach((value, i) => visit(value, `${at}/prefixItems/${i}`));
    if (Array.isArray(node.oneOf)) node.oneOf.forEach((value, i) => visit(value, `${at}/oneOf/${i}`));
    for (const keyword of ["items", "propertyNames"]) if (node[keyword] !== undefined) visit(node[keyword]!, `${at}/${keyword}`);
    if (isObject(node.additionalProperties)) visit(node.additionalProperties, `${at}/additionalProperties`);
    else if (node.additionalProperties !== undefined && node.additionalProperties !== false) bad(`additionalProperties must be false or a schema at ${at}`);
  };
  visit(root, "#");
  for (const [key, value] of Object.entries(defs)) visit(value as JsonValue, `#/$defs/${key}`);
  return { name, root, defs, patterns };
}

function hasType(type: JsonValue, value: JsonValue): boolean {
  switch (type) {
    case "null": return value === null;
    case "boolean": return typeof value === "boolean";
    case "string": return typeof value === "string";
    case "number": return typeof value === "number";
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "array": return Array.isArray(value);
    case "object": return isObject(value);
    default: return false;
  }
}

const num = (value: JsonValue | undefined): number | undefined => (typeof value === "number" ? value : undefined);

/** Returns up to `limit` violations of `value`, in document order. */
export function validateSchema(schema: CompiledSchema, value: JsonValue, limit = 20): Violation[] {
  const out: Violation[] = [];
  const run = (node: Node, v: JsonValue, path: (string | number)[], sink: Violation[]): void => {
    if (sink.length >= limit || node === true) return;
    const fail = (keyword: string, at = path) => {
      if (sink.length < limit) sink.push({ keyword, path: jsonPath(at) });
    };
    if (node === false) return fail("false");
    if (typeof node.$ref === "string") run(schema.defs[REF.exec(node.$ref)![1]!]!, v, path, sink);
    if (node.type !== undefined && !hasType(node.type, v)) return fail("type");
    if (node.const !== undefined && canonicalJson(node.const) !== canonicalJson(v)) fail("const");
    if (Array.isArray(node.enum) && !node.enum.some((entry) => canonicalJson(entry) === canonicalJson(v))) fail("enum");
    if (typeof v === "number") {
      const [min, max, exMin, exMax, step] = [num(node.minimum), num(node.maximum), num(node.exclusiveMinimum), num(node.exclusiveMaximum), num(node.multipleOf)];
      if (min !== undefined && v < min) fail("minimum");
      if (max !== undefined && v > max) fail("maximum");
      if (exMin !== undefined && v <= exMin) fail("exclusiveMinimum");
      if (exMax !== undefined && v >= exMax) fail("exclusiveMaximum");
      if (step !== undefined && !Number.isInteger(v / step)) fail("multipleOf");
    }
    if (typeof v === "string") {
      const length = [...v].length;
      if (num(node.minLength) !== undefined && length < num(node.minLength)!) fail("minLength");
      if (num(node.maxLength) !== undefined && length > num(node.maxLength)!) fail("maxLength");
      if (typeof node.pattern === "string" && !schema.patterns.get(node.pattern)!.test(v)) fail("pattern");
    }
    if (Array.isArray(v)) {
      if (num(node.minItems) !== undefined && v.length < num(node.minItems)!) fail("minItems");
      if (num(node.maxItems) !== undefined && v.length > num(node.maxItems)!) fail("maxItems");
      if (node.uniqueItems === true && new Set(v.map((item) => canonicalJson(item))).size !== v.length) fail("uniqueItems");
      const prefix = Array.isArray(node.prefixItems) ? (node.prefixItems as Node[]) : [];
      v.forEach((item, i) => {
        const sub = i < prefix.length ? prefix[i] : (node.items as Node | undefined);
        if (sub !== undefined) run(sub, item, [...path, i], sink);
      });
    }
    if (isObject(v)) {
      const properties = isObject(node.properties) ? node.properties : {};
      const keys = Object.keys(v);
      if (num(node.maxProperties) !== undefined && keys.length > num(node.maxProperties)!) fail("maxProperties");
      for (const key of (node.required as string[] | undefined) ?? []) if (!Object.hasOwn(v, key)) fail("required", [...path, key]);
      for (const key of keys) {
        if (node.propertyNames !== undefined) {
          const names: Violation[] = [];
          run(node.propertyNames as Node, key, [...path, key], names);
          if (names.length > 0) fail("propertyNames", [...path, key]);
        }
        if (Object.hasOwn(properties, key)) run(properties[key] as Node, v[key]!, [...path, key], sink);
        else if (node.additionalProperties === false) fail("additionalProperties", [...path, key]);
        else if (isObject(node.additionalProperties)) run(node.additionalProperties, v[key]!, [...path, key], sink);
      }
    }
    if (Array.isArray(node.oneOf)) {
      const passing = (node.oneOf as Node[]).filter((sub) => {
        const probe: Violation[] = [];
        run(sub, v, path, probe);
        return probe.length === 0;
      }).length;
      if (passing !== 1) fail("oneOf");
    }
  };
  run(schema.root, value, [], out);
  return out;
}

/** Validates `value` and refuses it at its first violation. */
export function assertSchema(schema: CompiledSchema, value: JsonValue, file: string): void {
  const [first] = validateSchema(schema, value, 1);
  if (first) throw new MapLabError(`schema.${first.keyword}`, file, first.path, `the document violates ${schema.name} (${first.keyword})`);
}
