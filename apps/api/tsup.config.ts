import { cpSync } from "node:fs";
import { defineConfig } from "tsup";

/**
 * Production bundle. Workspace packages (@stele/* and the published @stelehq/*) export TypeScript
 * sources, so they are inlined;
 * third-party dependencies stay external and are resolved from this package's node_modules at
 * runtime (every module the bundle imports is therefore a direct dependency of @stele/api). The SQL
 * migrations ship in dist/drizzle, where the inlined @stele/db looks for them.
 */
export default defineConfig({
  entry: ["src/main.ts", "src/worker-main.ts", "src/indexer-main.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  clean: true,
  sourcemap: true,
  splitting: true,
  noExternal: [/^@stele(hq)?\//],
  onSuccess: async () => {
    cpSync("../../packages/db/drizzle", "dist/drizzle", { recursive: true });
  },
});
