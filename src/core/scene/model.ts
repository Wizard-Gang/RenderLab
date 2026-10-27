// The renderer-neutral scene model (specification §7, §13): what should appear, never how a GPU draws it. Nothing
// here names PixiJS, React or the DOM; a renderer translates it into display objects and GPU resources.
import type { CameraState } from "../camera/state";
import type { LayerId, ObjectId, ResourceId, SceneId } from "../contracts/ids";
import type { Transform2D, Vec2 } from "../contracts/values";
import type { AnimationState } from "../timeline/animation";

/** Where an element came from: its authority (for example `maplab:map.forest`), its source ID and, for prefab-expanded
 * content, the chain of instance IDs it was expanded through. */
export interface SourceRef {
  readonly authority: string;
  readonly id: string;
  readonly path: readonly string[];
}

export const RESOURCE_KINDS = Object.freeze([
  "texture", "tileset", "rig", "animation", "skin", "palette", "equipment", "effect",
] as const);
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/** A resource a scene needs, keyed by a stable ID. Renderers resolve it to GPU resources; the model never holds them. */
export interface ResourceDescriptor {
  readonly id: ResourceId;
  readonly kind: ResourceKind;
  readonly source: SourceRef | null;
}

/**
 * A visual layer. Layers form a tree; siblings draw in ascending `order`, which must be unique among them, and a
 * parent draws before its children. `role` is an open, informational tag (MapLab's own layer kinds pass through it);
 * it never decides draw order, so MapLab's layer model is not squeezed into a fixed enumeration (§8.3).
 * `space: "screen"` layers ignore the camera; world layers move with it scaled by `parallax` (1 = with the world).
 */
export interface LayerDescriptor {
  readonly id: LayerId;
  readonly parentId: LayerId | null;
  readonly order: number;
  readonly visible: boolean;
  readonly opacity: number;
  readonly space: "world" | "screen";
  readonly parallax: Vec2;
  readonly occlusionFade: number | null;
  readonly role: string | null;
  readonly source: SourceRef | null;
}

/** `static` content changes only through explicit scene changes; `dynamic` content may change every tick. */
export type Mobility = "static" | "dynamic";

interface ObjectBase {
  readonly id: ObjectId;
  readonly layerId: LayerId;
  readonly mobility: Mobility;
  readonly visible: boolean;
  /** Draw order within a layer: ascending sortKey, then ascending id. */
  readonly sortKey: number;
  readonly source: SourceRef | null;
}

export interface SpriteObject extends ObjectBase {
  readonly kind: "sprite";
  readonly transform: Transform2D;
  readonly texture: ResourceId;
  /** Pivot as a fraction of the texture size: { x: 0, y: 0 } is the top-left corner. */
  readonly anchor: Vec2;
  readonly tint: number;
  readonly alpha: number;
}

/** One MapLab-style terrain cell: a tile of the chunk's tileset, turned and mirrored. */
export interface TileCell {
  readonly tile: string;
  readonly quarterTurns: 0 | 1 | 2 | 3;
  readonly mirrorX: boolean;
  readonly mirrorY: boolean;
}

export const CHUNK_SIZE = 32;
export const CHUNK_CELLS = CHUNK_SIZE * CHUNK_SIZE;

/**
 * A sparse 32×32 terrain chunk. Cell `index` is `row * 32 + column` within the chunk, row-major from the top-left;
 * the chunk's top-left cell sits at `grid.origin + (column * 32 * cellSize.x, row * 32 * cellSize.y)`. Chunks are
 * always static: edits arrive as cell changes that dirty only their own chunk.
 */
export interface TileChunkObject extends ObjectBase {
  readonly kind: "tile-chunk";
  readonly tileset: ResourceId;
  readonly grid: { readonly origin: Vec2; readonly cellSize: Vec2 };
  readonly column: number;
  readonly row: number;
  readonly cells: readonly (TileCell | null)[];
}

export interface Appearance {
  readonly skin: ResourceId | null;
  readonly palette: ResourceId | null;
  readonly equipment: readonly ResourceId[];
}

/** A RigLab character: its rig, what it plays, how it looks, and whether parts (articulated) or whole-pose frames
 * (baked) present it (§9.5). */
export interface CharacterObject extends ObjectBase {
  readonly kind: "character";
  readonly transform: Transform2D;
  readonly rig: ResourceId;
  readonly animation: AnimationState;
  readonly appearance: Appearance;
  readonly presentation: "articulated" | "baked";
}

export interface ParticlesObject extends ObjectBase {
  readonly kind: "particles";
  readonly transform: Transform2D;
  readonly effect: ResourceId;
  /** The most particles this emitter may hold alive. */
  readonly budget: number;
}

export interface EffectObject extends ObjectBase {
  readonly kind: "effect";
  readonly transform: Transform2D;
  readonly effect: ResourceId;
  readonly params: Readonly<Record<string, number>>;
}

/** Shape geometry in the object's local space, in world units. Rectangles are x, y, width, height. */
export type ShapeGeometry =
  | { readonly kind: "rect"; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly kind: "circle"; readonly center: Vec2; readonly radius: number }
  | { readonly kind: "polygon"; readonly points: readonly Vec2[] };

export const MAX_SHAPE_POINTS = 4096;

/** A filled vector shape, such as MapLab's authored shape visuals. It needs no resource. */
export interface ShapeObject extends ObjectBase {
  readonly kind: "shape";
  readonly transform: Transform2D;
  readonly geometry: ShapeGeometry;
  /** 0xRRGGBB. */
  readonly fill: number;
  readonly alpha: number;
}

export type SceneObject = SpriteObject | TileChunkObject | ShapeObject | CharacterObject | ParticlesObject | EffectObject;
export type SceneObjectKind = SceneObject["kind"];

export interface SceneDefinition {
  readonly id: SceneId;
  readonly resources: readonly ResourceDescriptor[];
  readonly layers: readonly LayerDescriptor[];
  readonly objects: readonly SceneObject[];
  readonly camera: CameraState;
}
