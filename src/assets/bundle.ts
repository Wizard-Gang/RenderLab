import type { ResourceId } from "../core/contracts/ids";
import { MANIFEST, type BundleContainer } from "./container";
import { BundleError, CompatibilityError } from "./errors";
import { contentId, sha256Hex, SHA256 } from "./identity";
import { parseJson } from "./json";
import { parseManifest, type BundleManifest, type ManifestFormat } from "./manifest";
import { negotiate, type CompatibilityReport, type ContractSupport } from "./negotiate";

// The bundle reader: specification §8.1 steps 1–6 over a validated container. It parses the manifest, verifies the
// inventory exactly (nothing unlisted, nothing missing, every listed size and SHA-256), then negotiates the required
// contracts. The first failure refuses the whole bundle; nothing required is silently skipped. Steps 7–11 (schemas,
// references, closure, scene building) are the format adapters' (RLDR-008, RLDR-011).

export interface ReadOptions {
  /** The contracts and versions the consuming adapter renders; every required contract must be among them. */
  readonly support: ContractSupport;
  /**
   * The manifest digest a trusted channel promised, outside the bundle. Without it a bundle is only self-consistent:
   * its digest names its bytes, not its publisher.
   */
  readonly expectDigest?: string;
}

export interface BundleFile {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly role: string;
  /** Content-addressed: equal bytes in any bundle share this ID. */
  readonly id: ResourceId;
}

export interface AssetBundle {
  readonly format: ManifestFormat;
  readonly version: number;
  /** SHA-256 of manifest.json, which pins every other file: these exact bytes, never who made them. */
  readonly digest: string;
  /** The generator the manifest claims. `verified` is always false: integrity is not identity. */
  readonly publisher: { readonly claimed: string; readonly verified: false };
  /** True only when `expectDigest` was supplied and matched. */
  readonly digestExpected: boolean;
  readonly container: Pick<BundleContainer, "kind" | "root">;
  readonly manifest: BundleManifest;
  /** Listed files in manifest order. */
  readonly files: ReadonlyMap<string, BundleFile>;
  readonly compatibility: CompatibilityReport;
}

export async function readBundle(container: BundleContainer, options: ReadOptions): Promise<AssetBundle> {
  const manifestBytes = container.entries.get(MANIFEST);
  if (!manifestBytes) throw new BundleError("manifest.missing", MANIFEST, "the bundle has no manifest.json at its root");
  const digest = await sha256Hex(manifestBytes);
  if (options.expectDigest !== undefined) {
    if (!SHA256.test(options.expectDigest)) throw new TypeError("expectDigest must be a lowercase hex SHA-256 digest");
    if (options.expectDigest !== digest) {
      throw new BundleError("bundle.digest", MANIFEST, `the manifest digest ${digest} is not the expected ${options.expectDigest}`);
    }
  }
  const manifest = parseManifest(parseJson(manifestBytes, MANIFEST));

  const listed = new Set(manifest.files.map((file) => file.path));
  for (const path of container.entries.keys()) {
    if (path !== MANIFEST && !listed.has(path)) throw new BundleError("inventory.unlisted", path, "the entry is not listed in the manifest");
  }
  const files = new Map<string, BundleFile>();
  for (const file of manifest.files) {
    const bytes = container.entries.get(file.path);
    if (!bytes) throw new BundleError("inventory.missing", file.path, `the manifest lists it at ${file.at}, but the bundle lacks it`);
    if (file.bytes !== null && bytes.length !== file.bytes) {
      throw new BundleError("inventory.size", file.path, `the entry has ${bytes.length} bytes; the manifest lists ${file.bytes}`);
    }
    const sha256 = await sha256Hex(bytes);
    if (sha256 !== file.sha256) throw new BundleError("inventory.sha256", file.path, `the entry's SHA-256 is ${sha256}; the manifest lists ${file.sha256}`);
    files.set(file.path, { path: file.path, bytes, sha256, role: file.role, id: contentId(sha256) });
  }

  const compatibility = negotiate(manifest.requiredContracts, options.support);
  if (!compatibility.compatible) throw new CompatibilityError(compatibility);
  return {
    format: manifest.format,
    version: manifest.version,
    digest,
    publisher: { claimed: manifest.generator, verified: false },
    digestExpected: options.expectDigest !== undefined,
    container: { kind: container.kind, root: container.root },
    manifest,
    files,
    compatibility,
  };
}
