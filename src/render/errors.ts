import type { ActiveBackend } from "../core";

/** The requested graphics backend cannot run here. The message says why, so the UI can show it instead of a blank canvas. */
export class BackendUnavailableError extends Error {
  readonly backend: ActiveBackend;
  readonly reason: string;

  constructor(backend: ActiveBackend, reason: string) {
    super(`${backend === "webgl2" ? "WebGL2" : "WebGPU"} is unavailable: ${reason}`);
    this.name = "BackendUnavailableError";
    this.backend = backend;
    this.reason = reason;
  }
}

/** The scene asks for presentation this renderer does not provide yet. Nothing is drawn partially or silently dropped. */
export class UnsupportedSceneError extends Error {
  readonly unsupported: readonly string[];

  constructor(unsupported: readonly string[]) {
    super(`this renderer cannot present:\n- ${unsupported.join("\n- ")}`);
    this.name = "UnsupportedSceneError";
    this.unsupported = Object.freeze([...unsupported]);
  }
}
