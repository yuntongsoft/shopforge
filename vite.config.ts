import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig, type UserConfig } from "vite";

export default defineConfig({
  plugins: [
    remix({
      ignoredRouteFiles: ["**/*.css"],
    }),
  ],
  resolve: {
    alias: {
      "~": "/app",
    },
  },
  server: {
    port: Number(process.env.PORT) || 3000,
    allowedHosts: [".trycloudflare.com"],
    fs: {
      allow: ["app", "node_modules"],
    },
  },
  build: {
    assetsInlineLimit: 0,
    rollupOptions: {
      external: [
        // Optional dependencies — dynamically imported at runtime
        "ioredis",
      ],
    },
  },
} satisfies UserConfig);
