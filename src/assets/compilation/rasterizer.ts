import { CompileError } from "./errors";

/** RGBA8 pixels, rows top to bottom, straight (not premultiplied) alpha: the atlas page format. */
export interface Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface RasterizeRequest {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
}

/** What made the pixels. The manifest records it, because determinism holds only within one declared environment. */
export interface RasterizerIdentity {
  readonly name: string;
  readonly version: string;
  /** The caller's declaration of where it ran, such as a browser engine and version. Never inferred. */
  readonly environment: string;
}

export interface Rasterizer {
  readonly identity: RasterizerIdentity;
  rasterize(request: RasterizeRequest): Promise<Raster>;
}

/** Refuses a raster whose shape disagrees with its request, so a broken rasterizer never reaches packing. */
export function checkRaster(raster: Raster, request: RasterizeRequest, at: string): Raster {
  if (raster.width !== request.width || raster.height !== request.height || raster.data.length !== request.width * request.height * 4) {
    throw new CompileError("raster.shape", at,
      `expected ${request.width}×${request.height} RGBA8 (${request.width * request.height * 4} bytes), got ${raster.width}×${raster.height} with ${raster.data.length} bytes`);
  }
  return raster;
}
