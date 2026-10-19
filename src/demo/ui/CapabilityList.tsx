import type { Capabilities } from "../../core";

/** What the probe found, from the graphics APIs themselves (never the user agent). */
export function CapabilityList({ capabilities }: { readonly capabilities: Capabilities }) {
  const { webgl2, webgpu } = capabilities;
  const adapter = webgpu.adapter;
  return (
    <dl className="diagnostics" aria-label="Capabilities">
      <dt>WebGL2</dt>
      <dd data-capability="webgl2">
        {webgl2.available ? `available, textures up to ${webgl2.maxTextureSize}px` : `unavailable: ${webgl2.reason}`}
      </dd>
      <dt>WebGPU</dt>
      <dd data-capability="webgpu">
        {webgpu.available
          ? `available on ${adapter?.vendor || "an unnamed vendor"} ${adapter?.architecture || ""}${adapter?.fallback ? " (fallback adapter)" : ""}, textures up to ${webgpu.maxTextureDimension2D}px`
          : `unavailable: ${webgpu.reason}`}
      </dd>
      <dt>Secure context</dt><dd>{capabilities.secureContext ? "yes" : "no"}</dd>
      <dt>Device pixel ratio</dt><dd>{capabilities.devicePixelRatio}</dd>
      <dt>Reduced motion</dt><dd>{capabilities.reducedMotion ? "requested" : "not requested"}</dd>
    </dl>
  );
}
