import { describe, expect, it } from "vitest";
import {
  BackendSelectionError, maxTextureEdge, planBackends, selectBackend, webgl2Unavailable, webgpuUnavailable,
  type ActiveBackend, type Capabilities,
} from "../../src/core";

const capabilities = (overrides: Partial<Capabilities> = {}): Capabilities => ({
  secureContext: true, devicePixelRatio: 2, reducedMotion: false,
  webgl2: { available: true, reason: null, maxTextureSize: 8192 },
  webgpu: {
    available: true, reason: null, adapter: { vendor: "test", architecture: "test", fallback: false },
    maxTextureDimension2D: 16384, features: [], preferredFormat: "bgra8unorm",
  },
  ...overrides,
});

/** A fake start that records the order it is called in and fails the backends named in `failing`. */
function starter(failing: Partial<Record<ActiveBackend, string>> = {}) {
  const calls: ActiveBackend[] = [];
  const start = async (backend: ActiveBackend) => {
    calls.push(backend);
    const reason = failing[backend];
    if (reason) throw Object.assign(new Error(`${backend} could not start`), { reason });
    return `${backend} renderer`;
  };
  return { calls, start };
}

describe("backend plans", () => {
  it("lets auto fall back from its preference, and never an explicit backend", () => {
    expect(planBackends("auto")).toEqual({ requested: "auto", order: ["webgl2", "webgpu"], fallback: true });
    expect(planBackends("auto", "webgpu")).toEqual({ requested: "auto", order: ["webgpu", "webgl2"], fallback: true });
    expect(planBackends("webgl2", "webgpu")).toEqual({ requested: "webgl2", order: ["webgl2"], fallback: false });
    expect(planBackends("webgpu")).toEqual({ requested: "webgpu", order: ["webgpu"], fallback: false });
  });
});

describe("backend selection", () => {
  it("starts auto's preferred backend and tries nothing else", async () => {
    const { calls, start } = starter();
    const result = await selectBackend(planBackends("auto"), capabilities(), start);
    expect([result.backend, result.value, calls]).toEqual(["webgl2", "webgl2 renderer", ["webgl2"]]);
    expect(result.attempts).toEqual([{ backend: "webgl2", outcome: "selected", reason: null }]);
  });

  it("falls back from a WebGPU failure under auto and records why", async () => {
    const { calls, start } = starter({ webgpu: "the device could not present a frame" });
    const result = await selectBackend(planBackends("auto", "webgpu"), capabilities(), start);
    expect([result.backend, calls]).toEqual(["webgl2", ["webgpu", "webgl2"]]);
    expect(result.attempts).toEqual([
      { backend: "webgpu", outcome: "failed", reason: "the device could not present a frame" },
      { backend: "webgl2", outcome: "selected", reason: null },
    ]);
  });

  it("never downgrades an explicit backend", async () => {
    const { calls, start } = starter({ webgpu: "requesting a device failed" });
    await expect(selectBackend(planBackends("webgpu"), capabilities(), start)).rejects.toThrow(
      new BackendSelectionError([{ backend: "webgpu", outcome: "failed", reason: "requesting a device failed" }]),
    );
    expect(calls).toEqual(["webgpu"]);
    await expect(selectBackend(planBackends("webgpu"), capabilities(), start)).rejects.toThrow("WebGPU failed to start: requesting a device failed");
  });

  it("skips a backend the probe found unavailable without starting it", async () => {
    const { calls, start } = starter();
    const unavailable = capabilities({ webgpu: webgpuUnavailable("no WebGPU adapter is available") });
    await expect(selectBackend(planBackends("webgpu"), unavailable, start)).rejects.toThrow("WebGPU is unavailable: no WebGPU adapter is available");
    const result = await selectBackend(planBackends("auto", "webgpu"), unavailable, start);
    expect([result.backend, calls]).toEqual(["webgl2", ["webgl2"]]);
    expect(result.attempts[0]).toEqual({ backend: "webgpu", outcome: "unavailable", reason: "no WebGPU adapter is available" });
  });

  it("names every failure when no permitted backend starts", async () => {
    const neither = capabilities({ webgl2: webgl2Unavailable("no WebGL2 context"), webgpu: webgpuUnavailable("no adapter") });
    let error: unknown;
    try {
      await selectBackend(planBackends("auto"), neither, starter().start);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(BackendSelectionError);
    expect((error as BackendSelectionError).message).toBe(
      "no permitted graphics backend could start. WebGL2 is unavailable: no WebGL2 context; WebGPU is unavailable: no adapter",
    );
    expect((error as BackendSelectionError).attempts.map((attempt) => attempt.outcome)).toEqual(["unavailable", "unavailable"]);
  });

  it("reads each backend's texture limit from its own probe", () => {
    expect([maxTextureEdge(capabilities(), "webgl2"), maxTextureEdge(capabilities(), "webgpu")]).toEqual([8192, 16384]);
    expect(maxTextureEdge(capabilities({ webgpu: webgpuUnavailable("none") }), "webgpu")).toBeNull();
  });
});
