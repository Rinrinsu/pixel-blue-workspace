import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const bundleFile = join(tmpdir(), `visual-workspace-editor-smoke-${process.pid}.mjs`);

await build({
  entryPoints: ["src/editor-model.ts"],
  outfile: bundleFile,
  bundle: true,
  platform: "node",
  format: "esm"
});

try {
  const { createDefaultEditorDocumentState, resolveAnnotation } = await import(
    `${pathToFileURL(bundleFile).href}?t=${Date.now()}`
  );
  const state = createDefaultEditorDocumentState();
  assert.equal(state.spacing, "normal");
  assert.equal(state.headingColors, "level");
  assert.deepEqual(state.comments, []);

  const comment = {
    id: "comment-1",
    quote: "需要批注的原文",
    prefix: "前文：",
    suffix: "。后文",
    note: "补充解释",
    createdAt: "2026-07-23T00:00:00.000Z",
    resolved: false
  };
  assert.equal(
    resolveAnnotation("标题\n前文：需要批注的原文。后文\n结尾", comment),
    6
  );
  assert.equal(
    resolveAnnotation("前后文已经变化，但需要批注的原文仍然存在", comment),
    9
  );
  assert.equal(resolveAnnotation("原文已经被删除", comment), -1);

  console.log("Editor model smoke test passed: defaults, anchors, orphan detection.");
} finally {
  await unlink(bundleFile).catch(() => undefined);
}
