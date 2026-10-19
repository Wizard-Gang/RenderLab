import { BackendUnavailableError } from "../errors";

/**
 * Create the canvas's WebGL2 context ourselves and hand it to PixiJS, so the WebGL backend can never fall back to
 * WebGL 1. Software rasterizers are accepted (`failIfMajorPerformanceCaveat: false`): CI renders through them.
 */
export function createWebGL2Context(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  let context: RenderingContext | null = null;
  try {
    context = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: "default",
      failIfMajorPerformanceCaveat: false,
    });
  } catch (error) {
    throw new BackendUnavailableError("webgl2", `creating the context threw: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof WebGL2RenderingContext === "undefined" || !(context instanceof WebGL2RenderingContext)) {
    throw new BackendUnavailableError("webgl2", "this browser or device did not provide a WebGL2 context");
  }
  if (context.isContextLost()) throw new BackendUnavailableError("webgl2", "the new WebGL2 context was already lost");
  return context;
}
