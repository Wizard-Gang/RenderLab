import { describe, expect, it } from "vitest";
import {
  clampCamera, computeView, followStep, panBy, parallaxOffset, screenToWorld, shakeOffset, SMOOTH_SNAPPED, STRICT_PIXEL,
  worldToScreen, zoomAt, type CameraState, type PixelPolicy, type Viewport,
} from "../../src/core";
import { prng } from "./fixtures";

const camera = (extra: Partial<CameraState> = {}): CameraState => ({ x: 100, y: 50, zoom: 2, bounds: null, ...extra });
const viewport = (width = 480, height = 270, dpr = 1): Viewport => ({ width, height, dpr });
const SMOOTH: PixelPolicy = { mode: "smooth", snap: false };
const isWhole = (value: number) => Math.abs(value - Math.round(value)) < 1e-9;

describe("camera views", () => {
  it("puts the camera centre in the middle of the viewport", () => {
    const view = computeView(camera(), viewport(), SMOOTH);
    expect(worldToScreen(view, { x: 100, y: 50 })).toEqual({ x: 240, y: 135 });
    expect([view.originX, view.originY, view.zoom, view.deviceScale]).toEqual([40, 35, 2, 2]);
  });

  it("round-trips screen and world points across zooms, DPRs and policies", () => {
    const random = prng(5184);
    for (let trial = 0; trial < 500; trial += 1) {
      const policy = [SMOOTH, SMOOTH_SNAPPED, STRICT_PIXEL][trial % 3];
      const vp = viewport(200 + random() * 1800, 150 + random() * 1000, [1, 1.25, 1.5, 2, 3][trial % 5]);
      const view = computeView(camera({ x: random() * 4000 - 2000, y: random() * 4000 - 2000, zoom: 0.25 + random() * 8 }), vp, policy);
      const point = { x: random() * vp.width, y: random() * vp.height };
      const back = worldToScreen(view, screenToWorld(view, point));
      expect(Math.abs(back.x - point.x) + Math.abs(back.y - point.y)).toBeLessThan(1e-9 * Math.max(1, vp.width));
    }
  });

  it("under strict-pixel, uses whole device pixels per world unit and lands whole world coordinates on device pixel edges", () => {
    const random = prng(10);
    for (let trial = 0; trial < 500; trial += 1) {
      const vp = viewport(320 + Math.floor(random() * 1600), 180 + Math.floor(random() * 900), [1, 1.25, 1.5, 2, 2.625, 3][trial % 6]);
      const view = computeView(camera({ x: random() * 1000 - 500, y: random() * 1000 - 500, zoom: 0.1 + random() * 6 }), vp, STRICT_PIXEL);
      expect(isWhole(view.deviceScale) && view.deviceScale >= 1).toBe(true);
      const whole = { x: Math.floor(random() * 200) - 100, y: Math.floor(random() * 200) - 100 };
      const screen = worldToScreen(view, whole);
      expect(isWhole(screen.x * vp.dpr) && isWhole(screen.y * vp.dpr)).toBe(true);
    }
    expect(computeView(camera({ zoom: 2.6 }), viewport(480, 270, 1), STRICT_PIXEL).deviceScale).toBe(3);
    expect(computeView(camera({ zoom: 2.6 }), viewport(480, 270, 2), STRICT_PIXEL).deviceScale).toBe(5);
    expect(computeView(camera({ zoom: 0.2 }), viewport(480, 270, 1), STRICT_PIXEL).deviceScale).toBe(1);
  });

  it("snaps only the origin when smooth and snapped, keeping the zoom", () => {
    const view = computeView(camera({ x: 10.3, zoom: 2.6 }), viewport(480, 270, 2), SMOOTH_SNAPPED);
    expect(view.zoom).toBe(2.6);
    expect(isWhole(view.originX * 2) && isWhole(view.originY * 2)).toBe(true);
    expect(computeView(camera({ x: 10.3, zoom: 2.6 }), viewport(480, 270, 2), SMOOTH).originX).toBeCloseTo(240 - 10.3 * 2.6, 12);
  });

  it("keeps the view inside its bounds at every aspect ratio, centring where the bounds are smaller", () => {
    const random = prng(77);
    const bounds = { minX: -300, minY: -100, maxX: 900, maxY: 500 };
    for (let trial = 0; trial < 500; trial += 1) {
      const vp = viewport(100 + random() * 2000, 100 + random() * 2000, 1 + Math.floor(random() * 3));
      const policy = trial % 2 ? STRICT_PIXEL : SMOOTH_SNAPPED;
      const view = computeView(camera({ x: random() * 4000 - 2000, y: random() * 4000 - 2000, zoom: 0.2 + random() * 5, bounds }), vp, policy);
      const topLeft = screenToWorld(view, { x: 0, y: 0 });
      const bottomRight = screenToWorld(view, { x: vp.width, y: vp.height });
      const slack = 1 / view.deviceScale + 1e-9;
      for (const [low, high, min, max] of [[topLeft.x, bottomRight.x, bounds.minX, bounds.maxX], [topLeft.y, bottomRight.y, bounds.minY, bounds.maxY]]) {
        if (high - low <= max - min) expect(low >= min - slack && high <= max + slack).toBe(true);
        else expect(Math.abs((low + high) / 2 - (min + max) / 2)).toBeLessThan(slack);
      }
    }
  });
});

describe("camera controls", () => {
  it("pans so the world under the pointer follows it, within bounds", () => {
    expect(panBy(camera(), { x: 20, y: -10 }, viewport(), SMOOTH)).toEqual(camera({ x: 90, y: 55 }));
    const bounded = camera({ bounds: { minX: 0, minY: 0, maxX: 480, maxY: 270 }, zoom: 1, x: 240, y: 135 });
    expect(panBy(bounded, { x: 500, y: 0 }, viewport(), SMOOTH)).toEqual(bounded);
  });

  it("zooms about a screen point, keeping the world point under it in place", () => {
    const vp = viewport(480, 270, 2);
    const before = computeView(camera(), vp, SMOOTH);
    const point = { x: 400, y: 60 };
    const anchor = screenToWorld(before, point);
    const zoomed = zoomAt(camera(), vp, point, 1.5, { min: 0.25, max: 16 }, SMOOTH);
    expect(zoomed.zoom).toBe(3);
    const after = screenToWorld(computeView(zoomed, vp, SMOOTH), point);
    expect(after.x).toBeCloseTo(anchor.x, 9);
    expect(after.y).toBeCloseTo(anchor.y, 9);
    expect(zoomAt(camera(), vp, point, 100).zoom).toBe(16);
  });

  it("clamps a stored camera into its bounds", () => {
    expect(clampCamera(camera({ x: -50, y: 9999, zoom: 1, bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 } }), viewport(), SMOOTH))
      .toMatchObject({ x: 240, y: 865 });
  });

  it("follows a target smoothly, one deterministic fixed tick at a time", () => {
    let state = camera({ x: 0, y: 0 });
    for (let tick = 0; tick < 60; tick += 1) state = followStep(state, { x: 100, y: -40 }, 0.1);
    expect(state.x).toBeCloseTo(100 * (1 - 0.9 ** 60), 9);
    expect(state.y).toBeCloseTo(-40 * (1 - 0.9 ** 60), 9);
    expect(followStep(camera(), { x: 0, y: 0 }, 1)).toMatchObject({ x: 0, y: 0 });
  });

  it("shakes deterministically within its amplitude", () => {
    expect(shakeOffset(7, 120, 4)).toEqual(shakeOffset(7, 120, 4));
    expect(shakeOffset(7, 121, 4)).not.toEqual(shakeOffset(7, 120, 4));
    for (let tick = 0; tick < 1000; tick += 1) {
      const offset = shakeOffset(3, tick, 2.5);
      expect(Math.abs(offset.x) <= 2.5 && Math.abs(offset.y) <= 2.5).toBe(true);
    }
  });
});

describe("parallax", () => {
  it("offsets a layer by the camera movement it does not follow, composing through parents", () => {
    const view = computeView(camera({ x: 200, y: 100 }), viewport(), SMOOTH);
    expect(parallaxOffset(view, { x: 1, y: 1 })).toEqual({ x: 0, y: 0 });
    expect(parallaxOffset(view, { x: 0.5, y: 0.25 })).toEqual({ x: 100, y: 75 });
    expect(parallaxOffset(view, { x: 0.25, y: 0 }, { x: 0.5, y: 0.25 })).toEqual({ x: 50, y: 25 });
  });

  it("snaps offsets to whole device pixels under strict-pixel", () => {
    const view = computeView(camera({ x: 200.37, y: 100.11, zoom: 2.6 }), viewport(480, 270, 2), STRICT_PIXEL);
    const offset = parallaxOffset(view, { x: 0.3, y: 0.7 });
    expect(isWhole(offset.x * view.deviceScale) && isWhole(offset.y * view.deviceScale)).toBe(true);
  });
});
