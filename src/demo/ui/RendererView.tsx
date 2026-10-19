import { useEffect, useRef, useState } from "react";
import { backendName, type ActiveBackend, type RendererBackend, type RendererDiagnostics } from "../../core";
import { PIXI_VERSION, PixiRuntime } from "../../render";
import { BACKGROUND, REFERENCE_VIEWPORT, referenceScene } from "../scenes/reference";
import { referenceTextures } from "../scenes/textures";
import { CapabilityList } from "./CapabilityList";

type Status =
  | { readonly kind: "starting" }
  | { readonly kind: "running"; readonly backend: ActiveBackend }
  | { readonly kind: "stopped"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

const BACKENDS: readonly RendererBackend[] = ["auto", "webgl2", "webgpu"];
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** `?backend=auto|webgl2|webgpu` picks the backend and `?prefer=webgpu` makes `auto` try WebGPU first. */
function fromLocation(): { backend: RendererBackend; preference: ActiveBackend } {
  const params = new URLSearchParams(globalThis.location?.search ?? "");
  const backend = params.get("backend") as RendererBackend;
  return { backend: BACKENDS.includes(backend) ? backend : "auto", preference: params.get("prefer") === "webgpu" ? "webgpu" : "webgl2" };
}

function statusText(status: Status): string {
  switch (status.kind) {
    case "starting":
      return "Starting the renderer…";
    case "running":
      return `Rendering the reference scene with ${backendName(status.backend)} on PixiJS ${PIXI_VERSION}.`;
    case "stopped":
      return `Rendering stopped: ${status.message}`;
    case "error":
      return status.message;
  }
}

/** Mounts the runtime on the reference scene and draws every animation frame. React never touches the scene. */
export function RendererView() {
  const host = useRef<HTMLDivElement>(null);
  const [choice, setChoice] = useState(fromLocation);
  const [status, setStatus] = useState<Status>({ kind: "starting" });
  const [diagnostics, setDiagnostics] = useState<RendererDiagnostics | null>(null);
  const [teardown, setTeardown] = useState<RendererDiagnostics | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let active = true;
    let frame = 0;
    setStatus({ kind: "starting" });
    const runtime = new PixiRuntime({
      container, textures: referenceTextures, background: BACKGROUND, backend: choice.backend, autoPreference: choice.preference,
      viewport: { ...REFERENCE_VIEWPORT, dpr: window.devicePixelRatio || 1 },
    });
    const draw = () => {
      if (!active) return;
      try {
        runtime.render(0);
        frame = requestAnimationFrame(draw);
      } catch (error) {
        setStatus({ kind: "stopped", message: describe(error) });
      }
    };
    (async () => {
      try {
        await runtime.initialize();
        await runtime.mountScene(referenceScene());
        const backend = runtime.getDiagnostics().backend.active;
        if (!active || !backend) return;
        setStatus({ kind: "running", backend });
        draw();
      } catch (error) {
        if (active) setStatus({ kind: "error", message: describe(error) });
      } finally {
        if (active) setDiagnostics(runtime.getDiagnostics());
      }
    })();
    const poll = window.setInterval(() => setDiagnostics(runtime.getDiagnostics()), 250);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      window.clearInterval(poll);
      if (runtime.getDiagnostics().state !== "destroyed") {
        void runtime.destroy().then(() => setTeardown(runtime.getDiagnostics()));
      }
    };
  }, [choice, generation]);

  const choose = (backend: RendererBackend) => {
    const url = new URL(window.location.href);
    url.searchParams.set("backend", backend);
    window.history.replaceState(null, "", url);
    setChoice((current) => ({ ...current, backend }));
  };

  return (
    <section className="renderer" aria-label="Reference scene">
      <div ref={host} className="renderer-host" data-status={status.kind} style={REFERENCE_VIEWPORT} />
      <p role="status">{statusText(status)}</p>
      <div className="controls">
        <label>
          Backend{" "}
          <select value={choice.backend} onChange={(event) => choose(event.target.value as RendererBackend)}>
            <option value="auto">Auto (prefers {backendName(choice.preference)})</option>
            <option value="webgl2">WebGL2</option>
            <option value="webgpu">WebGPU</option>
          </select>
        </label>
        <button type="button" onClick={() => setGeneration((value) => value + 1)}>Restart renderer</button>
      </div>
      {diagnostics && (
        <dl className="diagnostics" aria-label="Diagnostics">
          <dt>Requested backend</dt><dd>{diagnostics.backend.requested}</dd>
          <dt>Active backend</dt><dd data-diagnostic="active">{diagnostics.backend.active ?? "none"}</dd>
          <dt>Backend attempts</dt>
          <dd data-diagnostic="attempts">
            {diagnostics.backend.attempts.map((attempt) => `${attempt.backend}: ${attempt.outcome}${attempt.reason ? ` (${attempt.reason})` : ""}`).join("; ") || "none"}
          </dd>
          <dt>State</dt><dd data-diagnostic="state">{diagnostics.state}</dd>
          <dt>Frames</dt><dd data-diagnostic="frames">{diagnostics.frames.rendered}</dd>
          <dt>Textures</dt><dd data-diagnostic="textures">{diagnostics.gpu.textures}</dd>
          <dt>Texture memory (estimated)</dt>
          <dd>{diagnostics.gpu.textureBytes ? `${diagnostics.gpu.textureBytes.value} bytes` : "unknown"}</dd>
        </dl>
      )}
      {diagnostics?.capabilities && <CapabilityList capabilities={diagnostics.capabilities} />}
      {teardown && (
        <p data-diagnostic="teardown">
          Last teardown: {teardown.state}, {teardown.gpu.textures} textures and {teardown.gpu.contexts} graphics contexts held.
        </p>
      )}
    </section>
  );
}
