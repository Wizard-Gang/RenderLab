import { defineConfig } from "vite";

// `npm start` serves the reference application on 5184 (RigLab uses 5180 and MapLab 5182); RENDERLAB_PORT overrides it.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // PixiJS v8 makes the main chunk about 554 kB minified (165 kB gzip) at 8.22.0. The budget sits just above it, so
    // growth past it is noticed instead of the warning being noise.
    chunkSizeWarningLimit: 600,
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
