import { contractSupport, type ContractSupport } from "../../assets";

// The MapLab contracts this adapter knows, at exact versions (specification §3.1, §11.5). A contract is either a
// document format or a semantic contract a document names in a role. RenderLab presents some of them and carries
// the rest as references: their data is schema- and reference-checked but never simulated (§3.1, §8.5). A contract
// not in this table, or at another version, refuses the bundle with a compatibility report.

export type ContractRole = "format" | "feature" | "collision" | "camera" | "controller";

export interface KnownContract {
  readonly key: string;
  readonly version: number;
  readonly roles: readonly ContractRole[];
  /** `presented` contracts shape what RenderLab draws; `reference` contracts are read for traceability only. */
  readonly use: "presented" | "reference";
}

export const MAPLAB_CONTRACTS: readonly KnownContract[] = Object.freeze([
  { key: "maplab.map", version: 1, roles: ["format"], use: "presented" },
  { key: "maplab.tileset", version: 1, roles: ["format"], use: "presented" },
  { key: "maplab.prefab", version: 1, roles: ["format"], use: "presented" },
  { key: "maplab.catalog", version: 1, roles: ["format"], use: "reference" },
  { key: "maplab.movement", version: 1, roles: ["format"], use: "reference" },
  { key: "maplab.navigation", version: 1, roles: ["format"], use: "reference" },
  { key: "maplab.camera", version: 1, roles: ["camera", "feature"], use: "reference" },
  { key: "maplab.collision", version: 1, roles: ["collision", "feature"], use: "reference" },
  { key: "maplab.climb", version: 1, roles: ["feature"], use: "reference" },
  { key: "maplab.reference-controller", version: 1, roles: ["controller"], use: "reference" },
]);

/** What `readBundle` negotiates the manifest's required contracts against. */
export const MAPLAB_SUPPORT: ContractSupport = contractSupport(MAPLAB_CONTRACTS.map(({ key, version }) => `${key}@${version}`));

export type MapLabFormat = "maplab.map" | "maplab.tileset" | "maplab.prefab" | "maplab.catalog" | "maplab.movement" | "maplab.navigation";
export const FORMATS: readonly MapLabFormat[] = MAPLAB_CONTRACTS.filter((contract) => contract.roles.includes("format")).map((contract) => contract.key as MapLabFormat);

/** The dependency `kind` each format is declared as in a map's `dependencies`. */
export const DEPENDENCY_KINDS: Readonly<Record<string, MapLabFormat>> = Object.freeze({
  map: "maplab.map", tileset: "maplab.tileset", prefab: "maplab.prefab", movement: "maplab.movement", catalog: "maplab.catalog",
});

/** Approved bundled asset extensions and the media type each must declare (MapLab schemas/maplab.map.v1, `asset`). */
export const ASSET_MEDIA: Readonly<Record<string, string>> = Object.freeze({
  png: "image/png", webp: "image/webp", svg: "image/svg+xml", ogg: "audio/ogg", wav: "audio/wav",
});

export const extensionOf = (path: string): string => /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
