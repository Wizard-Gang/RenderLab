import type { Renderer } from "pixi.js";
import type { ActiveBackend } from "../../core";

/** Everything a backend needs to start a PixiJS renderer. */
export interface BackendSettings {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly background: number;
}

/** A running backend: its PixiJS renderer, canvas and GPU context or device, which it alone releases. */
export interface StartedBackend {
  readonly backend: ActiveBackend;
  readonly renderer: Renderer;
  readonly canvas: HTMLCanvasElement;
  /** Calls `listener` when the GPU context or device is lost for any reason except `dispose`. */
  onLost(listener: (detail: string) => void): void;
  /** Destroy the renderer and its canvas and release the GPU context or device; true once the GPU confirms it. */
  dispose(): Promise<boolean>;
}

/** PixiJS options both backends share. Antialiasing stays off so pixel art and pixel tests see exact texels. */
export const rendererOptions = (settings: BackendSettings) => ({
  width: settings.width, height: settings.height, resolution: settings.dpr, autoDensity: true, antialias: false,
  background: settings.background, backgroundAlpha: 1, clearBeforeRender: true,
});

export const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));
