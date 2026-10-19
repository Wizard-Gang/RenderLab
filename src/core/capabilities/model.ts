// What the running browser and device can actually do, probed from the real APIs (specification §6.3): never inferred
// from a user-agent string. Probing lives in src/render/backends/; this is the renderer-neutral result.

export interface WebGL2Capability {
  readonly available: boolean;
  /** Why WebGL2 is unavailable, or null. */
  readonly reason: string | null;
  readonly maxTextureSize: number | null;
}

export interface WebGPUAdapterInfo {
  readonly vendor: string;
  readonly architecture: string;
  /** A software or otherwise reduced-capability adapter, such as SwiftShader. */
  readonly fallback: boolean;
}

export interface WebGPUCapability {
  readonly available: boolean;
  readonly reason: string | null;
  readonly adapter: WebGPUAdapterInfo | null;
  readonly maxTextureDimension2D: number | null;
  /** Sorted feature names the adapter offers. */
  readonly features: readonly string[];
  readonly preferredFormat: string | null;
}

export interface Capabilities {
  /** WebGPU needs a secure context (HTTPS or localhost) in production. */
  readonly secureContext: boolean;
  readonly devicePixelRatio: number;
  readonly reducedMotion: boolean;
  readonly webgl2: WebGL2Capability;
  readonly webgpu: WebGPUCapability;
}

export const webgl2Unavailable = (reason: string): WebGL2Capability => ({ available: false, reason, maxTextureSize: null });

export const webgpuUnavailable = (reason: string): WebGPUCapability => ({
  available: false, reason, adapter: null, maxTextureDimension2D: null, features: [], preferredFormat: null,
});

/** The largest texture edge the backend accepts, from its probed limits. */
export function maxTextureEdge(capabilities: Capabilities, backend: "webgl2" | "webgpu"): number | null {
  return backend === "webgl2" ? capabilities.webgl2.maxTextureSize : capabilities.webgpu.maxTextureDimension2D;
}
