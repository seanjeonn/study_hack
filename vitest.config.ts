import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // WORKSPACE_ROOT is read at module load, so the temp workspace has to be
    // set before any lib/server import — a setup file, not a beforeAll hook.
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,
    alias: {
      "@": root, // no trailing slash — prefix replacement
      // lib/server/* import "server-only", which throws outside a React
      // Server Component. Point it at an empty module for tests.
      "server-only": path.join(root, "tests/stubs/server-only.ts"),
    },
  },
});
