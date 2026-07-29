import {
  App,
  normalizePath,
  stringifyYaml,
  TFile
} from "obsidian";
import { JuicerDraft } from "./types";
import {
  composeAcceptedReviewBody,
  createJuicerReviewComparison,
  JuicerReviewComparison,
  JuicerReviewDecisions
} from "./juicer-review-model";
import { toUnknownRecord, UnknownRecord } from "./type-guards";

export interface JuicerReviewMetadata {
  platforms: string[];
  categories: string[];
  tags: string[];
  bodyReviewStatus: "pending" | "reviewed";
  acceptedBlocks: number;
  rejectedBlocks: number;
}

export class JuicerService {
  constructor(private app: App) {}

  async createReview(
    reviewFolder: string,
    source: TFile,
    draft: JuicerDraft
  ): Promise<TFile> {
    const folder = normalizePath(reviewFolder);
    await this.ensureFolder(folder);
    const path = this.availableMarkdownPath(folder, draft.title);
    const frontmatter = {
      type: "juicer-review",
      status: "review",
      title: draft.title,
      source: source.path,
      platforms: draft.platformSuggestions,
      categories: draft.categorySuggestions,
      tags: draft.tags,
      confidence: draft.confidence,
      bodyReviewStatus: "pending",
      createdAt: new Date().toISOString()
    };
    const content = [
      "---",
      stringifyYaml(frontmatter).trimEnd(),
      "---",
      "",
      `# ${draft.title}`,
      "",
      "## 核心结论",
      "",
      draft.core,
      "",
      "## 摘要",
      "",
      draft.summary,
      "",
      ...markdownListSection("关键点", draft.keyPoints),
      ...markdownListSection("执行步骤", draft.steps, true),
      ...markdownListSection("评论与补充洞察", draft.commentInsights),
      ...markdownListSection("风险与待核实", draft.warnings),
      "## 来源",
      "",
      `- [[${source.path.replace(/\.md$/i, "")}]]`,
      ""
    ].join("\n");
    const review = await this.app.vault.create(path, content);
    await this.app.fileManager.processFrontMatter(source, (sourceFrontmatter: UnknownRecord) => {
      sourceFrontmatter.juicerStatus = "processed";
      sourceFrontmatter.reviewFile = review.path;
      sourceFrontmatter.processedAt = new Date().toISOString();
    });
    return review;
  }

  getReviewMetadata(file: TFile): JuicerReviewMetadata {
    const frontmatter = toUnknownRecord(
      this.app.metadataCache.getFileCache(file)?.frontmatter
    );
    return {
      platforms: toStringArray(frontmatter.platforms),
      categories: toStringArray(frontmatter.categories),
      tags: toStringArray(frontmatter.tags),
      bodyReviewStatus: frontmatter.bodyReviewStatus === "reviewed"
        ? "reviewed"
        : "pending",
      acceptedBlocks: toNonNegativeInteger(frontmatter.acceptedBlocks),
      rejectedBlocks: toNonNegativeInteger(frontmatter.rejectedBlocks)
    };
  }

  async updateReviewMetadata(
    file: TFile,
    metadata: JuicerReviewMetadata
  ): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter: UnknownRecord) => {
      frontmatter.platforms = metadata.platforms;
      frontmatter.categories = metadata.categories;
      frontmatter.tags = metadata.tags;
    });
  }

  async getReviewComparison(file: TFile): Promise<JuicerReviewComparison> {
    const reviewContent = await this.app.vault.cachedRead(file);
    const frontmatter = toUnknownRecord(
      this.app.metadataCache.getFileCache(file)?.frontmatter
    );
    const sourcePath = String(frontmatter.source ?? "");
    const source = sourcePath
      ? this.app.vault.getAbstractFileByPath(normalizePath(sourcePath))
      : undefined;
    const sourceContent = source instanceof TFile
      ? await this.app.vault.cachedRead(source)
      : "";
    return createJuicerReviewComparison(
      sourcePath,
      sourceContent,
      reviewContent,
      toReviewDecisions(frontmatter.reviewDecisions)
    );
  }

  async updateReviewDecisions(
    file: TFile,
    comparison: JuicerReviewComparison,
    decisions: JuicerReviewDecisions
  ): Promise<void> {
    const selectable = comparison.blocks.filter((block) => block.selectable);
    const acceptedBlocks = selectable.filter((block) => decisions[block.id] !== false).length;
    const rejectedBlocks = selectable.length - acceptedBlocks;
    await this.app.fileManager.processFrontMatter(file, (frontmatter: UnknownRecord) => {
      frontmatter.reviewDecisions = decisions;
      frontmatter.bodyReviewStatus = "reviewed";
      frontmatter.acceptedBlocks = acceptedBlocks;
      frontmatter.rejectedBlocks = rejectedBlocks;
      frontmatter.bodyReviewedAt = new Date().toISOString();
    });
  }

  async approveReview(file: TFile, knowledgeFolder: string): Promise<TFile> {
    const frontmatter = toUnknownRecord(
      this.app.metadataCache.getFileCache(file)?.frontmatter
    );
    const categories = toStringArray(frontmatter.categories);
    const category = safePathSegment(categories[0] ?? "未分类");
    const folder = normalizePath(`${knowledgeFolder.replace(/\/$/, "")}/${category}`);
    await this.ensureFolder(folder);
    const comparison = await this.getReviewComparison(file);
    const decisions = toReviewDecisions(frontmatter.reviewDecisions);
    const acceptedBody = composeAcceptedReviewBody(comparison, decisions);
    await this.app.vault.process(
      file,
      (currentContent) => replaceMarkdownBody(currentContent, acceptedBody)
    );
    await this.app.fileManager.processFrontMatter(file, (next: UnknownRecord) => {
      next.type = "knowledge";
      next.status = "done";
      next.reviewedAt = new Date().toISOString();
      delete next.reviewDecisions;
      delete next.bodyReviewStatus;
      delete next.acceptedBlocks;
      delete next.rejectedBlocks;
      delete next.bodyReviewedAt;
    });
    const targetPath = this.availableMarkdownPath(
      folder,
      String(frontmatter.title ?? file.basename)
    );
    await this.app.fileManager.renameFile(file, targetPath);
    const moved = this.app.vault.getAbstractFileByPath(targetPath);
    if (!(moved instanceof TFile)) throw new Error("入库后未找到目标文件");
    return moved;
  }

  private async ensureFolder(folder: string): Promise<void> {
    const parts = normalizePath(folder).split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private availableMarkdownPath(folder: string, title: string): string {
    const safeTitle = safePathSegment(title) || "未命名知识";
    let suffix = 0;
    while (true) {
      const name = suffix ? `${safeTitle} ${suffix + 1}` : safeTitle;
      const path = normalizePath(`${folder}/${name}.md`);
      if (!this.app.vault.getAbstractFileByPath(path)) return path;
      suffix += 1;
    }
  }
}

function markdownListSection(
  title: string,
  values: string[],
  ordered = false
): string[] {
  if (!values.length) return [];
  return [
    `## ${title}`,
    "",
    ...values.map((value, index) => ordered ? `${index + 1}. ${value}` : `- ${value}`),
    ""
  ];
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") {
    return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function toReviewDecisions(value: unknown): JuicerReviewDecisions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean")
  );
}

function toNonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function replaceMarkdownBody(content: string, body: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content);
  const frontmatter = match?.[0]?.trimEnd();
  return frontmatter
    ? `${frontmatter}\n\n${body.trim()}\n`
    : `${body.trim()}\n`;
}

function safePathSegment(value: string): string {
  const result = value
    .replace(/[\\/:*?"<>|#[\]]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim();
  return result || "未分类";
}
