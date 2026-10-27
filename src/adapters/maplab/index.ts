// RenderLab's MapLab adapter: an independent, editor-free reader for maplab.export v1 bundles (specification §3.1,
// §3.3, §8). It imports only src/assets/, src/core/ and MapLab's pinned published schemas, never MapLab code.
import { readBundle, type AssetBundle, type BundleContainer } from "../../assets";
import { resolveClosure } from "./closure";
import { MAPLAB_SUPPORT } from "./contracts";
import { readDocuments, type MapLabDocument } from "./documents";
import { checkReferences } from "./references";
import { buildScene, type MapLabScene } from "./scene";

export { MAPLAB_CONTRACTS, MAPLAB_SUPPORT } from "./contracts";
export type { ContractRole, KnownContract, MapLabFormat } from "./contracts";
export type { MapLabDocument } from "./documents";
export { MapLabError } from "./errors";
export type { MapLabErrorCode } from "./errors";
export type { BackgroundLayout, MapLabHandle, MapLabScene } from "./scene";
export { compileSchema, validateSchema } from "./schema";

export interface MapLabReadOptions {
  /** The manifest digest a trusted channel promised; see `ReadOptions.expectDigest`. */
  readonly expectDigest?: string;
}

export interface MapLabWorld {
  readonly bundle: AssetBundle;
  readonly entryMapId: string;
  /** One scene per bundled map, in manifest order. */
  readonly maps: ReadonlyMap<string, MapLabScene>;
  /** Every validated document, presented or read as a reference, by ID. */
  readonly documents: ReadonlyMap<string, MapLabDocument>;
}

/**
 * Reads a MapLab export through specification §8.1 steps 1–11. The first failure refuses the whole bundle with a
 * `BundleError` (container, manifest, inventory, contracts) or a `MapLabError` (documents, closure, references, content
 * RenderLab cannot present yet); nothing required is skipped.
 */
export async function readMapLabExport(container: BundleContainer, options: MapLabReadOptions = {}): Promise<MapLabWorld> {
  const bundle = await readBundle(container, { support: MAPLAB_SUPPORT, ...options });
  if (bundle.format !== "maplab.export") throw new TypeError(`readMapLabExport reads maplab.export bundles, not ${bundle.format}`);
  const documents = readDocuments(bundle, container.entries.get("manifest.json")!);
  const listed = new Set(bundle.files.keys());
  const closure = resolveClosure(documents, (bundle.manifest.source as { entryMapId: string }).entryMapId, listed);
  checkReferences(bundle, closure);
  const maps = new Map<string, MapLabScene>();
  for (const document of documents) if (document.format === "maplab.map") maps.set(document.id, buildScene(document, closure));
  return { bundle, entryMapId: closure.entry.id, maps, documents: closure.documents };
}
