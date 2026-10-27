// The PixiJS display tree for one mounted scene, kept in step with its SceneStore. It needs no GPU, so it is
// unit-tested in node; the runtime owns the renderer, the context and the textures it looks up.
import { Container, Sprite, type Texture } from "pixi.js";
import {
  type CameraView, type LayerDescriptor, type LayerId, type ObjectId, type ResourceId, type SceneDirty,
  type SceneObject, type SceneStore, type SpriteObject, type TileChunkObject,
} from "../../core";
import { UnsupportedSceneError } from "../errors";
import { TerrainChunks, type LoadedTileset, type TerrainDisplayStats } from "../terrain/chunks";
import { missingTiles } from "../terrain/geometry";
import { DEFAULT_TERRAIN, type TerrainSettings } from "../terrain/residency";
import { layerPlacement } from "../terrain/visibility";
import { drawRanks, layerDisplay, spriteDisplay } from "./translate";

/** The object kinds this scene graph presents. Characters, particles and effects arrive with later tasks. */
export const SUPPORTED_KINDS: readonly SceneObject["kind"][] = Object.freeze(["sprite", "tile-chunk"]);

const noTilesets = (id: ResourceId): LoadedTileset => {
  throw new UnsupportedSceneError([`tileset ${id} was not loaded`]);
};

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
  readonly #tilesets: (id: ResourceId) => LoadedTileset;
  readonly #terrain: TerrainChunks;
  readonly #layers = new Map<LayerId, LayerNode>();
  readonly #members = new Map<LayerId, Set<ObjectId>>();
  readonly #sprites = new Map<ObjectId, Sprite>();
  /** Every object's display: its sprite, or its tile chunk's holder. */
  readonly #nodes = new Map<ObjectId, Container>();
  readonly #sortKeys = new Map<ObjectId, number>();
  #view: CameraView | null = null;

  /**
   * `texture` and `tilesets` return loaded resources by ID; every texture and tileset the scene uses must already be
   * loaded. Tile chunks build nothing until `applyView` shows which ones the camera needs.
   */
  constructor(store: SceneStore, texture: (id: ResourceId) => Texture, tilesets = noTilesets, terrain: TerrainSettings = DEFAULT_TERRAIN) {
    const snapshot = store.snapshot();
    const unsupported = unsupportedObjects(snapshot.objects);
    if (unsupported.length) throw new UnsupportedSceneError(unsupported);
    this.store = store;
    this.#texture = texture;
    this.#tilesets = tilesets;
    this.#terrain = new TerrainChunks({
      chunk: (id) => store.object(id) as TileChunkObject,
      tileset: tilesets,
      chain: (id) => this.#chain(id),
    }, terrain);
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
      const node = this.#nodes.get(id) as Container;
      const from = this.#layerOf(id);
      if (from !== null && from !== object.layerId) {
        this.#members.get(from)?.delete(id);
        this.#members.get(object.layerId)?.add(id);
        (this.#layers.get(object.layerId) as LayerNode).objects.addChild(node);
        rerank.add(from).add(object.layerId);
      }
      if (this.#sortKeys.get(id) !== object.sortKey) rerank.add(object.layerId);
      this.#sortKeys.set(id, object.sortKey);
      if (object.kind === "tile-chunk") this.#terrain.update(object);
      else this.#applySprite(node as Sprite, object as SpriteObject);
    }
    for (const layer of rerank) if (this.#layers.has(layer)) this.#rank(layer);
    if (dirty.layers.length && this.#view) this.applyView(this.#view);
    else this.#terrain.cull();
  }

  /**
   * Place every layer for a camera view. Each world root layer carries the whole camera transform (zoom, then the
   * origin plus its parallax offset), so screen-space layers can sit anywhere in the authored order, even behind the
   * world. A nested world layer adds only its parallax relative to its parent; screen layers stay in CSS pixels.
   * Then the terrain chunks inside the view and its preload margin become active, and the rest inactive.
   */
  applyView(view: CameraView): void {
    this.#view = view;
    for (const [id, node] of this.#layers) {
      const layer = this.store.layer(id) as LayerDescriptor;
      const placement = layerPlacement(view, layer, layer.parentId === null ? undefined : this.store.layer(layer.parentId));
      node.root.scale.set(placement.scale);
      node.root.position.set(placement.x, placement.y);
    }
    this.#terrain.cull(view);
  }

  /** Terrain chunk counts and counters since the scene mounted. */
  terrainStats(): TerrainDisplayStats {
    return this.#terrain.stats();
  }

  /** Tile-chunk IDs whose geometry the frame submits, sorted. */
  activeChunks(): ObjectId[] {
    return this.#terrain.activeIds();
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
    return [...(this.#members.get(layer) ?? [])].sort((a, b) => (this.#nodes.get(a) as Container).zIndex - (this.#nodes.get(b) as Container).zIndex);
  }

  /** The display object presenting a scene object, for diagnostics and tests. */
  sprite(id: ObjectId): Sprite | undefined {
    return this.#sprites.get(id);
  }

  /** The container holding a tile chunk's meshes while it is active, for diagnostics and tests. */
  chunkHolder(id: ObjectId): Container | undefined {
    return this.#terrain.holder(id);
  }

  layerContainer(id: LayerId): Container | undefined {
    return this.#layers.get(id)?.root;
  }

  /** Destroy every display object. Textures belong to the runtime and are left alone. */
  destroy(): void {
    this.#terrain.destroy();
    this.root.destroy({ children: true });
    this.#sprites.clear();
    this.#nodes.clear();
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
    let node: Container;
    if (object.kind === "tile-chunk") {
      const missing = missingTiles(object, this.#tilesets(object.tileset).regions);
      if (missing.length) throw new UnsupportedSceneError(missing);
      node = this.#terrain.add(object);
    } else if (object.kind === "sprite") {
      const sprite = new Sprite({ texture: this.#texture(object.texture), label: object.id });
      this.#applySprite(sprite, object);
      this.#sprites.set(object.id, sprite);
      node = sprite;
    } else throw new UnsupportedSceneError(unsupportedObjects([object]));
    (this.#layers.get(object.layerId) as LayerNode).objects.addChild(node);
    this.#members.get(object.layerId)?.add(object.id);
    this.#nodes.set(object.id, node);
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
    const node = this.#nodes.get(id);
    if (!node) return null;
    const layer = this.#layerOf(id);
    if (this.#sprites.has(id)) node.destroy();
    else this.#terrain.remove(id);
    this.#sprites.delete(id);
    this.#nodes.delete(id);
    this.#sortKeys.delete(id);
    if (layer !== null) this.#members.get(layer)?.delete(id);
    return layer;
  }

  #rank(layer: LayerId): void {
    const members = [...(this.#members.get(layer) ?? [])].map((id) => this.store.object(id) as SceneObject);
    for (const [id, rank] of drawRanks(members)) (this.#nodes.get(id) as Container).zIndex = rank;
  }

  /** The layer chain from the root down to `id`. */
  #chain(id: LayerId): LayerDescriptor[] {
    const chain: LayerDescriptor[] = [];
    for (let layer = this.store.layer(id); layer; layer = layer.parentId === null ? undefined : this.store.layer(layer.parentId)) chain.unshift(layer);
    return chain;
  }
}
