import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "esnext",
    minify: "esbuild",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          tauri: [
            "@tauri-apps/api",
            "@tauri-apps/plugin-dialog",
            "@tauri-apps/plugin-http",
            "@tauri-apps/plugin-sql",
          ],
          db: ["drizzle-orm"],
          icons: ["lucide-svelte"],
          markdown: ["marked", "dompurify", "highlight.js"],
          utils: ["ical.js"],
        },
      },
    },
  },
});
