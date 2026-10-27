// RenderLab's renderers. Callers use the renderer-neutral RendererRuntime contract from src/core/; PixiJS stays inside.
export { probeCapabilities } from "./backends/probe";
export { BackendUnavailableError, UnsupportedSceneError } from "./errors";
export { checkTexturePixels, MAX_TEXTURE_EDGE, premultiplied } from "./textures";
export type { TexturePixels, TextureProvider } from "./textures";
export { SUPPORTED_KINDS } from "./pixi/scene-graph";
export { DEFAULT_TERRAIN, placeCorner, tilesetFromAtlas } from "./terrain";
export type { TerrainSettings, TileRegion, TilesetAtlas } from "./terrain";
export { PixiRuntime } from "./pixi/runtime";
export type { PixiRuntimeOptions } from "./pixi/runtime";
/** The PixiJS release the renderers run on, for diagnostics. */
export { VERSION as PIXI_VERSION } from "pixi.js";
