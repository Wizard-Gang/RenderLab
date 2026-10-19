// One scene's presentation state, changed only by atomic deltas. Each store owns its maps; every record it holds is a
// frozen copy, so two stores built from the same definition share no mutable state and snapshots never change.
import { checkCamera, type CameraState } from "../camera/state";
import { ContractError, Failures } from "../contracts/errors";
import { checkId, compareIds, type LayerId, type ObjectId, type ResourceId, type SceneId } from "../contracts/ids";
import { isRecord } from "../contracts/values";
import { freezeCopy } from "./data";
import type { SceneChange, SceneDelta, SceneDirty } from "./delta";
import type { LayerDescriptor, ResourceDescriptor, SceneDefinition, SceneObject } from "./model";
import { layerDrawOrder } from "./order";
import { stageChange, type Staging } from "./stage";
import { checkKeys, resourceReferences } from "./validate";

export interface SceneSnapshot {
  readonly id: SceneId;
  readonly revision: number;
  readonly camera: CameraState;
  /** Sorted by ID. */
  readonly resources: readonly ResourceDescriptor[];
  /** In draw order (see `layerDrawOrder`). */
  readonly layers: readonly LayerDescriptor[];
  /** Sorted by ID. */
  readonly objects: readonly SceneObject[];
}

const slotKey = (object: SceneObject): string | null =>
  object.kind === "tile-chunk" ? `${object.layerId}\u0000${object.column}\u0000${object.row}` : null;

const sorted = <T extends string>(values: Iterable<T>): T[] => [...values].sort(compareIds);

export class SceneStore {
  readonly id: SceneId;
  #revision = 0;
  #camera: CameraState;
  readonly #resources = new Map<ResourceId, ResourceDescriptor>();
  readonly #layers = new Map<LayerId, LayerDescriptor>();
  readonly #objects = new Map<ObjectId, SceneObject>();
  readonly #refs = new Map<ResourceId, number>();
  readonly #layerUse = new Map<LayerId, number>();
  readonly #slots = new Map<string, ObjectId>();

  constructor(definition: SceneDefinition) {
    const failures = new Failures();
    if (!isRecord(definition)) throw new ContractError("scene definition", ["scene: must be a scene definition"]);
    checkKeys(failures, "scene", definition, ["id", "resources", "layers", "objects", "camera"]);
    checkId(failures, "scene.id", definition.id);
    checkCamera(failures, "scene.camera", definition.camera);
    for (const list of ["resources", "layers", "objects"] as const) {
      if (!Array.isArray(definition[list])) failures.add(`scene.${list}`, "must be a list");
    }
    failures.throwIfAny("scene definition");
    this.id = definition.id;
    this.#camera = freezeCopy(definition.camera);
    const entry = (change: SceneChange, path: string) => [change, path, path] as const;
    this.#transact([
      ...definition.resources.map((resource, index) => entry({ op: "add-resource", resource }, `scene.resources[${index}]`)),
      ...definition.layers.map((layer, index) => entry({ op: "add-layer", layer }, `scene.layers[${index}]`)),
      ...definition.objects.map((object, index) => entry({ op: "add", object }, `scene.objects[${index}]`)),
    ], "scene definition");
    this.#revision = 0;
  }

  get revision(): number {
    return this.#revision;
  }

  get camera(): CameraState {
    return this.#camera;
  }

  object(id: ObjectId): SceneObject | undefined {
    return this.#objects.get(id);
  }

  layer(id: LayerId): LayerDescriptor | undefined {
    return this.#layers.get(id);
  }

  resource(id: ResourceId): ResourceDescriptor | undefined {
    return this.#resources.get(id);
  }

  /** How many objects reference a resource, so its owner knows when it can be released. */
  referenceCount(id: ResourceId): number {
    return this.#refs.get(id) ?? 0;
  }

  /** Apply a delta atomically: every change, or none and a `ContractError` naming every failure. */
  apply(delta: SceneDelta): SceneDirty {
    if (!Array.isArray(delta)) throw new ContractError("scene delta", ["delta: must be a list of changes"]);
    return this.#transact(delta.map((change, index) => [change, `delta[${index}]`] as const), "scene delta");
  }

  snapshot(): SceneSnapshot {
    return Object.freeze({
      id: this.id,
      revision: this.#revision,
      camera: this.#camera,
      resources: Object.freeze(sorted(this.#resources.keys()).map((id) => this.#resources.get(id) as ResourceDescriptor)),
      layers: Object.freeze(layerDrawOrder(this.#layers.values())),
      objects: Object.freeze(sorted(this.#objects.keys()).map((id) => this.#objects.get(id) as SceneObject)),
    });
  }

  #transact(changes: readonly (readonly [SceneChange, string, string?])[], subject: string): SceneDirty {
    const failures = new Failures();
    const staging: Staging = {
      resources: new Map(), layers: new Map(), objects: new Map(), refDelta: new Map(), useDelta: new Map(),
      slots: new Map(), camera: null, removedResources: new Set(),
      resource: (id) => (staging.resources.has(id) ? staging.resources.get(id) ?? undefined : this.#resources.get(id)),
      layer: (id) => (staging.layers.has(id) ? staging.layers.get(id) ?? undefined : this.#layers.get(id)),
      object: (id) => (staging.objects.has(id) ? staging.objects.get(id) ?? undefined : this.#objects.get(id)),
      slot: (key) => (staging.slots.has(key) ? staging.slots.get(key) ?? undefined : this.#slots.get(key)),
    };
    for (const [change, path, payload] of changes) stageChange(staging, failures, path, change, slotKey, payload);
    this.#checkCommit(staging, failures);
    failures.throwIfAny(subject);
    return this.#commit(staging, changes.length > 0);
  }

  #checkCommit(staging: Staging, failures: Failures): void {
    for (const [id, object] of staging.objects) {
      if (!object) continue;
      if (!staging.layer(object.layerId)) failures.add(`object ${id}.layerId`, `names missing layer ${object.layerId}`);
      for (const [resource, kind, field] of resourceReferences(object)) {
        const found = staging.resource(resource);
        if (!found) failures.add(`object ${id}.${field}`, `names missing resource ${resource}`);
        else if (found.kind !== kind) failures.add(`object ${id}.${field}`, `names ${found.kind} resource ${resource}; expected ${kind}`);
      }
    }
    for (const [id, resource] of staging.resources) {
      const uses = (this.#refs.get(id) ?? 0) + (staging.refDelta.get(id) ?? 0);
      if (!resource && uses > 0) failures.add(`resource ${id}`, `is still referenced by ${uses} object(s)`);
    }
    if (staging.layers.size === 0) return;
    const final = new Map(this.#layers);
    for (const [id, layer] of staging.layers) {
      if (layer) final.set(id, layer);
      else final.delete(id);
    }
    const siblings = new Map<string, LayerId>();
    for (const layer of final.values()) {
      if (layer.parentId !== null && !final.has(layer.parentId)) failures.add(`layer ${layer.id}.parentId`, `names missing layer ${layer.parentId}`);
      const key = `${layer.parentId ?? ""}\u0000${layer.order}`;
      const other = siblings.get(key);
      if (other !== undefined) failures.add(`layer ${layer.id}.order`, `${layer.order} is already used by sibling layer ${other}`);
      else siblings.set(key, layer.id);
      const seen = new Set<LayerId>([layer.id]);
      for (let parent = layer.parentId; parent !== null; parent = final.get(parent)?.parentId ?? null) {
        if (seen.has(parent)) {
          failures.add(`layer ${layer.id}.parentId`, "forms a cycle");
          break;
        }
        seen.add(parent);
      }
    }
    for (const [id, layer] of staging.layers) {
      if (layer) continue;
      const uses = (this.#layerUse.get(id) ?? 0) + (staging.useDelta.get(id) ?? 0);
      if (uses > 0) failures.add(`layer ${id}`, `still holds ${uses} object(s)`);
    }
  }

  #commit(staging: Staging, changed: boolean): SceneDirty {
    const added: ObjectId[] = [];
    const updated: ObjectId[] = [];
    const removed: ObjectId[] = [];
    const chunks: ObjectId[] = [];
    for (const [id, object] of staging.objects) {
      const before = this.#objects.get(id);
      if (before && object && before.kind === object.kind) updated.push(id);
      else {
        if (before) removed.push(id);
        if (object) added.push(id);
      }
      if ((before ?? object) && (before?.kind === "tile-chunk" || object?.kind === "tile-chunk")) chunks.push(id);
      if (object) this.#objects.set(id, object);
      else this.#objects.delete(id);
    }
    const addedResources: ResourceId[] = [];
    const removedResources: ResourceId[] = [];
    for (const [id, resource] of staging.resources) {
      const existed = this.#resources.has(id);
      if (resource) {
        if (!existed) addedResources.push(id);
        this.#resources.set(id, resource);
      } else if (existed) {
        removedResources.push(id);
        this.#resources.delete(id);
      }
    }
    for (const [id, layer] of staging.layers) {
      if (layer) this.#layers.set(id, layer);
      else this.#layers.delete(id);
    }
    for (const [map, deltas] of [[this.#refs, staging.refDelta], [this.#layerUse, staging.useDelta]] as const) {
      for (const [id, delta] of deltas as Map<string, number>) {
        const count = ((map as Map<string, number>).get(id) ?? 0) + delta;
        if (count === 0) (map as Map<string, number>).delete(id);
        else (map as Map<string, number>).set(id, count);
      }
    }
    for (const [key, id] of staging.slots) {
      if (id) this.#slots.set(key, id);
      else this.#slots.delete(key);
    }
    if (staging.camera) this.#camera = staging.camera;
    if (changed) this.#revision += 1;
    return Object.freeze({
      revision: this.#revision,
      objects: Object.freeze({ added: freezeCopy(sorted(added)), updated: freezeCopy(sorted(updated)), removed: freezeCopy(sorted(removed)) }),
      chunks: freezeCopy(sorted(chunks)),
      layers: freezeCopy(sorted(staging.layers.keys())),
      resources: Object.freeze({ added: freezeCopy(sorted(addedResources)), removed: freezeCopy(sorted(removedResources)) }),
      camera: staging.camera !== null,
    });
  }
}
