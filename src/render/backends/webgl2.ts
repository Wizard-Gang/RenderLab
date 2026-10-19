import { WebGLRenderer } from "pixi.js";
import { BackendUnavailableError } from "../errors";
import { describe, rendererOptions, type BackendSettings, type StartedBackend } from "./started";
import { createWebGL2Context, releaseContext } from "./webgl2-context";

export async function startWebGL2(settings: BackendSettings): Promise<StartedBackend> {
  const canvas = document.createElement("canvas");
  const gl = createWebGL2Context(canvas);
  const renderer = new WebGLRenderer();
  try {
    await renderer.init({ canvas, context: gl, ...rendererOptions(settings) });
    if (renderer.context.webGLVersion !== 2) throw new BackendUnavailableError("webgl2", `PixiJS initialized WebGL ${renderer.context.webGLVersion}`);
  } catch (error) {
    try {
      renderer.destroy({ removeView: true });
    } catch {
      // A renderer that failed part-way through init may not tear down cleanly; its context is released below.
    }
    releaseContext(gl);
    throw error instanceof BackendUnavailableError ? error : new BackendUnavailableError("webgl2", describe(error));
  }
  let disposed = false;
  return {
    backend: "webgl2",
    renderer,
    canvas,
    onLost(listener) {
      canvas.addEventListener("webglcontextlost", () => {
        if (!disposed) listener("the WebGL2 context was lost");
      });
    },
    async dispose() {
      disposed = true;
      renderer.destroy({ removeView: true });
      canvas.remove();
      return releaseContext(gl);
    },
  };
}
