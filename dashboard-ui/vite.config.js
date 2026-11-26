import { defineConfig } from "vite"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [tailwindcss()],
  define: { "process.env.NODE_ENV": '"production"' },
  oxc: { jsx: { runtime: "automatic" } },
  build: {
    emptyOutDir: false,
    outDir: "../rollout_rehearsal/dashboard_assets",
    lib: {
      entry: "src/main.tsx",
      name: "RehearsalHistory",
      formats: ["iife"],
      fileName: () => "dashboard.js",
      cssFileName: "dashboard",
    },
    license: { fileName: "dashboard.LICENSE.md" },
  },
})
