import { defineConfig } from "tsup";

/**
 * The `<script>` build: one self-contained, minified file (`dist/embed/stele.js`) that integrators
 * load from their Stele deployment (`/sdk/v1/stele.js`, copied there by the web app's build).
 */
export default defineConfig({
  entry: { stele: "src/embed-global.ts" },
  format: ["iife"],
  platform: "browser",
  target: "es2022",
  outDir: "dist/embed",
  outExtension: () => ({ js: ".js" }),
  tsconfig: "tsconfig.build.json",
  noExternal: [/.*/],
  minify: true,
  sourcemap: true,
  clean: true,
  dts: false,
});
