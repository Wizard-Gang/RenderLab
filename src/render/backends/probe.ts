// Probes what the browser and device can actually do (specification §6.3), from the graphics APIs themselves. Nothing
// here reads the user agent; scripts/check-boundaries.mjs refuses any source that does.
import { webgl2Unavailable, webgpuUnavailable, type Capabilities, type WebGL2Capability, type WebGPUCapability } from "../../core";
import { BackendUnavailableError } from "../errors";
import { createWebGL2Context, releaseContext } from "./webgl2-context";
import { describe } from "./started";

export function probeWebGL2(): WebGL2Capability {
  try {
    const gl = createWebGL2Context(document.createElement("canvas"));
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    releaseContext(gl);
    return { available: true, reason: null, maxTextureSize };
  } catch (error) {
    return webgl2Unavailable(error instanceof BackendUnavailableError ? error.reason : describe(error));
  }
}

export async function probeWebGPU(secureContext: boolean): Promise<WebGPUCapability> {
  if (!secureContext) return webgpuUnavailable("WebGPU needs a secure context (HTTPS or localhost)");
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) return webgpuUnavailable("this browser does not expose navigator.gpu");
  let adapter: GPUAdapter | null;
  try {
    adapter = await gpu.requestAdapter();
  } catch (error) {
    return webgpuUnavailable(`requesting an adapter threw: ${describe(error)}`);
  }
  if (!adapter) return webgpuUnavailable("no WebGPU adapter is available");
  return {
    available: true,
    reason: null,
    adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, fallback: adapter.info.isFallbackAdapter === true },
    maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
    features: [...adapter.features].map(String).sort(),
    preferredFormat: gpu.getPreferredCanvasFormat(),
  };
}

export async function probeCapabilities(): Promise<Capabilities> {
  const secureContext = globalThis.isSecureContext === true;
  return {
    secureContext,
    devicePixelRatio: globalThis.devicePixelRatio || 1,
    reducedMotion: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
    webgl2: probeWebGL2(),
    webgpu: await probeWebGPU(secureContext),
  };
}
