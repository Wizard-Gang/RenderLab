// The PixiJS side of terrain: one holder container per tile-chunk object, in its layer's draw order, and while the
// chunk is active, one Mesh per atlas page it uses. Large meshes are not batched, so each is one draw call.
import { Container, Mesh, MeshGeometry, type Texture } from "pixi.js";
import type { CameraView, LayerDescriptor, LayerId, ObjectId, TileChunkObject } from "../../core";
import { buildChunkGeometry, chunkRect, geometryBytes, type TileRegion } from "./geometry";
import { ChunkResidency, type TerrainSettings, type TerrainStats } from "./residency";
import { chunkWanted, layerViewRect } from "./visibility";

/** A tileset the runtime has uploaded: one texture per atlas page and every tile's region. */
export interface LoadedTileset {
  readonly textures: readonly Texture[];
  readonly regions: ReadonlyMap<string, TileRegion>;
}

export interface TerrainSource {
  chunk(id: ObjectId): TileChunkObject;
  tileset(id: TileChunkObject["tileset"]): LoadedTileset;
  /** The layer chain from the root down to `layer`. */
  chain(layer: LayerId): readonly LayerDescriptor[];
}

interface BuiltChunk {
  readonly display: Container;
  readonly geometries: readonly MeshGeometry[];
  readonly bytes: number;
}

export interface TerrainDisplayStats extends TerrainStats {
  /** Meshes the active chunks submit: one per chunk per atlas page used. */
  readonly meshes: number;
  /** Geometry bytes held by built chunks. */
  readonly geometryBytes: number;
}

// The store deep-copies every update, so cells compare by value: 1024 small comparisons, far cheaper than a rebuild.
function sameCells(a: TileChunkObject["cells"], b: TileChunkObject["cells"]): boolean {
  return a.length === b.length && a.every((cell, index) => {
    const other = b[index];
    return cell === other || (cell !== null && other !== null && cell.tile === other.tile && cell.quarterTurns === other.quarterTurns
      && cell.mirrorX === other.mirrorX && cell.mirrorY === other.mirrorY);
  });
}

export class TerrainChunks {
  readonly #source: TerrainSource;
  readonly #settings: TerrainSettings;
  readonly #holders = new Map<ObjectId, Container>();
  /** The chunk object each holder was last built or placed from. */
  readonly #objects = new Map<ObjectId, TileChunkObject>();
  readonly #residency: ChunkResidency<ObjectId, BuiltChunk>;
  #view: CameraView | null = null;

  constructor(source: TerrainSource, settings: TerrainSettings) {
    this.#source = source;
    this.#settings = settings;
    this.#residency = new ChunkResidency({ build: (id) => this.#build(id), release: (built) => this.#release(built) }, settings.chunkBudget);
  }

  /** The holder for a newly added chunk; the caller places it in its layer. Nothing is built until the view wants it. */
  add(object: TileChunkObject): Container {
    const holder = new Container({ label: object.id });
    this.#holders.set(object.id, holder);
    this.#objects.set(object.id, object);
    this.#place(holder, object);
    this.#residency.track(object.id);
    return holder;
  }

  /**
   * Follow an updated chunk object. Moving or hiding it only re-places its holder; a change to its cells, tileset or
   * cell size rebuilds it alone if active, or drops its stale geometry if idle. No other chunk is touched.
   */
  update(object: TileChunkObject): void {
    const holder = this.#holders.get(object.id) as Container;
    const before = this.#objects.get(object.id) as TileChunkObject;
    this.#objects.set(object.id, object);
    this.#place(holder, object);
    const same = sameCells(before.cells, object.cells) && before.tileset === object.tileset
      && before.grid.cellSize.x === object.grid.cellSize.x && before.grid.cellSize.y === object.grid.cellSize.y;
    if (same) return;
    const rebuilt = this.#residency.invalidate(object.id);
    if (rebuilt) holder.addChild(rebuilt.display);
  }

  remove(id: ObjectId): void {
    this.#residency.forget(id);
    this.#holders.get(id)?.destroy({ children: true });
    this.#holders.delete(id);
    this.#objects.delete(id);
  }

  holder(id: ObjectId): Container | undefined {
    return this.#holders.get(id);
  }

  /** Activate exactly the chunks inside the view plus the preload margin, and evict beyond the budget. */
  cull(view: CameraView | null = this.#view): void {
    this.#view = view;
    if (!view) return;
    const rects = new Map<LayerId, ReturnType<typeof layerViewRect>>();
    const wanted: ObjectId[] = [];
    for (const id of this.#holders.keys()) {
      const chunk = this.#source.chunk(id);
      if (!chunk.visible) continue;
      if (!rects.has(chunk.layerId)) rects.set(chunk.layerId, layerViewRect(view, this.#source.chain(chunk.layerId)));
      const rect = rects.get(chunk.layerId);
      if (rect && chunkWanted(chunk, rect, this.#settings.marginChunks)) wanted.push(id);
    }
    const { activated, deactivated } = this.#residency.show(wanted);
    for (const [id, built] of deactivated) this.#holders.get(id)?.removeChild(built.display);
    for (const [id, built] of activated) this.#holders.get(id)?.addChild(built.display);
  }

  /** Chunk IDs the frame submits, sorted. */
  activeIds(): ObjectId[] {
    return this.#residency.activeIds().sort();
  }

  stats(): TerrainDisplayStats {
    let meshes = 0;
    let bytes = 0;
    for (const id of this.#holders.keys()) {
      const built = this.#residency.built(id);
      if (!built) continue;
      bytes += built.bytes;
      if (this.#residency.isActive(id)) meshes += built.geometries.length;
    }
    return { ...this.#residency.stats(), meshes, geometryBytes: bytes };
  }

  destroy(): void {
    this.#residency.clear();
    for (const holder of this.#holders.values()) holder.destroy({ children: true });
    this.#holders.clear();
    this.#objects.clear();
  }

  #place(holder: Container, object: TileChunkObject): void {
    const rect = chunkRect(object);
    holder.position.set(rect.x, rect.y);
    holder.visible = object.visible;
  }

  #build(id: ObjectId): BuiltChunk {
    const chunk = this.#source.chunk(id);
    const tileset = this.#source.tileset(chunk.tileset);
    const pages = buildChunkGeometry(chunk, tileset.regions);
    const geometries = pages.map((page) => new MeshGeometry({ positions: page.positions, uvs: page.uvs, indices: page.indices }));
    const meshes = pages.map((page, index) => new Mesh({ geometry: geometries[index], texture: tileset.textures[page.page], label: `page ${page.page}` }));
    return { display: new Container({ label: "terrain", children: meshes }), geometries, bytes: geometryBytes(pages) };
  }

  #release(built: BuiltChunk): void {
    built.display.destroy({ children: true });
    for (const geometry of built.geometries) geometry.destroy();
  }
}
