import type { Rasterizer, RasterizeRequest } from "./rasterizer";

// The browser's own SVG renderer, through a 2D canvas. It is the React-and-TypeScript-only candidate the specification
// names; it needs no dependency, and its output is deterministic for one engine and version, not across engines.

/**
 * Draws one prepared SVG at 1:1 and reads back its pixels. It is self-contained (no imports, no module state), so the
 * browser suite can evaluate this exact function in Chromium and WebKit.
 */
export async function rasterizeSvgInBrowser(request: { svg: string; width: number; height: number }): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([request.svg], { type: "image/svg+xml" }));
  try {
    const image = new Image(request.width, request.height);
    image.src = url;
    await image.decode();
    const canvas = typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(request.width, request.height)
      : Object.assign(document.createElement("canvas"), { width: request.width, height: request.height });
    // willReadFrequently keeps the canvas on the CPU, so readback is not subject to GPU compositing differences.
    const context = canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" }) as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!context) throw new Error("2D canvas is unavailable");
    context.clearRect(0, 0, request.width, request.height);
    context.drawImage(image, 0, 0, request.width, request.height);
    const pixels = context.getImageData(0, 0, request.width, request.height).data;
    return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The browser rasterizer. `environment` is the caller's declaration (engine and version), recorded in the manifest. */
export function browserRasterizer(environment: string): Rasterizer {
  return {
    identity: { name: "browser-canvas-2d", version: "1", environment },
    rasterize: async (request: RasterizeRequest) => ({
      width: request.width, height: request.height, data: await rasterizeSvgInBrowser(request),
    }),
  };
}
