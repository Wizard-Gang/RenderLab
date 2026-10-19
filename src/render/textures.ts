// How a renderer obtains texture pixels. RLDR-006/RLDR-007 provide the real compiled-asset provider; until then the
// reference application generates its textures in code.
import { ContractError, type ResourceDescriptor } from "../core";

export interface TexturePixels {
  readonly width: number;
  readonly height: number;
  /** Straight (not premultiplied) RGBA8, row-major from the top-left: `width * height * 4` bytes. */
  readonly rgba: Uint8Array;
  /** `nearest` keeps pixel art crisp; `linear` smooths scaled artwork. */
  readonly filtering: "nearest" | "linear";
}

export interface TextureProvider {
  /** The pixels of one `texture` resource. A rejection names the resource and why. */
  texture(resource: ResourceDescriptor): Promise<TexturePixels>;
}

/** The largest texture edge accepted before device limits are probed (RLDR-004): WebGL2 guarantees at least 2048. */
export const MAX_TEXTURE_EDGE = 2048;

export function checkTexturePixels(resource: string, pixels: TexturePixels): TexturePixels {
  const failures: string[] = [];
  const edge = (value: number) => Number.isInteger(value) && value >= 1 && value <= MAX_TEXTURE_EDGE;
  if (!edge(pixels.width)) failures.push(`width: must be a whole number from 1 to ${MAX_TEXTURE_EDGE}`);
  if (!edge(pixels.height)) failures.push(`height: must be a whole number from 1 to ${MAX_TEXTURE_EDGE}`);
  if (!(pixels.rgba instanceof Uint8Array)) failures.push("rgba: must be a Uint8Array");
  else if (failures.length === 0 && pixels.rgba.length !== pixels.width * pixels.height * 4) {
    failures.push(`rgba: must hold width * height * 4 = ${pixels.width * pixels.height * 4} bytes, not ${pixels.rgba.length}`);
  }
  if (pixels.filtering !== "nearest" && pixels.filtering !== "linear") failures.push('filtering: must be "nearest" or "linear"');
  if (failures.length) throw new ContractError(`texture ${resource}`, failures);
  return pixels;
}
