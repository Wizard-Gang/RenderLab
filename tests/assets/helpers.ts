import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { BundleError, contractSupport, readBundle, readFolder, type BundleErrorCode, type ContractSupport } from "../../src/assets";

// Shared bundle inputs. The MapLab forest export is the locked fixture (fixtures/provenance.json). RigLab main commits no
// export fixture, so RigLab-shaped bundles are built here in the manifest shape of RigLab's src/export/bundle.ts.

export const FOREST_DIR = fileURLToPath(new URL("../../fixtures/maplab/forest-export/", import.meta.url));
export const EXPORT_SCHEMA = fileURLToPath(new URL("../../fixtures/maplab/schemas/maplab.export.v1.schema.json", import.meta.url));
/** MapLab's golden `bundleSha256` for the forest export (conformance/bundle/cases.json): the manifest's SHA-256. */
export const FOREST_DIGEST = "0a39dafd637c7cefa184ce9f18bd909d47f3eef317de3418bb3573614bf323ea";
export const FOREST_SUPPORT: ContractSupport = contractSupport([
  "maplab.camera@1", "maplab.catalog@1", "maplab.climb@1", "maplab.collision@1",
  "maplab.map@1", "maplab.movement@1", "maplab.reference-controller@1", "maplab.tileset@1",
]);

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const text = (value: string): Uint8Array => encoder.encode(value);
export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** The forest export as a folder map, in path order. */
export function forestFiles(): Map<string, Uint8Array> {
  const files: [string, Uint8Array][] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push([relative(FOREST_DIR, path).split(sep).join("/"), new Uint8Array(readFileSync(path))]);
    }
  };
  walk(FOREST_DIR);
  return new Map(files.sort(([left], [right]) => (left < right ? -1 : 1)));
}

type Editable = any;

/** A copy of `files` with manifest.json edited and re-serialized. */
export function editManifest(files: ReadonlyMap<string, Uint8Array>, edit: (manifest: Editable) => void): Map<string, Uint8Array> {
  const copy = new Map(files);
  const manifest = JSON.parse(decoder.decode(copy.get("manifest.json"))) as Editable;
  edit(manifest);
  copy.set("manifest.json", text(JSON.stringify(manifest)));
  return copy;
}

const pretty = (value: unknown) => text(`${JSON.stringify(value, null, 2)}\n`);

/** A riglab.export v1 bundle: a rig, an animation, a held weapon and, optionally, the animation's baked frames. */
export function rigLabFiles(options: { readonly baked?: boolean } = {}): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>([
    ["chibi.rig.json", pretty({ format: "riglab.rig", version: 1, name: "chibi" })],
    ["animations/idle.anim.json", pretty({ format: "riglab.anim", version: 3, name: "idle" })],
    ["weapons/sword.weapon.json", pretty({ format: "riglab.weapon", version: 1, name: "sword" })],
  ]);
  if (options.baked) files.set("baked/idle.baked.json", pretty({ format: "riglab.baked", version: 1, animation: "idle" }));
  const pin = (file: string) => ({ file, sha256: sha256(files.get(file)!) });
  const manifest = {
    format: "riglab.export",
    version: 1,
    generator: "RigLab test",
    rig: { name: "chibi", ...pin("chibi.rig.json") },
    animations: [{ name: "idle", ...pin("animations/idle.anim.json") }],
    weapons: [{ name: "sword", ...pin("weapons/sword.weapon.json") }],
    ...(options.baked ? { baked: [{ animation: "idle", ...pin("baked/idle.baked.json") }] } : {}),
  };
  return new Map([["manifest.json", pretty(manifest)], ...files]);
}

/** The BundleError a read throws; fails the test when it succeeds or throws anything else. */
export async function refusal(read: () => unknown): Promise<BundleError> {
  try {
    await read();
  } catch (error) {
    if (error instanceof BundleError) return error;
    throw error;
  }
  throw new Error("expected the bundle to be refused");
}

/** Reads `files` as a folder bundle and returns the refusal's code and location. */
export async function refused(
  files: Iterable<readonly [string, Uint8Array]>,
  support: ContractSupport = FOREST_SUPPORT,
  expectDigest?: string,
): Promise<{ code: BundleErrorCode; at: string | null }> {
  const error = await refusal(() => readBundle(readFolder(files), expectDigest === undefined ? { support } : { support, expectDigest }));
  return { code: error.code, at: error.at };
}
