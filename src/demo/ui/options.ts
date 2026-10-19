// The reference application's choices, read from and written back to the URL so every view is linkable and the
// browser tests can open one directly: ?backend= &prefer= &scene= &pixel= &view=
import { SMOOTH_SNAPPED, STRICT_PIXEL, type ActiveBackend, type PixelPolicy, type RendererBackend, type SceneDefinition } from "../../core";
import { gridScene } from "../scenes/grid";
import { referenceScene } from "../scenes/reference";

export const BACKENDS: readonly RendererBackend[] = ["auto", "webgl2", "webgpu"];
export const SCENES = Object.freeze({ reference: referenceScene, grid: gridScene });
export const VIEW_SIZES = Object.freeze(["480x270", "640x360", "320x180"] as const);

export type SceneName = keyof typeof SCENES;
export type ViewSize = (typeof VIEW_SIZES)[number];

export interface DemoOptions {
  readonly backend: RendererBackend;
  readonly preference: ActiveBackend;
  readonly scene: SceneName;
  readonly pixel: "smooth" | "strict";
  readonly view: ViewSize;
}

export function optionsFromLocation(search = globalThis.location?.search ?? ""): DemoOptions {
  const params = new URLSearchParams(search);
  const pick = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
    const value = params.get(name) as T;
    return allowed.includes(value) ? value : fallback;
  };
  return {
    backend: pick("backend", BACKENDS, "auto"),
    preference: pick<ActiveBackend>("prefer", ["webgl2", "webgpu"], "webgl2"),
    scene: pick<SceneName>("scene", ["reference", "grid"], "reference"),
    pixel: pick<"smooth" | "strict">("pixel", ["smooth", "strict"], "smooth"),
    view: pick<ViewSize>("view", VIEW_SIZES, "480x270"),
  };
}

export function writeOption(name: keyof DemoOptions, value: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(name === "preference" ? "prefer" : name, value);
  window.history.replaceState(null, "", url);
}

export function viewSize(view: ViewSize): { readonly width: number; readonly height: number } {
  const [width, height] = view.split("x").map(Number);
  return { width, height };
}

export const pixelPolicy = (pixel: DemoOptions["pixel"]): PixelPolicy => (pixel === "strict" ? STRICT_PIXEL : SMOOTH_SNAPPED);
export const sceneFor = (name: SceneName): SceneDefinition => SCENES[name]();
