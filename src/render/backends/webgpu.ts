import { Container, WebGPURenderer } from "pixi.js";
import { BackendUnavailableError } from "../errors";
import { describe, rendererOptions, type BackendSettings, type StartedBackend } from "./started";

const DISPOSE_TIMEOUT_MS = 2000;
// The optional features PixiJS 8.22.0 requests when it creates a device itself; requested here only where offered.
const OPTIONAL_FEATURES = [
  "texture-compression-bc", "texture-compression-astc", "texture-compression-etc2", "indirect-first-instance",
  "bgra8unorm-storage", "texture-formats-tier1",
] as GPUFeatureName[];
/** How long a device must survive its first presented frame before the backend counts as started. */
const PRESENT_GRACE_MS = 100;

/**
 * Present one empty frame inside error scopes and wait for the GPU to finish it. Some adapters (for example
 * SwiftShader in headless Chromium without Vulkan) create a device that cannot present to a canvas and is lost on
 * its first frame; this turns that into a start failure that `auto` can fall back from, not a black canvas.
 */
async function presentFirstFrame(renderer: WebGPURenderer, device: GPUDevice): Promise<string | null> {
  device.pushErrorScope("validation");
  device.pushErrorScope("internal");
  device.pushErrorScope("out-of-memory");
  const frame = new Container();
  renderer.render(frame);
  frame.destroy();
  const errors = [await device.popErrorScope(), await device.popErrorScope(), await device.popErrorScope()].filter((error) => error !== null);
  if (errors.length) return errors.map((error) => error.message.replace(/\s+/g, " ").trim()).join("; ");
  const grace = new Promise<null>((resolve) => setTimeout(() => resolve(null), PRESENT_GRACE_MS));
  const lost = await Promise.race([device.queue.onSubmittedWorkDone().then(() => Promise.race([device.lost, grace])), device.lost]);
  return lost ? `the device was lost (${lost.reason}): ${lost.message}` : null;
}

/**
 * Request our own adapter and device and hand them to PixiJS. PixiJS then neither destroys nor silently replaces the
 * device: this backend owns its release, and a loss reaches the runtime instead of being restored behind its back.
 */
export async function startWebGPU(settings: BackendSettings): Promise<StartedBackend> {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) throw new BackendUnavailableError("webgpu", "this browser does not expose navigator.gpu");
  let adapter: GPUAdapter | null;
  try {
    adapter = await gpu.requestAdapter();
  } catch (error) {
    throw new BackendUnavailableError("webgpu", `requesting an adapter threw: ${describe(error)}`);
  }
  if (!adapter) throw new BackendUnavailableError("webgpu", "no WebGPU adapter is available");
  let device: GPUDevice;
  try {
    // PixiJS's own limits (its batcher sizes itself from them), plus the adapter's largest 2D texture, so the edge the
    // probe reports is the edge this device accepts.
    device = await adapter.requestDevice({
      requiredFeatures: OPTIONAL_FEATURES.filter((feature) => adapter.features.has(feature)),
      requiredLimits: {
        maxSampledTexturesPerShaderStage: adapter.limits.maxSampledTexturesPerShaderStage,
        maxSamplersPerShaderStage: adapter.limits.maxSamplersPerShaderStage,
        maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
      },
    });
  } catch (error) {
    throw new BackendUnavailableError("webgpu", `requesting a device failed: ${describe(error)}`);
  }
  let disposed = false;
  const listeners: ((detail: string) => void)[] = [];
  void device.lost.then((info) => {
    if (!disposed) for (const listener of listeners) listener(`the WebGPU device was lost (${info.reason}): ${info.message}`);
  });
  const canvas = document.createElement("canvas");
  const renderer = new WebGPURenderer();
  try {
    await renderer.init({ canvas, gpu: { adapter, device }, ...rendererOptions(settings) });
    const problem = await presentFirstFrame(renderer, device);
    if (problem) throw new BackendUnavailableError("webgpu", `the device could not present a frame: ${problem}`);
  } catch (error) {
    disposed = true;
    try {
      renderer.destroy({ removeView: true });
    } catch {
      // A renderer that failed part-way through init may not tear down cleanly; the device is destroyed below.
    }
    device.destroy();
    throw error instanceof BackendUnavailableError ? error : new BackendUnavailableError("webgpu", `PixiJS could not start on the device: ${describe(error)}`);
  }
  return {
    backend: "webgpu",
    renderer,
    canvas,
    onLost(listener) {
      listeners.push(listener);
    },
    async dispose() {
      disposed = true;
      renderer.destroy({ removeView: true });
      canvas.remove();
      device.destroy();
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), DISPOSE_TIMEOUT_MS));
      const info = await Promise.race([device.lost, timeout]);
      return info?.reason === "destroyed";
    },
  };
}
