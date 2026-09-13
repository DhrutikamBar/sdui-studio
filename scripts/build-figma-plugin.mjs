import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";

await mkdir("figma-plugin/dist", { recursive: true });

await build({
  entryPoints: ["figma-plugin/src/code.ts"],
  bundle: true,
  outfile: "figma-plugin/dist/code.js",
  platform: "browser",
  target: "es2020",
  format: "iife",
  loader: { ".html": "text" },
});

await copyFile("figma-plugin/src/ui.html", "figma-plugin/dist/ui.html");
