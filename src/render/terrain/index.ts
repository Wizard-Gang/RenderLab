// Sparse terrain chunks (RLDR-009): per-chunk geometry from compiled tileset atlases, camera culling with a preload
// margin, dirty-chunk rebuilds and eviction under a chunk budget.
export { buildChunkGeometry, chunkRect, geometryBytes, missingTiles, placeCorner, tilesetFromAtlas, tilesetProblems } from "./geometry";
export type { PageGeometry, TileRegion, TilesetAtlas } from "./geometry";
export { ChunkResidency, DEFAULT_TERRAIN, terrainSettingsProblems } from "./residency";
export type { ChunkBuilder, TerrainSettings, TerrainStats } from "./residency";
export { chunkWanted, layerPlacement, layerViewRect } from "./visibility";
export type { Placement, Rect } from "./visibility";
export { TerrainChunks } from "./chunks";
export type { LoadedTileset, TerrainDisplayStats, TerrainSource } from "./chunks";
