import { parseJson, pathProblem, type AssetBundle, type JsonValue } from "../../assets";
import { canonicalJson, compareIds } from "../../core";
import { ASSET_MEDIA, extensionOf, FORMATS, MAPLAB_CONTRACTS, type ContractRole, type MapLabFormat } from "./contracts";
import { MapLabError } from "./errors";
import { assertSchema } from "./schema";
import { documentSchema, PINNED_SCHEMAS } from "./schemas";

// Specification §8.1 step 7 for maplab.export v1: the manifest's own MapLab rules (RFC 8785 bytes, sorted listing,
// every authored file indexed as exactly one document, pinned schemas, approved asset types), then each document's
// bytes, identity, version, schema and the contracts it names. `readBundle` has already checked steps 1–6.

export type JsonObject = { readonly [key: string]: JsonValue };
export const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

export interface MapLabDocument {
  readonly id: string;
  readonly format: MapLabFormat;
  readonly version: number;
  readonly path: string;
  readonly value: JsonObject;
}

const MANIFEST = "manifest.json";
const decoder = new TextDecoder();
const isCanonical = (bytes: Uint8Array, value: JsonValue): boolean => decoder.decode(bytes) === canonicalJson(value);

function sorted(values: readonly string[]): number {
  return values.findIndex((value, i) => i > 0 && compareIds(values[i - 1]!, value) >= 0);
}

function checkManifest(bundle: AssetBundle, manifestBytes: Uint8Array): void {
  const source = bundle.manifest.source as JsonObject;
  if (!isCanonical(manifestBytes, source)) throw new MapLabError("manifest.canonical", MANIFEST, "$", "the manifest is not RFC 8785 canonical JSON");
  if (sorted(bundle.manifest.files.map((file) => file.path)) >= 0) throw new MapLabError("manifest.order", MANIFEST, "$.files", "files must be sorted by path");
  const documents = source.documents as readonly JsonObject[];
  if (sorted(documents.map((entry) => entry.id as string)) >= 0) throw new MapLabError("manifest.order", MANIFEST, "$.documents", "documents must be sorted by ID");
  const named = new Map(documents.map((entry, i) => [entry.path as string, i]));
  for (const [i, file] of bundle.manifest.files.entries()) {
    const bytes = bundle.files.get(file.path)!.bytes;
    if (file.role === "schema") {
      const pinned = PINNED_SCHEMAS.get(file.path);
      let same = false;
      try {
        same = pinned !== undefined && canonicalJson(parseJson(bytes, file.path)) === canonicalJson(pinned);
      } catch {
        same = false;
      }
      if (!same) throw new MapLabError("schema.mismatch", MANIFEST, `$.files[${i}]`, `${file.path} is not one of the published MapLab schemas this reader pins`);
    } else if (file.role === "asset" && !Object.hasOwn(ASSET_MEDIA, extensionOf(file.path))) {
      throw new MapLabError("asset.extension", MANIFEST, `$.files[${i}].path`, `assets must be ${Object.keys(ASSET_MEDIA).join(", ")}`);
    } else if (file.role === "authored" && !named.has(file.path)) {
      throw new MapLabError("manifest.unindexed", MANIFEST, `$.files[${i}]`, "every authored file must be indexed as a document");
    } else if (file.role === "foreign") {
      throw new MapLabError("adapter.unsupported", MANIFEST, `$.files[${i}]`, "foreign RigLab bundles inside a MapLab export are presented by the RigLab adapter (RLDR-011), which this reader does not yet use");
    }
  }
  documents.forEach((entry, i) => {
    const role = bundle.manifest.files.find((file) => file.path === entry.path)?.role;
    if (role !== "authored") throw new MapLabError("manifest.document-file", MANIFEST, `$.documents[${i}].path`, `a document must name an authored file, not ${role ?? "an unlisted path"}`);
  });
}

interface ContractSlot {
  readonly ref: JsonValue | undefined;
  readonly role: ContractRole;
  readonly at: string;
}

function slots(document: MapLabDocument): ContractSlot[] {
  const value = document.value;
  if (document.format === "maplab.movement") return [{ ref: value.controller, role: "controller", at: "$.controller" }];
  if (document.format !== "maplab.map") return [];
  const features = (value.requiredFeatures as readonly JsonValue[]).map((ref, i): ContractSlot => ({ ref, role: "feature", at: `$.requiredFeatures[${i}]` }));
  return [...features, { ref: value.collisionContract, role: "collision", at: "$.collisionContract" }, { ref: (value.camera as JsonObject).model, role: "camera", at: "$.camera.model" }];
}

function checkContracts(document: MapLabDocument, declared: ReadonlySet<string>): void {
  const undeclared = (what: string) => new MapLabError("contract.undeclared", MANIFEST, "$.requiredContracts", `${what} is used by ${document.path} but not listed in requiredContracts`);
  if (!declared.has(`${document.format}@${document.version}`)) throw undeclared(`${document.format} v${document.version}`);
  const features = new Set<string>();
  for (const { ref, role, at } of slots(document)) {
    const { key, version } = ref as { key: string; version: number };
    if (role === "feature") {
      if (features.has(key)) throw new MapLabError("contract.duplicate", document.path, at, `${key} is required more than once`);
      features.add(key);
    }
    const known = MAPLAB_CONTRACTS.filter((contract) => contract.key === key);
    if (known.length === 0) throw new MapLabError("contract.unsupported", document.path, at, `${key} v${version} is not a MapLab contract this reader knows; use a reader that supports it or export without it`);
    if (!known[0]!.roles.includes(role)) throw new MapLabError("contract.role", document.path, at, `${key} cannot serve as the ${role} contract`);
    if (!known.some((contract) => contract.version === version)) {
      throw new MapLabError("contract.unsupported", document.path, at, `${key} v${version} is required, but this reader supports ${known.map((c) => `v${c.version}`).join(", ")}; re-export for a supported version`);
    }
    if (!declared.has(`${key}@${version}`)) throw undeclared(`${key} v${version}`);
  }
}

function readDocument(bundle: AssetBundle, entry: JsonObject): MapLabDocument {
  const path = entry.path as string;
  const bytes = bundle.files.get(path)!.bytes;
  const value = parseJson(bytes, path);
  if (!isCanonical(bytes, value)) throw new MapLabError("document.canonical", path, "$", "the document is not RFC 8785 canonical JSON");
  if (!isObject(value)) throw new MapLabError("schema.type", path, "$", "a document must be a JSON object");
  if (!FORMATS.includes(value.format as MapLabFormat)) {
    throw new MapLabError("document.unsupported-format", path, "$.format", `unknown format ${JSON.stringify(value.format)}; this reader reads ${FORMATS.join(", ")} v1`);
  }
  if (value.version !== 1) throw new MapLabError("document.version", path, "$.version", `${String(value.format)} version ${JSON.stringify(value.version)} is not supported; this reader reads v1`);
  if (value.format !== entry.format || value.id !== entry.id || value.version !== entry.version) {
    throw new MapLabError("manifest.document-identity", path, "$", "the document's format, ID and version must match its manifest entry");
  }
  const format = value.format as MapLabFormat;
  assertSchema(documentSchema(format), value, path);
  return { id: value.id as string, format, version: 1, path, value };
}

/** Reads every manifest document, in manifest order, and checks the contracts each one names. */
export function readDocuments(bundle: AssetBundle, manifestBytes: Uint8Array): MapLabDocument[] {
  checkManifest(bundle, manifestBytes);
  const declared = new Set(bundle.manifest.requiredContracts.map(({ key, version }) => `${key}@${version}`));
  const documents = ((bundle.manifest.source as JsonObject).documents as readonly JsonObject[]).map((entry) => readDocument(bundle, entry));
  for (const document of documents) checkContracts(document, declared);
  return documents;
}

/** A bundled asset path's problem, if any: an unsafe or reserved name, or a missing file. */
export function assetPathProblem(bundle: AssetBundle, path: string): "asset.path" | "asset.missing" | null {
  if (pathProblem(path) !== null) return "asset.path";
  return bundle.files.get(path)?.role === "asset" ? null : "asset.missing";
}
