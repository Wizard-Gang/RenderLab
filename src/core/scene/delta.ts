import type { CameraState } from "../camera/state";
import type { LayerId, ObjectId, ResourceId } from "../contracts/ids";
import type { Vec2 } from "../contracts/values";
import type { LayerDescriptor, ResourceDescriptor, SceneObject, TileCell } from "./model";

/** The fields an `update` may set; which ones apply depends on the object's kind (see `PATCH_FIELDS`). */
export type ObjectPatch = Partial<{
  readonly [K in DistributiveKeys<SceneObject>]: FieldType<SceneObject, K>;
}>;
type DistributiveKeys<T> = T extends unknown ? Exclude<keyof T, "id" | "kind" | "mobility" | "source"> : never;
type FieldType<T, K extends PropertyKey> = T extends unknown ? (K extends keyof T ? T[K] : never) : never;

export interface LayerPatch {
  readonly visible?: boolean;
  readonly opacity?: number;
  readonly parallax?: Vec2;
  readonly occlusionFade?: number | null;
}

export interface CellChange {
  readonly index: number;
  readonly cell: TileCell | null;
}

/** One incremental scene change. A delta's changes apply in order, atomically: all of them or none. */
export type SceneChange =
  | { readonly op: "add-resource"; readonly resource: ResourceDescriptor }
  | { readonly op: "remove-resource"; readonly id: ResourceId }
  | { readonly op: "add-layer"; readonly layer: LayerDescriptor }
  | { readonly op: "remove-layer"; readonly id: LayerId }
  | { readonly op: "set-layer"; readonly id: LayerId; readonly patch: LayerPatch }
  | { readonly op: "add"; readonly object: SceneObject }
  | { readonly op: "remove"; readonly id: ObjectId }
  | { readonly op: "update"; readonly id: ObjectId; readonly patch: ObjectPatch }
  | { readonly op: "set-cells"; readonly id: ObjectId; readonly cells: readonly CellChange[] }
  | { readonly op: "set-camera"; readonly camera: CameraState };

export type SceneDelta = readonly SceneChange[];

/**
 * What one applied delta changed, for a renderer to update only that. Every list is sorted by ID. An object whose
 * kind changed (removed and re-added under one ID) is listed as removed and added, never as updated. `chunks` names
 * every tile chunk that was added, updated or removed, so terrain rebuilds exactly those.
 */
export interface SceneDirty {
  readonly revision: number;
  readonly objects: {
    readonly added: readonly ObjectId[];
    readonly updated: readonly ObjectId[];
    readonly removed: readonly ObjectId[];
  };
  readonly chunks: readonly ObjectId[];
  readonly layers: readonly LayerId[];
  readonly resources: { readonly added: readonly ResourceId[]; readonly removed: readonly ResourceId[] };
  readonly camera: boolean;
}
