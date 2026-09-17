/**
 * File: vitest.config.ts
 * Purpose: Vitest configuration — separate from vite.config.ts to avoid Remix plugin conflicts
 */
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "app"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["app/utils/**/*.ts", "app/services/**/*.ts", "app/demo/**/*.ts"],
      exclude: ["tests/**", "**/*.d.ts"],
    },
  },
});
