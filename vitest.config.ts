// Unit tests only — the pure business logic in lib/ (overlap detection,
// tach/Hobbs math, checklist progress).
import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "node:url";

// Project runs as ESM ("type": "module"), so `__dirname` isn't defined here —
// derive it from this config's URL.
const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    // Mirror the "@/..." alias from tsconfig.json.
    alias: { "@": rootDir },
  },
});
