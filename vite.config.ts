import { defineConfig } from "vite";

// `npm start` serves the reference application on 5184 (RigLab uses 5180 and MapLab 5182); RENDERLAB_PORT overrides it.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
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
