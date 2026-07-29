import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "node:module";

const production = process.argv[2] === "production";
const outfile = process.env.VW_BUILD_OUTFILE || "main.js";
const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`)
];
const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...nodeBuiltins],
  format: "cjs",
  target: "es2018",
  loader: { ".png": "dataurl", ".webp": "dataurl" },
  logLevel: "info",
  minify: production,
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
