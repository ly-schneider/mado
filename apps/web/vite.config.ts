import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.API_URL ?? "http://localhost:4100";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tauri serves the bundle from tauri://localhost, so asset paths must be relative-safe.
  base: "/",
  server: {
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(
      // /oauth/consent is an SPA route, so only the OAuth endpoints themselves are proxied.
      ["/rpc", "/mcp", "/oauth/authorize", "/oauth/token", "/oauth/register", "/oauth/revoke", "/.well-known", "/webhooks", "/export"].map((p) => [p, { target: api, changeOrigin: false }]),
    ),
  },
  build: { target: "safari16", sourcemap: true },
});
