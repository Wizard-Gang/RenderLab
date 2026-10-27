// The terrain scene: sparse 32×32 tile chunks from a two-page tileset atlas. Chunk (0, 0) lays the marker tile out in
// all sixteen combinations of quarter turns and mirroring along its top row, and the two variant tiles below them;
// the browser tests read those pixels back. The other chunks exercise culling: one sits in the preload margin, two
// lie far outside it. At the scene's own camera, world units equal CSS pixels from the canvas's top-left corner.
import {
  CHUNK_CELLS, layerId, objectId, resourceId, sceneId, type CameraState, type SceneDefinition, type TileCell, type TileChunkObject,
} from "../../core";

export const TERRAIN_CELL = 24;
export const TERRAIN_CAMERA: CameraState = Object.freeze({ x: 240, y: 135, zoom: 1, bounds: null });
/** Chunk coordinates: (0, 0) is on screen, (1, 0) inside the one-chunk preload margin, the rest beyond it. */
export const TERRAIN_CHUNKS = Object.freeze([[0, 0], [1, 0], [4, 0], [0, 4]] as const);

/** The sixteen marker cases in top-row order: quarter turns cycle fastest, then mirrorX, then mirrorY. */
export const markerCase = (column: number): TileCell => ({
  tile: "tile.marker", quarterTurns: (column % 4) as TileCell["quarterTurns"], mirrorX: (column & 4) !== 0, mirrorY: (column & 8) !== 0,
});

/** Variant tiles sit on row 2: grass at column 0, stone at column 1. */
export const VARIANT_ROW = 2;

function cells(column: number, row: number): (TileCell | null)[] {
  const out: (TileCell | null)[] = new Array(CHUNK_CELLS).fill(null);
  if (column === 0 && row === 0) {
    for (let index = 0; index < 16; index += 1) out[index] = markerCase(index);
    out[VARIANT_ROW * 32] = { tile: "tile.grass", quarterTurns: 0, mirrorX: false, mirrorY: false };
    out[VARIANT_ROW * 32 + 1] = { tile: "tile.stone", quarterTurns: 0, mirrorX: false, mirrorY: false };
  } else out.fill({ tile: "tile.grass", quarterTurns: 0, mirrorX: false, mirrorY: false });
  return out;
}

export function terrainScene(): SceneDefinition {
  const chunks = TERRAIN_CHUNKS.map(([column, row]): TileChunkObject => ({
    kind: "tile-chunk", id: objectId(`terrain.chunk.${column}.${row}`), layerId: layerId("terrain"), mobility: "static", visible: true,
    sortKey: 0, source: { authority: "renderlab:terrain", id: `chunk ${column},${row}`, path: [] }, tileset: resourceId("tileset.marker"),
    grid: { origin: { x: 0, y: 0 }, cellSize: { x: TERRAIN_CELL, y: TERRAIN_CELL } }, column, row, cells: cells(column, row),
  }));
  return {
    id: sceneId("renderlab.terrain"),
    resources: [{ id: resourceId("tileset.marker"), kind: "tileset", source: { authority: "renderlab:generated", id: "tileset.marker", path: [] } }],
    layers: [{
      id: layerId("terrain"), parentId: null, order: 0, visible: true, opacity: 1, space: "world", parallax: { x: 1, y: 1 },
      occlusionFade: null, role: "terrain", source: null,
    }],
    objects: chunks,
    camera: TERRAIN_CAMERA,
  };
}
