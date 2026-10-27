// Counts the draw calls a PixiJS renderer actually issues (specification §15.1: measure draws, never assume a batch is
// one). WebGL2 routes every draw, batched or not, through its geometry system; WebGPU's batcher calls the render pass
// encoder directly, so each pass encoder is wrapped as the encoder system begins it. Render bundles are not counted.
import type { Renderer, WebGLRenderer, WebGPURenderer } from "pixi.js";

type Draw = (...args: never[]) => unknown;

function wrap<T extends object, K extends keyof T>(target: T, key: K, onDraw: () => void): void {
  const original = target[key] as Draw;
  (target as Record<K, Draw>)[key] = (...args: never[]) => {
    onDraw();
    return original.apply(target, args);
  };
}

/** Call `onDraw` once per draw call the renderer issues from now on. */
export function countDrawCalls(renderer: Renderer, onDraw: () => void): void {
  if (renderer.name === "webgl") {
    wrap((renderer as WebGLRenderer).geometry, "draw", onDraw);
    return;
  }
  const encoder = (renderer as WebGPURenderer).encoder;
  const counted = new WeakSet<object>();
  const begin = encoder.beginRenderPass.bind(encoder);
  encoder.beginRenderPass = (target) => {
    const pass = begin(target);
    if (!counted.has(pass)) {
      counted.add(pass);
      for (const key of ["draw", "drawIndexed", "drawIndirect", "drawIndexedIndirect"] as const) wrap(pass, key, onDraw);
    }
    return pass;
  };
}
