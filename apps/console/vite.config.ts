import { defineConfig } from "vite";
export default defineConfig({
  root: "apps/console",
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:7860" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
