import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const bundleFile = join(tmpdir(), `visual-workspace-search-smoke-${process.pid}.mjs`);

await build({
  entryPoints: ["src/search-service.ts"],
  outfile: bundleFile,
  bundle: true,
  platform: "node",
  format: "esm"
});

try {
  const { SearchService, SearchSyntaxError } = await import(
    `${pathToFileURL(bundleFile).href}?t=${Date.now()}`
  );
  const files = [
    {
      path: "Knowledge/Learning/检索方法.md",
      basename: "检索方法",
      stat: { mtime: new Date("2026-07-20T12:00:00").getTime() }
    },
    {
      path: "Knowledge/Work/项目计划.md",
      basename: "项目计划",
      stat: { mtime: new Date("2026-06-20T12:00:00").getTime() }
    },
    {
      path: "Knowledge/Life/阅读清单.md",
      basename: "阅读清单",
      stat: { mtime: new Date("2026-07-21T12:00:00").getTime() }
    }
  ];
  const contents = new Map([
    [files[0], "# 检索方法\n明确关键词和条件可以提高检索准确性。"],
    [files[1], "# 项目计划\n拆分目标、里程碑和下一步行动。"],
    [files[2], "# 阅读清单\n记录待读书目和简短说明。"]
  ]);
  const caches = new Map([
    [files[0], {
      frontmatter: {
        title: "检索方法",
        tags: ["学习", "检索"],
        status: "doing",
        type: "knowledge"
      },
      headings: [{ heading: "检索方法", level: 1 }],
      tags: [{ tag: "#检索" }]
    }],
    [files[1], {
      frontmatter: {
        title: "项目计划",
        tags: ["工作", "计划"],
        status: "done",
        type: "knowledge"
      },
      headings: [{ heading: "项目计划", level: 1 }],
      tags: [{ tag: "#计划" }]
    }],
    [files[2], {
      frontmatter: {
        title: "阅读清单",
        tags: ["生活", "阅读"],
        status: "doing",
        type: "knowledge"
      },
      headings: [{ heading: "阅读清单", level: 1 }],
      tags: [{ tag: "#阅读" }]
    }]
  ]);
  const app = {
    vault: {
      getMarkdownFiles: () => files,
      cachedRead: async (file) => contents.get(file) ?? ""
    },
    metadataCache: {
      getFileCache: (file) => caches.get(file)
    }
  };
  const service = new SearchService(app);

  const exact = await service.search(
    "title:\"检索方法\" AND tag:#检索 NOT status:done",
    "exact"
  );
  assert.deepEqual(exact.map((result) => result.file.basename), ["检索方法"]);

  const grouped = await service.search(
    "(tag:#生活 OR tag:#阅读) AND after:2026-07-01",
    "exact"
  );
  assert.deepEqual(grouped.map((result) => result.file.basename), ["阅读清单"]);

  const learning = await service.search("关键词 准确性", "relevance");
  assert.equal(learning[0]?.file.basename, "检索方法");
  assert.ok(learning[0]?.reasons.some((reason) => reason.includes("正文")));

  const planning = await service.search("目标 里程碑", "relevance");
  assert.equal(planning[0]?.file.basename, "项目计划");

  await assert.rejects(
    () => service.search("(tag:#生活 OR tag:#阅读", "exact"),
    SearchSyntaxError
  );

  console.log("Search smoke test passed: exact, boolean, date, relevance, Chinese.");
} finally {
  await unlink(bundleFile).catch(() => undefined);
}
