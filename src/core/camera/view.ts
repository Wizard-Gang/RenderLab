// Camera math (specification §8.4, §10): pure functions in world units, X right and Y down. The one conversion
// boundary is `computeView`: world point w lands at CSS pixel origin + w × zoom, and the renderer applies exactly that
// transform to its world container. DPR enters only through the device-pixel rules below.
import type { Vec2 } from "../contracts/values";
import type { Viewport } from "../lifecycle/runtime";
import type { CameraBounds, CameraState } from "./state";

/**
 * `smooth` keeps any zoom; with `snap`, the world origin lands on a device pixel, which stops static art shimmering
 * as the camera moves. `strict-pixel` rounds zoom × DPR to a whole number of device pixels per world unit and snaps
 * the origin, so every whole world coordinate falls exactly on a device pixel edge (uniform, square art pixels).
 */
export type PixelPolicy = { readonly mode: "smooth"; readonly snap: boolean } | { readonly mode: "strict-pixel" };

export const SMOOTH_SNAPPED: PixelPolicy = Object.freeze({ mode: "smooth", snap: true });
export const STRICT_PIXEL: PixelPolicy = Object.freeze({ mode: "strict-pixel" });

export interface CameraView {
  readonly viewport: Viewport;
  /** CSS pixels per world unit after the pixel policy. */
  readonly zoom: number;
  /** Device pixels per world unit, zoom × DPR: a whole number under `strict-pixel`. */
  readonly deviceScale: number;
  /** The world point at the viewport centre after bounds. */
  readonly centerX: number;
  readonly centerY: number;
  /** Where world (0, 0) lands, in CSS pixels from the viewport's top-left corner; device-pixel aligned when snapped. */
  readonly originX: number;
  readonly originY: number;
  /** Whether the origin and layer offsets are snapped to device pixels. */
  readonly snapped: boolean;
}

export interface ZoomLimits {
  readonly min: number;
  readonly max: number;
}

export const DEFAULT_ZOOM_LIMITS: ZoomLimits = Object.freeze({ min: 0.25, max: 16 });

const snapTo = (value: number, steps: number): number => Math.round(value * steps) / steps;

function clampAxis(center: number, half: number, min: number, max: number): number {
  return max - min <= half * 2 ? (min + max) / 2 : Math.min(max - half, Math.max(min + half, center));
}

/** The view centre after bounds: inside them on each axis, or centred on them where they are smaller than the view. */
export function clampCenter(x: number, y: number, zoom: number, viewport: Viewport, bounds: CameraBounds | null): Vec2 {
  if (!bounds) return { x, y };
  return {
    x: clampAxis(x, viewport.width / (2 * zoom), bounds.minX, bounds.maxX),
    y: clampAxis(y, viewport.height / (2 * zoom), bounds.minY, bounds.maxY),
  };
}

export function effectiveZoom(zoom: number, viewport: Viewport, policy: PixelPolicy): number {
  return policy.mode === "strict-pixel" ? Math.max(1, Math.round(zoom * viewport.dpr)) / viewport.dpr : zoom;
}

export function computeView(camera: CameraState, viewport: Viewport, policy: PixelPolicy = SMOOTH_SNAPPED): CameraView {
  const zoom = effectiveZoom(camera.zoom, viewport, policy);
  const center = clampCenter(camera.x, camera.y, zoom, viewport, camera.bounds);
  const snapped = policy.mode === "strict-pixel" || policy.snap;
  const originX = viewport.width / 2 - center.x * zoom;
  const originY = viewport.height / 2 - center.y * zoom;
  return {
    viewport, zoom, deviceScale: zoom * viewport.dpr, centerX: center.x, centerY: center.y, snapped,
    originX: snapped ? snapTo(originX, viewport.dpr) : originX,
    originY: snapped ? snapTo(originY, viewport.dpr) : originY,
  };
}

export function worldToScreen(view: CameraView, point: Vec2): Vec2 {
  return { x: view.originX + point.x * view.zoom, y: view.originY + point.y * view.zoom };
}

export function screenToWorld(view: CameraView, point: Vec2): Vec2 {
  return { x: (point.x - view.originX) / view.zoom, y: (point.y - view.originY) / view.zoom };
}

/**
 * A layer's offset from its parent, in world units, so it scrolls at `parallax` × the camera's movement: 1 moves with
 * the world, 0 stays fixed to the view. Nested layers compose: each offset is relative to its parent's parallax.
 * Snapped views round the offset to a device pixel (a whole one under `strict-pixel`).
 */
export function parallaxOffset(view: CameraView, parallax: Vec2, parent: Vec2 = { x: 1, y: 1 }): Vec2 {
  const x = view.centerX * (parent.x - parallax.x);
  const y = view.centerY * (parent.y - parallax.y);
  return view.snapped ? { x: snapTo(x, view.deviceScale), y: snapTo(y, view.deviceScale) } : { x, y };
}

/** The camera state with its centre moved inside its bounds for this viewport and policy. */
export function clampCamera(camera: CameraState, viewport: Viewport, policy: PixelPolicy = SMOOTH_SNAPPED): CameraState {
  const center = clampCenter(camera.x, camera.y, effectiveZoom(camera.zoom, viewport, policy), viewport, camera.bounds);
  return { ...camera, x: center.x, y: center.y };
}

/** Pan by a drag of `delta` CSS pixels: the world under the pointer follows it. */
export function panBy(camera: CameraState, delta: Vec2, viewport: Viewport, policy: PixelPolicy = SMOOTH_SNAPPED): CameraState {
  return clampCamera({ ...camera, x: camera.x - delta.x / camera.zoom, y: camera.y - delta.y / camera.zoom }, viewport, policy);
}

/** Zoom by `factor` about a screen point, keeping the world point under it in place. */
export function zoomAt(
  camera: CameraState, viewport: Viewport, point: Vec2, factor: number,
  limits: ZoomLimits = DEFAULT_ZOOM_LIMITS, policy: PixelPolicy = SMOOTH_SNAPPED,
): CameraState {
  const zoom = Math.min(limits.max, Math.max(limits.min, camera.zoom * factor));
  const before = screenToWorld(computeView({ ...camera, bounds: null }, viewport, { mode: "smooth", snap: false }), point);
  const x = before.x - (point.x - viewport.width / 2) / zoom;
  const y = before.y - (point.y - viewport.height / 2) / zoom;
  return clampCamera({ ...camera, zoom, x, y }, viewport, policy);
}

/** One fixed tick of smoothed following: move `smoothing` (0 to 1) of the way to the target. Deterministic per tick. */
export function followStep(camera: CameraState, target: Vec2, smoothing: number): CameraState {
  const step = Math.min(1, Math.max(0, smoothing));
  return { ...camera, x: camera.x + (target.x - camera.x) * step, y: camera.y + (target.y - camera.y) * step };
}

/** A presentation-only shake offset in world units for one tick: the same seed and tick always give the same offset. */
export function shakeOffset(seed: number, tick: number, amplitude: number): Vec2 {
  const next = (state: number) => {
    let t = (state + 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const base = (Math.imul(seed | 0, 0x9e3779b1) ^ (tick | 0)) >>> 0;
  return { x: (next(base) * 2 - 1) * amplitude, y: (next(base ^ 0x85ebca6b) * 2 - 1) * amplitude };
}
