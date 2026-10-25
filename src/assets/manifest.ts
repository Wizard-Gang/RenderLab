import { BundleError } from "./errors";
import { SHA256 } from "./identity";
import type { JsonValue } from "./json";
import type { ContractRef } from "./negotiate";
import { pathProblem } from "./paths";

// Manifest profiles (specification §8.1 step 4, §11.5). Each export format is read at exact versions, its manifest
// mirrored field for field from the live authority: MapLab's schemas/maplab.export.v1.schema.json and RigLab's
// src/export/bundle.ts. Unknown formats, versions and fields are refused, never reinterpreted. Every profile
// normalizes to one listing: path, size where the format lists one, SHA-256 and role. Document semantics belong to
// the format adapters (RLDR-008, RLDR-011), which read `source`.

export interface ManifestFile {
  readonly path: string;
  /** The listed size; null where the format lists none (riglab.export v1 pins files by SHA-256 alone). */
  readonly bytes: number | null;
  readonly sha256: string;
  readonly role: string;
  /** Where the manifest lists the file, e.g. `$.files[2]`. */
  readonly at: string;
}

export interface BundleManifest {
  readonly format: ManifestFormat;
  readonly version: number;
  /** Who the manifest says generated it. Only a claim: nothing inside a bundle can verify it. */
  readonly generator: string;
  readonly files: readonly ManifestFile[];
  readonly requiredContracts: readonly ContractRef[];
  /** The parsed manifest, for the format adapters. */
  readonly source: JsonValue;
}

export type ManifestFormat = "maplab.export" | "riglab.export";
export const MANIFEST_VERSIONS: Readonly<Record<ManifestFormat, readonly number[]>> = Object.freeze({ "maplab.export": [1], "riglab.export": [1] });
export const MAPLAB_FIELDS = ["format", "version", "entryMapId", "generator", "requiredContracts", "documents", "files", "externalMaps"] as const;
export const MAPLAB_ROLES = ["authored", "asset", "schema", "derived", "foreign"] as const;
/** RenderLab's name for what a non-empty `externalMaps` requires: resolving other bundles, which no reader does yet. */
export const EXTERNAL_MAPS_CONTRACT = "maplab.external-maps";
/** maplab.export v1 caps each array at 20,000 items. */
const MAX_ITEMS = 20_000;
const KEY = /^[a-z0-9][a-z0-9._:-]{0,95}$/;

type JsonObject = { readonly [key: string]: JsonValue };
const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const fieldError = (at: string, message: string) => new BundleError("manifest.field", at, message);

function object(value: JsonValue | undefined, at: string, required: readonly string[], optional: readonly string[] = []): JsonObject {
  if (!isObject(value)) throw fieldError(at, "must be an object");
  for (const key of required) if (!Object.hasOwn(value, key)) throw fieldError(`${at}.${key}`, "is required");
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) throw fieldError(`${at}.${key}`, "is not a field of this format; unknown fields are refused");
  }
  return value;
}

function array(value: JsonValue | undefined, at: string): readonly JsonValue[] {
  if (!Array.isArray(value)) throw fieldError(at, "must be an array");
  if (value.length > MAX_ITEMS) throw fieldError(at, `holds more than ${MAX_ITEMS} items`);
  return value as readonly JsonValue[];
}

function text(value: JsonValue | undefined, at: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw fieldError(at, `must be a string of 1 to ${max} characters`);
  return value;
}

function key(value: JsonValue | undefined, at: string): string {
  if (typeof value !== "string" || !KEY.test(value)) throw fieldError(at, "must be a key: lowercase letters, digits, '.', '_', ':' or '-', at most 96");
  return value;
}

function integer(value: JsonValue | undefined, at: string, min: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) throw fieldError(at, `must be a whole number of at least ${min}`);
  return value;
}

function digest(value: JsonValue | undefined, at: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw fieldError(at, "must be a lowercase hex SHA-256 digest");
  return value;
}

function path(value: JsonValue | undefined, at: string): string {
  if (typeof value !== "string") throw fieldError(at, "must be a path string");
  const problem = pathProblem(value);
  if (problem) throw new BundleError("manifest.path", at, `unsafe listed path ${JSON.stringify(value)}: ${problem}`);
  return value;
}

function contract(value: JsonValue | undefined, at: string): ContractRef {
  const ref = object(value, at, ["key", "version"]);
  return { key: key(ref.key, `${at}.key`), version: integer(ref.version, `${at}.version`, 1) };
}

function mapLab(manifest: JsonValue): BundleManifest {
  const m = object(manifest, "$", MAPLAB_FIELDS);
  key(m.entryMapId, "$.entryMapId");
  const generator = object(m.generator, "$.generator", ["name", "version"]);
  if (generator.name !== "MapLab") throw fieldError("$.generator.name", 'must be "MapLab"');
  const generatorVersion = text(generator.version, "$.generator.version", 96);
  const requiredContracts = array(m.requiredContracts, "$.requiredContracts").map((item, i) => contract(item, `$.requiredContracts[${i}]`));
  array(m.documents, "$.documents").forEach((item, i) => {
    const at = `$.documents[${i}]`;
    const document = object(item, at, ["id", "format", "version", "path"]);
    key(document.id, `${at}.id`);
    if (typeof document.format !== "string" || !/^maplab\.[a-z]+$/.test(document.format)) throw fieldError(`${at}.format`, "must be maplab.<name>");
    integer(document.version, `${at}.version`, 1);
    path(document.path, `${at}.path`);
  });
  const files = array(m.files, "$.files").map((item, i): ManifestFile => {
    const at = `$.files[${i}]`;
    const file = object(item, at, ["path", "bytes", "sha256", "role"]);
    const role = file.role;
    if (typeof role !== "string" || !(MAPLAB_ROLES as readonly string[]).includes(role)) throw fieldError(`${at}.role`, `must be one of ${MAPLAB_ROLES.join(", ")}`);
    return { path: path(file.path, `${at}.path`), bytes: integer(file.bytes, `${at}.bytes`, 0), sha256: digest(file.sha256, `${at}.sha256`), role, at };
  });
  const externalMaps = array(m.externalMaps, "$.externalMaps");
  externalMaps.forEach((item, i) => {
    const external = object(item, `$.externalMaps[${i}]`, ["mapId", "bundleSha256"]);
    key(external.mapId, `$.externalMaps[${i}].mapId`);
    digest(external.bundleSha256, `$.externalMaps[${i}].bundleSha256`);
  });
  const implied = externalMaps.length > 0 ? [{ key: EXTERNAL_MAPS_CONTRACT, version: 1 }] : [];
  return { format: "maplab.export", version: 1, generator: `MapLab ${generatorVersion}`, files, requiredContracts: [...requiredContracts, ...implied], source: manifest };
}

function rigLab(manifest: JsonValue): BundleManifest {
  const m = object(manifest, "$", ["format", "version", "generator", "rig", "animations"], ["weapons", "baked"]);
  const listed = (item: JsonValue | undefined, at: string, name: string, role: string): ManifestFile => {
    const entry = object(item, at, [name, "file", "sha256"]);
    text(entry[name], `${at}.${name}`, 240);
    return { path: path(entry.file, `${at}.file`), bytes: null, sha256: digest(entry.sha256, `${at}.sha256`), role, at };
  };
  const many = (field: string, name: string, role: string): ManifestFile[] =>
    m[field] === undefined ? [] : array(m[field], `$.${field}`).map((item, i) => listed(item, `$.${field}[${i}]`, name, role));
  const files = [
    listed(m.rig, "$.rig", "name", "rig"),
    ...many("animations", "name", "animation"),
    ...many("weapons", "name", "weapon"),
    ...many("baked", "animation", "baked"),
  ];
  return { format: "riglab.export", version: 1, generator: text(m.generator, "$.generator", 240), files, requiredContracts: [], source: manifest };
}

const readable = () => Object.entries(MANIFEST_VERSIONS).map(([format, versions]) => `${format} v${versions.join(", v")}`).join(" and ");

/** Selects the profile by `format`, checks its version, then the shape, the listing and the required contracts. */
export function parseManifest(value: JsonValue): BundleManifest {
  const format = isObject(value) ? value.format : undefined;
  if (typeof format !== "string") throw new BundleError("manifest.format", "$.format", `the manifest names no format; this reader reads ${readable()}`);
  if (!Object.hasOwn(MANIFEST_VERSIONS, format)) {
    throw new BundleError("manifest.format", "$.format", `unknown bundle format ${JSON.stringify(format)}; this reader reads ${readable()}`);
  }
  const version = (value as JsonObject).version;
  if (typeof version !== "number" || !MANIFEST_VERSIONS[format as ManifestFormat].includes(version)) {
    throw new BundleError("contract.version", "$.version", `${format} version ${JSON.stringify(version)} is not supported; this reader reads ${readable()}`);
  }
  const manifest = format === "maplab.export" ? mapLab(value) : rigLab(value);
  const listed = new Map<string, string>();
  for (const file of manifest.files) {
    if (file.path === "manifest.json") throw new BundleError("manifest.self", file.at, "the manifest cannot list itself");
    const earlier = listed.get(file.path.toLowerCase());
    if (earlier !== undefined) {
      throw new BundleError("manifest.duplicate", file.at, earlier === file.path ? `${file.path} is listed twice` : `${file.path} differs only in case from ${earlier}`);
    }
    listed.set(file.path.toLowerCase(), file.path);
  }
  const keys = new Set<string>();
  manifest.requiredContracts.forEach((ref, i) => {
    if (keys.has(ref.key)) throw new BundleError("contract.duplicate", `$.requiredContracts[${i}]`, `${ref.key} is required more than once`);
    keys.add(ref.key);
  });
  return manifest;
}
