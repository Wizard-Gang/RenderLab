import type { RendererDiagnostics } from "../../core";

const round = (value: number) => Math.round(value * 1000) / 1000;

/** The runtime's diagnostics. Estimates are labelled as estimates (specification §18). */
export function DiagnosticsList({ diagnostics }: { readonly diagnostics: RendererDiagnostics }) {
  const { view, terrain } = diagnostics;
  return (
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
      <dt>Draw calls (last frame)</dt>
      <dd data-diagnostic="draw-calls">{diagnostics.gpu.drawCalls ? diagnostics.gpu.drawCalls.value : "unknown"}</dd>
      <dt>Terrain chunks</dt>
      <dd data-diagnostic="chunks">
        {terrain ? `${terrain.active} active of ${terrain.chunks}, ${terrain.resident} built (budget ${terrain.budget}), ${terrain.meshes} meshes` : "none"}
      </dd>
      <dt>Camera centre</dt>
      <dd data-diagnostic="center">{view ? `${round(view.centerX)}, ${round(view.centerY)}` : "none"}</dd>
      <dt>Zoom</dt>
      <dd data-diagnostic="zoom">{view ? `${round(view.zoom)} CSS px per world unit, ${round(view.deviceScale)} device px` : "none"}</dd>
    </dl>
  );
}
