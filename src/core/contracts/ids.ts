import type { Failures } from "./errors";

// Identifiers are opaque, stable strings. Imported content keeps its authored source IDs (MapLab, RigLab); RenderLab
// never mints authoritative world identities. Brands keep scene, layer, object and resource IDs from being mixed up.
declare const brand: unique symbol;
type Id<Kind extends string> = string & { readonly [brand]: Kind };

export type SceneId = Id<"scene">;
export type LayerId = Id<"layer">;
export type ObjectId = Id<"object">;
export type ResourceId = Id<"resource">;

/** At most 512 printable ASCII characters, no spaces: wide enough for composed source paths, never ambiguous. */
const STABLE_ID = /^[\x21-\x7e]{1,512}$/;

export function isStableId(value: unknown): value is string {
  return typeof value === "string" && STABLE_ID.test(value);
}

export function checkId(failures: Failures, path: string, value: unknown): void {
  if (!isStableId(value)) failures.add(path, "must be 1 to 512 printable ASCII characters without spaces");
}

export const sceneId = (value: string): SceneId => value as SceneId;
export const layerId = (value: string): LayerId => value as LayerId;
export const objectId = (value: string): ObjectId => value as ObjectId;
export const resourceId = (value: string): ResourceId => value as ResourceId;

/** Code-unit order: identical on every engine and locale, unlike `localeCompare`. */
export function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
