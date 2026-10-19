// The reference application's shell. React owns application UI only; scenes are drawn by the renderer, never as one
// React component per tile, sprite or particle (specification §7).
export function App() {
  return (
    <main className="shell">
      <h1>RenderLab</h1>
      <p>GPU-native 2D rendering for MapLab worlds and RigLab characters on PixiJS v8, through WebGL2 and WebGPU.</p>
      <p role="status">Repository bootstrap: no renderer is mounted yet.</p>
    </main>
  );
}
