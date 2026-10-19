import { defineConfig } from "vite";

// `npm start` serves the reference application on 5184 (RigLab uses 5180 and MapLab 5182); RENDERLAB_PORT overrides it.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Each backend's PixiJS renderer is its own chunk, loaded on demand; the largest chunk, the shared application and
    // PixiJS core, is about 260 kB minified (82 kB gzip) at 8.22.0. The budget sits just above it, so growth is noticed.
    chunkSizeWarningLimit: 300,
  },
  publicDir: false,
  server: {
    port: 5184,
    strictPort: true,
  },
  preview: {
    port: 5194,
    strictPort: true,
  },
});
