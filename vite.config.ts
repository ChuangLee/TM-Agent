import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  root: "src/frontend",
  // Production build: relative asset URLs (`./assets/...`) so they resolve
  // against whatever `<base href>` the backend injects at serve time —
  // subpath reverse-proxy deploys rely on this (ADR-0018). Dev: keep root
  // so Vite's HMR and `/api` / `/ws` proxy keep working unchanged.
  base: command === "build" ? "./" : "/",
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src/frontend"),
      "@shared": path.resolve(process.cwd(), "src/shared")
    }
  },
  build: {
    outDir: path.resolve(process.cwd(), "dist/frontend"),
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: "http://localhost:8767",
        ws: true
      },
      "/api": {
        target: "http://localhost:8767"
      }
    }
  }
}));
