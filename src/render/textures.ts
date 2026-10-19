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

/** The texture edge every WebGL2 and WebGPU device supports; probed limits raise it per device. */
export const MAX_TEXTURE_EDGE = 2048;

export function checkTexturePixels(resource: string, pixels: TexturePixels, maxEdge = MAX_TEXTURE_EDGE): TexturePixels {
  const failures: string[] = [];
  const edge = (value: number) => Number.isInteger(value) && value >= 1 && value <= maxEdge;
  if (!edge(pixels.width)) failures.push(`width: must be a whole number from 1 to ${maxEdge}`);
  if (!edge(pixels.height)) failures.push(`height: must be a whole number from 1 to ${maxEdge}`);
  if (!(pixels.rgba instanceof Uint8Array)) failures.push("rgba: must be a Uint8Array");
  else if (failures.length === 0 && pixels.rgba.length !== pixels.width * pixels.height * 4) {
    failures.push(`rgba: must hold width * height * 4 = ${pixels.width * pixels.height * 4} bytes, not ${pixels.rgba.length}`);
  }
  if (pixels.filtering !== "nearest" && pixels.filtering !== "linear") failures.push('filtering: must be "nearest" or "linear"');
  if (failures.length) throw new ContractError(`texture ${resource}`, failures);
  return pixels;
}

/**
 * Straight RGBA8 to premultiplied RGBA8, rounding to nearest. RenderLab premultiplies texels itself because PixiJS
 * premultiplies buffer uploads on WebGL2 but writes them unchanged on WebGPU; uploading premultiplied bytes marked as
 * such gives both backends identical texels (specification §6.5).
 */
export function premultiplied(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length);
  for (let index = 0; index < rgba.length; index += 4) {
    const alpha = rgba[index + 3];
    out[index] = Math.round((rgba[index] * alpha) / 255);
    out[index + 1] = Math.round((rgba[index + 1] * alpha) / 255);
    out[index + 2] = Math.round((rgba[index + 2] * alpha) / 255);
    out[index + 3] = alpha;
  }
  return out;
}
