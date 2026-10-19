import { describe, expect, it } from "vitest";
import { emptyDiagnostics, LifecycleError, RendererLifecycle, type LifecycleEvent, type LifecycleOperation } from "../../src/core";

const drive = (...events: LifecycleEvent[]) => {
  const lifecycle = new RendererLifecycle();
  for (const event of events) lifecycle.transition(event);
  return lifecycle;
};

const allowed = (lifecycle: RendererLifecycle) =>
  (["initialize", "mountScene", "applySceneDelta", "update", "render", "resize", "destroy"] as LifecycleOperation[])
    .filter((operation) => lifecycle.can(operation));

describe("RendererLifecycle", () => {
  it("walks the normal path and allows only what each state supports", () => {
    const lifecycle = new RendererLifecycle();
    expect(allowed(lifecycle)).toEqual(["initialize", "destroy"]);
    expect(lifecycle.transition("initialize")).toBe("initializing");
    expect(allowed(lifecycle)).toEqual(["destroy"]);
    expect(lifecycle.transition("initialized")).toBe("ready");
    expect(allowed(lifecycle)).toEqual(["mountScene", "resize", "destroy"]);
    expect(lifecycle.transition("mount")).toBe("mounted");
    expect(allowed(lifecycle)).toEqual(["mountScene", "applySceneDelta", "update", "render", "resize", "destroy"]);
    expect(lifecycle.transition("mount")).toBe("mounted");
    expect(lifecycle.transition("unmount")).toBe("ready");
    expect(lifecycle.transition("destroy")).toBe("destroyed");
    expect(allowed(lifecycle)).toEqual([]);
  });

  it("explains why an operation is refused", () => {
    expect(() => drive("initialize", "initialized").assert("render")).toThrow(new LifecycleError("cannot render while the renderer is ready: mount a scene first"));
    expect(() => new RendererLifecycle().assert("update")).toThrow(/cannot update while the renderer is created: initialize the renderer first/);
    expect(() => drive("destroy").assert("destroy")).toThrow(/cannot destroy while the renderer is destroyed/);
    expect(() => drive("initialize").transition("mount")).toThrow(/lifecycle event mount is not allowed while the renderer is initializing/);
  });

  it("returns from device loss to the state it lost, keeping resizes", () => {
    const mounted = drive("initialize", "initialized", "mount", "lose");
    expect(mounted.state).toBe("lost");
    expect(allowed(mounted)).toEqual(["resize", "destroy"]);
    expect(mounted.transition("restore")).toBe("mounted");
    expect(drive("initialize", "initialized", "lose", "restore").state).toBe("ready");
  });

  it("records why initialization or restoration failed, and then only allows destroy", () => {
    const failed = new RendererLifecycle();
    failed.transition("initialize");
    failed.transition("initialize-failed", "WebGPU adapter unavailable");
    expect([failed.state, failed.failure]).toEqual(["failed", "WebGPU adapter unavailable"]);
    expect(allowed(failed)).toEqual(["destroy"]);
    const lost = drive("initialize", "initialized", "mount", "lose");
    lost.transition("restore-failed", "context could not be restored");
    expect([lost.state, lost.failure, lost.sceneMounted]).toEqual(["failed", "context could not be restored", true]);
    expect(lost.transition("destroy")).toBe("destroyed");
    expect(lost.sceneMounted).toBe(false);
  });

  it("starts diagnostics empty, with no estimate posing as a measurement", () => {
    const diagnostics = emptyDiagnostics("auto");
    expect(diagnostics.state).toBe("created");
    expect(diagnostics.backend).toEqual({ requested: "auto", active: null, failure: null, attempts: [] });
    expect(diagnostics.capabilities).toBeNull();
    expect(diagnostics.view).toBeNull();
    expect([diagnostics.frames.fps, diagnostics.gpu.drawCalls, diagnostics.gpu.textureBytes]).toEqual([null, null, null]);
    expect([diagnostics.gpu.contexts, diagnostics.gpu.textures]).toEqual([0, 0]);
  });
});
