// The PixiJS display tree for one mounted scene, kept in step with its SceneStore. It needs no GPU, so it is
// unit-tested in node; the runtime owns the renderer, the context and the textures it looks up.
import { Container, Sprite, type Texture } from "pixi.js";
import {
  parallaxOffset, type CameraView, type LayerDescriptor, type LayerId, type ObjectId, type ResourceId, type SceneDirty,
  type SceneObject, type SceneStore, type SpriteObject,
} from "../../core";
import { UnsupportedSceneError } from "../errors";
import { drawRanks, layerDisplay, spriteDisplay } from "./translate";

/** The object kinds this scene graph presents. Tile chunks, characters, particles and effects arrive with later tasks. */
export const SUPPORTED_KINDS: readonly SceneObject["kind"][] = Object.freeze(["sprite"]);

export function unsupportedObjects(objects: Iterable<SceneObject>): string[] {
  return [...objects].filter((object) => !SUPPORTED_KINDS.includes(object.kind))
    .map((object) => `object ${object.id}: ${object.kind} objects are not presented yet`);
}

interface LayerNode {
  readonly root: Container;
  /** The layer's own objects, drawn before its child layers. */
  readonly objects: Container;
  readonly children: Container;
}

export class PixiSceneGraph {
  readonly root = new Container({ label: "renderlab.scene", sortableChildren: true });
  readonly store: SceneStore;
  readonly #texture: (id: ResourceId) => Texture;
  readonly #layers = new Map<LayerId, LayerNode>();
  readonly #members = new Map<LayerId, Set<ObjectId>>();
  readonly #sprites = new Map<ObjectId, Sprite>();
  readonly #sortKeys = new Map<ObjectId, number>();
  #view: CameraView | null = null;

  /** `texture` returns the loaded texture for a resource ID; every texture the scene uses must already be loaded. */
  constructor(store: SceneStore, texture: (id: ResourceId) => Texture) {
    const snapshot = store.snapshot();
    const unsupported = unsupportedObjects(snapshot.objects);
    if (unsupported.length) throw new UnsupportedSceneError(unsupported);
    this.store = store;
    this.#texture = texture;
    for (const layer of snapshot.layers) this.#addLayer(layer);
    for (const object of snapshot.objects) this.#addObject(object);
    for (const layer of snapshot.layers) this.#rank(layer.id);
  }

  /** Bring the display tree in step with a delta the store has just applied, touching only what it dirtied. */
  apply(dirty: SceneDirty): void {
    const store = this.store;
    const rerank = new Set<LayerId>();
    for (const id of dirty.objects.removed) {
      const layer = this.#removeObject(id);
      if (layer !== null) rerank.add(layer);
    }
    for (const id of dirty.layers) {
      const node = this.#layers.get(id);
      if (node && !store.layer(id)) node.root.destroy({ children: true });
    }
    for (const [id, node] of this.#layers) {
      if (!node.root.destroyed) continue;
      this.#layers.delete(id);
      this.#members.delete(id);
    }
    const depth = (layer: LayerDescriptor): number => (layer.parentId === null ? 0 : 1 + depth(store.layer(layer.parentId) as LayerDescriptor));
    const present = dirty.layers.map((id) => store.layer(id)).filter((layer): layer is LayerDescriptor => layer !== undefined);
    for (const layer of present.sort((a, b) => depth(a) - depth(b))) {
      const node = this.#layers.get(layer.id);
      if (node) Object.assign(node.root, layerDisplay(layer));
      else this.#addLayer(layer);
    }
    for (const id of dirty.objects.added) {
      const object = store.object(id) as SceneObject;
      this.#addObject(object);
      rerank.add(object.layerId);
    }
    for (const id of dirty.objects.updated) {
      const object = store.object(id) as SceneObject;
      const sprite = this.#sprites.get(id) as Sprite;
      const from = this.#layerOf(id);
      if (from !== null && from !== object.layerId) {
        this.#members.get(from)?.delete(id);
        this.#members.get(object.layerId)?.add(id);
        (this.#layers.get(object.layerId) as LayerNode).objects.addChild(sprite);
        rerank.add(from).add(object.layerId);
      }
      if (this.#sortKeys.get(id) !== object.sortKey) rerank.add(object.layerId);
      this.#sortKeys.set(id, object.sortKey);
      this.#applySprite(sprite, object as SpriteObject);
    }
    for (const layer of rerank) if (this.#layers.has(layer)) this.#rank(layer);
    if (dirty.layers.length && this.#view) this.applyView(this.#view);
  }

  /**
   * Place every layer for a camera view. Each world root layer carries the whole camera transform (zoom, then the
   * origin plus its parallax offset), so screen-space layers can sit anywhere in the authored order, even behind the
   * world. A nested world layer adds only its parallax relative to its parent; screen layers stay in CSS pixels.
   */
  applyView(view: CameraView): void {
    this.#view = view;
    for (const [id, node] of this.#layers) {
      const layer = this.store.layer(id) as LayerDescriptor;
      if (layer.space === "screen") {
        node.root.scale.set(1);
        node.root.position.set(0, 0);
        continue;
      }
      const parent = layer.parentId === null ? undefined : this.store.layer(layer.parentId);
      const offset = parallaxOffset(view, layer.parallax, parent?.parallax);
      if (parent) {
        node.root.scale.set(1);
        node.root.position.set(offset.x, offset.y);
      } else {
        node.root.scale.set(view.zoom);
        node.root.position.set(view.originX + offset.x * view.zoom, view.originY + offset.y * view.zoom);
      }
    }
  }

  /** Layer IDs in the order they draw. */
  layerOrder(): LayerId[] {
    const order: LayerId[] = [];
    const ids = new Map([...this.#layers].map(([id, node]) => [node.root, id]));
    const visit = (container: Container) => {
      for (const child of [...container.children].sort((a, b) => a.zIndex - b.zIndex)) {
        const id = ids.get(child as Container);
        if (id === undefined) continue;
        order.push(id);
        visit((this.#layers.get(id) as LayerNode).children);
      }
    };
    visit(this.root);
    return order;
  }

  /** One layer's object IDs in the order they draw. */
  drawOrder(layer: LayerId): ObjectId[] {
    return [...(this.#members.get(layer) ?? [])].sort((a, b) => (this.#sprites.get(a) as Sprite).zIndex - (this.#sprites.get(b) as Sprite).zIndex);
  }

  /** The display object presenting a scene object, for diagnostics and tests. */
  sprite(id: ObjectId): Sprite | undefined {
    return this.#sprites.get(id);
  }

  layerContainer(id: LayerId): Container | undefined {
    return this.#layers.get(id)?.root;
  }

  /** Destroy every display object. Textures belong to the runtime and are left alone. */
  destroy(): void {
    this.root.destroy({ children: true });
    this.#sprites.clear();
    this.#layers.clear();
    this.#members.clear();
    this.#sortKeys.clear();
  }

  #addLayer(layer: LayerDescriptor): void {
    const objects = new Container({ label: "objects", sortableChildren: true });
    const children = new Container({ label: "layers", sortableChildren: true });
    const root = new Container({ label: `layer ${layer.id}`, zIndex: layer.order, children: [objects, children] });
    Object.assign(root, layerDisplay(layer));
    const parent = layer.parentId === null ? this.root : (this.#layers.get(layer.parentId) as LayerNode).children;
    parent.addChild(root);
    this.#layers.set(layer.id, { root, objects, children });
    this.#members.set(layer.id, new Set());
  }

  #addObject(object: SceneObject): void {
    if (object.kind !== "sprite") throw new UnsupportedSceneError(unsupportedObjects([object]));
    const sprite = new Sprite({ texture: this.#texture(object.texture), label: object.id });
    this.#applySprite(sprite, object);
    (this.#layers.get(object.layerId) as LayerNode).objects.addChild(sprite);
    this.#members.get(object.layerId)?.add(object.id);
    this.#sprites.set(object.id, sprite);
    this.#sortKeys.set(object.id, object.sortKey);
  }

  #applySprite(sprite: Sprite, object: SpriteObject): void {
    const display = spriteDisplay(object);
    sprite.texture = this.#texture(object.texture);
    sprite.position.set(display.x, display.y);
    sprite.rotation = display.rotation;
    sprite.scale.set(display.scaleX, display.scaleY);
    sprite.anchor.set(display.anchorX, display.anchorY);
    sprite.tint = display.tint;
    sprite.alpha = display.alpha;
    sprite.visible = display.visible;
  }

  #layerOf(id: ObjectId): LayerId | null {
    for (const [layer, members] of this.#members) if (members.has(id)) return layer;
    return null;
  }

  #removeObject(id: ObjectId): LayerId | null {
    const sprite = this.#sprites.get(id);
    if (!sprite) return null;
    const layer = this.#layerOf(id);
    sprite.destroy();
    this.#sprites.delete(id);
    this.#sortKeys.delete(id);
    if (layer !== null) this.#members.get(layer)?.delete(id);
    return layer;
  }

  #rank(layer: LayerId): void {
    const members = [...(this.#members.get(layer) ?? [])].map((id) => this.store.object(id) as SceneObject);
    for (const [id, rank] of drawRanks(members)) (this.#sprites.get(id) as Sprite).zIndex = rank;
  }
}
