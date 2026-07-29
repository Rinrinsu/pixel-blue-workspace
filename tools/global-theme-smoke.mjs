import assert from "node:assert/strict";
import { build } from "esbuild";

const result = await build({
  entryPoints: ["src/global-theme.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent"
});
const source = result.outputFiles[0].text;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const { GlobalThemeManager } = await import(moduleUrl);

class FakeClassList {
  values = new Set();

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeStyle {
  values = new Map();

  setProperty(name, value) {
    this.values.set(name, value);
  }

  removeProperty(name) {
    this.values.delete(name);
  }
}

const body = {
  classList: new FakeClassList(),
  dataset: {},
  style: new FakeStyle()
};
const manager = new GlobalThemeManager();

manager.apply(body, {
  enabled: true,
  colorScheme: "light",
  colors: {
    text: "#111111",
    muted: "#222222",
    todo: "#333333",
    doing: "#444444",
    done: "#555555",
    overdue: "#666666"
  }
});
assert.equal(body.classList.contains("vw-global-theme"), true);
assert.equal(body.dataset.vwGlobalTheme, "pixel-sky");
assert.equal(body.dataset.vwGlobalColorScheme, "light");
assert.equal(body.style.values.get("--vw-global-text"), "#111111");
assert.equal(body.style.values.get("--vw-global-accent"), "#444444");

body.classList.add("theme-dark");
manager.apply(body, {
  enabled: true,
  colorScheme: "system"
});
assert.equal(body.dataset.vwGlobalColorScheme, "dark");
assert.equal(body.style.values.has("--vw-global-text"), false);

manager.apply(body, {
  enabled: false,
  colorScheme: "light"
});
assert.equal(body.classList.contains("vw-global-theme"), false);
assert.equal("vwGlobalTheme" in body.dataset, false);
assert.equal("vwGlobalColorScheme" in body.dataset, false);
assert.equal(body.style.values.size, 0);

console.log("Global theme smoke test passed: apply, system mode, cleanup.");
