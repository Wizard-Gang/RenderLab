// Per-chunk terrain geometry (specification §8.2, §15.1): each 32×32 chunk becomes one indexed quad list per atlas
// page, so a chunk costs one submission per page it uses rather than a display object per tile. Pure, so node tests it.
import { CHUNK_CELLS, CHUNK_SIZE, type TileCell, type TileChunkObject } from "../../core";
import type { Atlas } from "../../assets/atlases/atlas";
import type { TexturePixels } from "../textures";

/** Where one tile's art sits in its tileset atlas: a page and the normalized rectangle the tile fills its cell with. */
export interface TileRegion {
  readonly id: string;
  readonly page: number;
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

/** A compiled tileset: its atlas pages and one region per tile ID. Variants are distinct tile IDs, each its own region. */
export interface TilesetAtlas {
  readonly pages: readonly TexturePixels[];
  readonly regions: readonly TileRegion[];
}

/** A compiled atlas (RLDR-007) whose region IDs are tile IDs, as the renderer's tileset input. */
export function tilesetFromAtlas(atlas: Atlas): TilesetAtlas {
  return {
    pages: atlas.pages.map((page) => ({ width: page.width, height: page.height, rgba: page.data, filtering: atlas.filter })),
    regions: atlas.regions.map(({ id, page, u0, v0, u1, v1 }) => ({ id, page, u0, v0, u1, v1 })),
  };
}

/** Every reason a tileset atlas cannot be drawn from; empty when it is sound. */
export function tilesetProblems(tileset: TilesetAtlas): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  tileset.regions.forEach((region, index) => {
    if (seen.has(region.id)) problems.push(`regions[${index}]: tile ${region.id} appears more than once`);
    seen.add(region.id);
    if (!Number.isInteger(region.page) || region.page < 0 || region.page >= tileset.pages.length) problems.push(`regions[${index}]: page ${region.page} does not exist`);
    if (![region.u0, region.v0, region.u1, region.v1].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
      problems.push(`regions[${index}]: texture coordinates must lie from 0 to 1`);
    }
  });
  return problems;
}

/**
 * Where a corner (u, v) of a tile's art lands in its cell, both in unit cell coordinates with Y down. MapLab's editor
 * convention: mirror inside the cell, then turn clockwise on screen about its centre, once per quarter turn.
 */
export function placeCorner(u: number, v: number, cell: Pick<TileCell, "quarterTurns" | "mirrorX" | "mirrorY">): readonly [number, number] {
  let x = cell.mirrorX ? 1 - u : u;
  let y = cell.mirrorY ? 1 - v : v;
  for (let turn = 0; turn < cell.quarterTurns; turn += 1) [x, y] = [1 - y, x];
  return [x, y];
}

/** One atlas page's share of a chunk: chunk-local positions in world units, page UVs and triangle indices. */
export interface PageGeometry {
  readonly page: number;
  readonly tiles: number;
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
}

export const CHUNK_CORNERS: readonly (readonly [number, number])[] = Object.freeze([[0, 0], [1, 0], [1, 1], [0, 1]]);

/** The chunk's world rectangle in its layer: its top-left cell's corner and 32 cells each way. */
export function chunkRect(chunk: Pick<TileChunkObject, "grid" | "column" | "row">): { x: number; y: number; width: number; height: number } {
  const width = CHUNK_SIZE * chunk.grid.cellSize.x;
  const height = CHUNK_SIZE * chunk.grid.cellSize.y;
  return { x: chunk.grid.origin.x + chunk.column * width, y: chunk.grid.origin.y + chunk.row * height, width, height };
}

/** Each cell whose tile the tileset lacks, described; tiles are never silently dropped. */
export function missingTiles(chunk: TileChunkObject, regions: ReadonlyMap<string, TileRegion>): string[] {
  const missing: string[] = [];
  chunk.cells.forEach((cell, index) => {
    if (cell && !regions.has(cell.tile)) missing.push(`object ${chunk.id}: cells[${index}] uses tile ${cell.tile}, which tileset ${chunk.tileset} does not have`);
  });
  return missing;
}

/**
 * The chunk's geometry, one entry per atlas page in ascending page order. Cells are laid out row-major as the model
 * stores them; each placed tile is four vertices and two triangles, its art's corners moved by its turns and mirroring.
 */
export function buildChunkGeometry(chunk: TileChunkObject, regions: ReadonlyMap<string, TileRegion>): PageGeometry[] {
  const missing = missingTiles(chunk, regions);
  if (missing.length) throw new Error(missing.join("\n"));
  const counts = new Map<number, number>();
  for (const cell of chunk.cells) {
    if (!cell) continue;
    const page = (regions.get(cell.tile) as TileRegion).page;
    counts.set(page, (counts.get(page) ?? 0) + 1);
  }
  const pages = new Map([...counts].sort(([a], [b]) => a - b).map(([page, tiles]) => [page, {
    page, tiles, filled: 0, positions: new Float32Array(tiles * 8), uvs: new Float32Array(tiles * 8), indices: new Uint32Array(tiles * 6),
  }]));
  const { x: width, y: height } = chunk.grid.cellSize;
  for (let index = 0; index < CHUNK_CELLS; index += 1) {
    const cell = chunk.cells[index];
    if (!cell) continue;
    const region = regions.get(cell.tile) as TileRegion;
    const out = pages.get(region.page) as NonNullable<ReturnType<typeof pages.get>>;
    const left = (index % CHUNK_SIZE) * width;
    const top = Math.floor(index / CHUNK_SIZE) * height;
    const vertex = out.filled * 4;
    CHUNK_CORNERS.forEach(([u, v], corner) => {
      const [x, y] = placeCorner(u, v, cell);
      const at = (vertex + corner) * 2;
      out.positions[at] = left + x * width;
      out.positions[at + 1] = top + y * height;
      out.uvs[at] = region.u0 + u * (region.u1 - region.u0);
      out.uvs[at + 1] = region.v0 + v * (region.v1 - region.v0);
    });
    out.indices.set([vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3], out.filled * 6);
    out.filled += 1;
  }
  return [...pages.values()].map(({ page, tiles, positions, uvs, indices }) => ({ page, tiles, positions, uvs, indices }));
}

/** Bytes the geometry holds on the CPU, and uploads once to the GPU. */
export const geometryBytes = (pages: readonly PageGeometry[]): number =>
  pages.reduce((sum, page) => sum + page.positions.byteLength + page.uvs.byteLength + page.indices.byteLength, 0);
