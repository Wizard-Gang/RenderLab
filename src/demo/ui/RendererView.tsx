import { useEffect, useRef, useState } from "react";
import type { RendererDiagnostics } from "../../core";
import { PIXI_VERSION, PixiWebGL2Runtime } from "../../render";
import { BACKGROUND, REFERENCE_VIEWPORT, referenceScene } from "../scenes/reference";
import { referenceTextures } from "../scenes/textures";

type Status =
  | { readonly kind: "starting" }
  | { readonly kind: "running" }
  | { readonly kind: "stopped"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

function statusText(status: Status): string {
  switch (status.kind) {
    case "starting":
      return "Starting WebGL2…";
    case "running":
      return `Rendering the reference scene with WebGL2 on PixiJS ${PIXI_VERSION}.`;
    case "stopped":
      return `Rendering stopped: ${status.message}`;
    case "error":
      return status.message;
  }
}

/** Mounts the WebGL2 runtime on the reference scene and draws every animation frame. React never touches the scene. */
export function RendererView() {
  const host = useRef<HTMLDivElement>(null);
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
    const runtime = new PixiWebGL2Runtime({
      container, textures: referenceTextures, background: BACKGROUND,
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
        if (!active) return;
        setStatus({ kind: "running" });
        draw();
      } catch (error) {
        if (active) setStatus({ kind: "error", message: describe(error) });
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
  }, [generation]);

  return (
    <section className="renderer" aria-label="Reference scene">
      <div ref={host} className="renderer-host" data-status={status.kind} style={REFERENCE_VIEWPORT} />
      <p role="status">{statusText(status)}</p>
      <button type="button" onClick={() => setGeneration((value) => value + 1)}>Restart renderer</button>
      {diagnostics && (
        <dl className="diagnostics" aria-label="Diagnostics">
          <dt>Backend</dt><dd>{diagnostics.backend.active ?? "none"}</dd>
          <dt>State</dt><dd data-diagnostic="state">{diagnostics.state}</dd>
          <dt>Frames</dt><dd data-diagnostic="frames">{diagnostics.frames.rendered}</dd>
          <dt>Textures</dt><dd data-diagnostic="textures">{diagnostics.gpu.textures}</dd>
          <dt>Texture memory (estimated)</dt>
          <dd>{diagnostics.gpu.textureBytes ? `${diagnostics.gpu.textureBytes.value} bytes` : "unknown"}</dd>
        </dl>
      )}
      {teardown && (
        <p data-diagnostic="teardown">
          Last teardown: {teardown.state}, {teardown.gpu.textures} textures and {teardown.gpu.contexts} graphics contexts held.
        </p>
      )}
    </section>
  );
}
