import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { backendName, type ActiveBackend, type CameraState, type RendererBackend, type RendererDiagnostics, type Viewport } from "../../core";
import { PIXI_VERSION, PixiRuntime } from "../../render";
import { BACKGROUND } from "../scenes/reference";
import { referenceTextures } from "../scenes/textures";
import { CapabilityList } from "./CapabilityList";
import { DiagnosticsList } from "./DiagnosticsList";
import { optionsFromLocation, pixelPolicy, sceneFor, VIEW_SIZES, viewSize, writeOption, type DemoOptions } from "./options";
import { useCameraInput } from "./useCameraInput";

type Status =
  | { readonly kind: "starting" }
  | { readonly kind: "running"; readonly backend: ActiveBackend }
  | { readonly kind: "stopped"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

const SCENE_LABELS: Record<DemoOptions["scene"], string> = { reference: "reference scene", grid: "pixel grid" };

function statusText(status: Status, scene: DemoOptions["scene"]): string {
  switch (status.kind) {
    case "starting":
      return "Starting the renderer…";
    case "running":
      return `Rendering the ${SCENE_LABELS[scene]} with ${backendName(status.backend)} on PixiJS ${PIXI_VERSION}.`;
    case "stopped":
      return `Rendering stopped: ${status.message}`;
    case "error":
      return status.message;
  }
}

/** Mounts the runtime on a demo scene and draws every animation frame. React never touches the scene itself. */
export function RendererView() {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<PixiRuntime | null>(null);
  const camera = useRef<CameraState | null>(null);
  const [options, setOptions] = useState<DemoOptions>(() => optionsFromLocation());
  const [status, setStatus] = useState<Status>({ kind: "starting" });
  const [diagnostics, setDiagnostics] = useState<RendererDiagnostics | null>(null);
  const [teardown, setTeardown] = useState<RendererDiagnostics | null>(null);
  const [generation, setGeneration] = useState(0);
  const size = viewSize(options.view);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const policy = useMemo(() => pixelPolicy(options.pixel), [options.pixel]);
  const viewport = useCallback((): Viewport => ({ ...sizeRef.current, dpr: window.devicePixelRatio || 1 }), []);
  const choose = (name: keyof DemoOptions, value: string) => {
    writeOption(name, value);
    setOptions((current) => ({ ...current, [name]: value }));
  };

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let active = true;
    let frame = 0;
    setStatus({ kind: "starting" });
    const scene = sceneFor(options.scene);
    const instance = new PixiRuntime({
      container, textures: referenceTextures, background: BACKGROUND, backend: options.backend, autoPreference: options.preference,
      pixelPolicy: pixelPolicy(options.pixel), viewport: viewport(),
    });
    runtime.current = instance;
    camera.current = scene.camera;
    const draw = () => {
      if (!active) return;
      try {
        instance.render(0);
        frame = requestAnimationFrame(draw);
      } catch (error) {
        setStatus({ kind: "stopped", message: describe(error) });
      }
    };
    (async () => {
      try {
        await instance.initialize();
        await instance.mountScene(scene);
        const backend = instance.getDiagnostics().backend.active;
        if (!active || !backend) return;
        setStatus({ kind: "running", backend });
        draw();
      } catch (error) {
        if (active) setStatus({ kind: "error", message: describe(error) });
      } finally {
        if (active) setDiagnostics(instance.getDiagnostics());
      }
    })();
    const poll = window.setInterval(() => setDiagnostics(instance.getDiagnostics()), 250);
    return () => {
      active = false;
      runtime.current = null;
      camera.current = null;
      cancelAnimationFrame(frame);
      window.clearInterval(poll);
      if (instance.getDiagnostics().state !== "destroyed") void instance.destroy().then(() => setTeardown(instance.getDiagnostics()));
    };
  }, [options.backend, options.preference, options.scene, options.pixel, generation, viewport]);

  // The view size and the device pixel ratio change live, through the runtime's resize.
  useEffect(() => {
    const resize = () => {
      const current = runtime.current;
      if (current?.getDiagnostics().state === "mounted") current.resize(viewport());
    };
    resize();
    const media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, [options.view, viewport]);

  const apply = useCallback((next: CameraState) => {
    const current = runtime.current;
    if (current?.getDiagnostics().state !== "mounted") return;
    camera.current = next;
    current.applySceneDelta([{ op: "set-camera", camera: next }]);
  }, []);
  const currentCamera = useCallback(() => camera.current, []);
  useCameraInput({ host, camera: currentCamera, viewport, policy, apply });

  return (
    <section className="renderer" aria-label="Demo scene">
      <div
        ref={host} className="renderer-host" data-status={status.kind} style={size} tabIndex={0}
        aria-label="Scene view: drag to pan, scroll to zoom, arrow keys and plus or minus when focused"
      />
      <p role="status">{statusText(status, options.scene)}</p>
      <div className="controls">
        <label>
          Backend{" "}
          <select value={options.backend} onChange={(event) => choose("backend", event.target.value as RendererBackend)}>
            <option value="auto">Auto (prefers {backendName(options.preference)})</option>
            <option value="webgl2">WebGL2</option>
            <option value="webgpu">WebGPU</option>
          </select>
        </label>
        <label>
          Scene{" "}
          <select value={options.scene} onChange={(event) => choose("scene", event.target.value)}>
            <option value="reference">Reference</option>
            <option value="grid">Pixel grid</option>
          </select>
        </label>
        <label>
          Pixels{" "}
          <select value={options.pixel} onChange={(event) => choose("pixel", event.target.value)}>
            <option value="smooth">Smooth</option>
            <option value="strict">Strict pixel</option>
          </select>
        </label>
        <label>
          View{" "}
          <select value={options.view} onChange={(event) => choose("view", event.target.value)}>
            {VIEW_SIZES.map((value) => <option key={value} value={value}>{value.replace("x", " × ")}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => apply(sceneFor(options.scene).camera)}>Reset view</button>
        <button type="button" onClick={() => setGeneration((value) => value + 1)}>Restart renderer</button>
      </div>
      {diagnostics && <DiagnosticsList diagnostics={diagnostics} />}
      {diagnostics?.capabilities && <CapabilityList capabilities={diagnostics.capabilities} />}
      {teardown && (
        <p data-diagnostic="teardown">
          Last teardown: {teardown.state}, {teardown.gpu.textures} textures and {teardown.gpu.contexts} graphics contexts held.
        </p>
      )}
    </section>
  );
}
