import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const bundleFile = join(tmpdir(), `visual-workspace-project-smoke-${process.pid}.mjs`);

await build({
  entryPoints: ["src/project-model.ts"],
  outfile: bundleFile,
  bundle: true,
  platform: "node",
  format: "esm"
});

try {
  const { calculateStageProgress, normalizeProjectStages } = await import(
    `${pathToFileURL(bundleFile).href}?t=${Date.now()}`
  );

  const stages = normalizeProjectStages([
    "策划",
    { id: "execution", name: "执行", progress: 55 },
    { name: "交付", progress: 140 },
    { name: "复盘", progress: -10 },
    { progress: 20 }
  ]);

  assert.equal(stages.length, 4);
  assert.deepEqual(
    stages.map((stage) => stage.progress),
    [0, 55, 100, 0]
  );
  assert.equal(calculateStageProgress(stages), 39);
  assert.equal(calculateStageProgress([]), 0);

  console.log("Project model smoke test passed: normalize, clamp, aggregate.");
} finally {
  await unlink(bundleFile).catch(() => undefined);
}
