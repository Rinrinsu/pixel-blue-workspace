import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const bundleFile = join(tmpdir(), `visual-workspace-juicer-review-${process.pid}.mjs`);

await build({
  entryPoints: ["src/juicer-review-model.ts"],
  outfile: bundleFile,
  bundle: true,
  platform: "node",
  format: "esm"
});

try {
  const {
    composeAcceptedReviewBody,
    createJuicerReviewComparison,
    decisionsFromComparison,
    stripMarkdownFrontmatter
  } = await import(`${pathToFileURL(bundleFile).href}?t=${Date.now()}`);

  const source = `---
type: raw
---

# 原料

写作之前先明确读者，再整理三个核心观点。

发布后记录反馈，并在一周后复盘。`;
  const review = `---
type: juicer-review
source: Juicer/Raw/原料.md
---

# 写作复盘方法

## 核心结论

写作前先明确读者，并提炼三个核心观点。

## 执行步骤

1. 发布后记录反馈。

2. 一周后完成复盘。

## 来源

- [[Juicer/Raw/原料]]`;

  assert.ok(stripMarkdownFrontmatter(source).startsWith("# 原料"));
  const comparison = createJuicerReviewComparison(
    "Juicer/Raw/原料.md",
    source,
    review
  );
  assert.equal(comparison.blocks.length, 4);
  assert.equal(comparison.blocks.at(-1)?.selectable, false);
  assert.ok(comparison.blocks[0]?.sourceText?.includes("明确读者"));
  assert.ok(comparison.blocks[0]?.draftDiff.some((segment) => segment.kind === "added"));

  const decisions = decisionsFromComparison(comparison);
  decisions[comparison.blocks[1].id] = false;
  const accepted = composeAcceptedReviewBody(comparison, decisions);
  assert.ok(accepted.includes("## 核心结论"));
  assert.ok(accepted.includes("## 执行步骤"));
  assert.ok(!accepted.includes("发布后记录反馈"));
  assert.ok(accepted.includes("一周后完成复盘"));
  assert.ok(accepted.includes("## 来源"));

  console.log("Juicer review smoke test passed: compare, decide, compose.");
} finally {
  await unlink(bundleFile).catch(() => undefined);
}
