import { App, normalizePath, TFile } from "obsidian";
import {
  DashboardData,
  ProjectItem,
  ProjectStage,
  Status,
  TaskItem
} from "./types";
import {
  calculateStageProgress,
  clampProgress,
  createProjectStageId,
  normalizeProjectStages
} from "./project-model";
import { toUnknownRecord, UnknownRecord } from "./type-guards";

export {
  calculateStageProgress,
  normalizeProjectStages
} from "./project-model";

const DEFAULT_PROJECT_STAGES = ["规划", "执行", "交付"];

export class VaultService {
  constructor(private app: App, private projectTag: () => string) {}

  async collectDashboardData(): Promise<DashboardData> {
    const files = this.app.vault.getMarkdownFiles();
    const tasks: TaskItem[] = [];
    const projects: ProjectItem[] = [];

    await Promise.all(files.map(async (file) => {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = toUnknownRecord(cache?.frontmatter);
      const tags = cache?.tags?.map((tag) => tag.tag.replace(/^#/, "")) ?? [];
      const frontmatterTags = Array.isArray(frontmatter.tags)
        ? frontmatter.tags.map(String)
        : typeof frontmatter.tags === "string"
          ? frontmatter.tags.split(/[ ,]+/)
          : [];
      const allTags = [...tags, ...frontmatterTags].map((tag) => tag.replace(/^#/, ""));

      if (allTags.includes(this.projectTag()) || frontmatter.type === "project") {
        const rawStatus = String(frontmatter.status ?? "todo").toLowerCase();
        let status: Status = rawStatus === "done" || rawStatus === "完成"
          ? "done"
          : rawStatus === "doing" || rawStatus === "进行中"
            ? "doing"
            : "todo";
        const stages = normalizeProjectStages(frontmatter.stages);
        const storedProgress = clampProgress(
          Number(frontmatter.progress ?? (status === "done" ? 100 : 0))
        );
        const progress = stages.length
          ? calculateStageProgress(stages)
          : storedProgress;
        if (progress >= 100) status = "done";
        else if (progress > 0 && status === "todo") status = "doing";
        projects.push({
          file,
          title: String(frontmatter.title ?? file.basename),
          status,
          progress,
          stages,
          due: normalizeDate(frontmatter.due),
          area: frontmatter.area ? String(frontmatter.area) : undefined
        });
      }

      const content = await this.app.vault.cachedRead(file);
      content.split("\n").forEach((line, index) => {
        const match = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
        if (!match) return;
        const text = match[2] ?? "";
        const dueMatch = text.match(/(?:📅|due::?)\s*(\d{4}-\d{2}-\d{2})/i);
        tasks.push({
          text: text.replace(/(?:📅|due::?)\s*\d{4}-\d{2}-\d{2}/i, "").trim(),
          done: (match[1] ?? "").toLowerCase() === "x",
          file,
          line: index,
          due: dueMatch?.[1]
        });
      });
    }));

    return { notes: files.length, tasks, projects };
  }

  listMarkdownInFolder(folder: string): TFile[] {
    const prefix = `${normalizePath(folder).replace(/\/$/, "")}/`;
    return this.app.vault.getMarkdownFiles()
      .filter((file) => file.path.startsWith(prefix))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  async getOrCreateDailyFile(folder: string, date: string): Promise<TFile> {
    const normalizedFolder = normalizePath(folder);
    await this.ensureFolder(normalizedFolder);
    const path = normalizePath(`${normalizedFolder}/${date}.md`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    return this.app.vault.create(
      path,
      [
        `# ${date}`,
        "",
        "## 临时想法",
        "",
        "从这里开始记录今天想到什么、做了什么。",
        "",
        "## 今天完成",
        "",
        "- [ ] ",
        "",
        "## AI 使用记录",
        ""
      ].join("\n")
    );
  }

  async createProject(folder: string, title: string): Promise<TFile> {
    const normalizedFolder = normalizePath(folder);
    await this.ensureFolder(normalizedFolder);
    const path = this.availableMarkdownPath(normalizedFolder, title);
    const stages = DEFAULT_PROJECT_STAGES.map((name, index) => ({
      id: createProjectStageId(index),
      name,
      progress: 0
    }));
    return this.app.vault.create(path, [
      "---",
      "type: project",
      `title: ${JSON.stringify(title)}`,
      "status: todo",
      "progress: 0",
      "stages:",
      ...stages.flatMap((stage) => [
        `  - id: ${stage.id}`,
        `    name: ${JSON.stringify(stage.name)}`,
        "    progress: 0"
      ]),
      "tags:",
      `  - ${this.projectTag()}`,
      "---",
      "",
      `# ${title}`,
      "",
      "## 项目说明",
      "",
      "在这里补充目标、执行记录和交付结果。",
      ""
    ].join("\n"));
  }

  async updateProjectStages(file: TFile, stages: ProjectStage[]): Promise<void> {
    const normalized = normalizeProjectStages(stages);
    const progress = calculateStageProgress(normalized);
    await this.app.fileManager.processFrontMatter(file, (frontmatter: UnknownRecord) => {
      frontmatter.stages = normalized.map((stage) => ({
        id: stage.id,
        name: stage.name,
        progress: stage.progress
      }));
      frontmatter.progress = progress;
      frontmatter.status = progress >= 100
        ? "done"
        : progress > 0
          ? "doing"
          : "todo";
    });
  }

  async updateFrontmatter(
    file: TFile,
    property: string,
    value: unknown
  ): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter: UnknownRecord) => {
      if (
        value === undefined
        || value === null
        || value === ""
        || (Array.isArray(value) && value.length === 0)
      ) {
        delete frontmatter[property];
      } else {
        frontmatter[property] = value;
      }
    });
  }

  async createNote(folder: string, title: string): Promise<TFile> {
    const normalizedFolder = normalizePath(folder);
    await this.ensureFolder(normalizedFolder);
    const path = this.availableMarkdownPath(normalizedFolder, title);
    return this.app.vault.create(path, [
      "---",
      `title: ${JSON.stringify(title)}`,
      "type: note",
      "status: todo",
      "---",
      "",
      `# ${title}`,
      ""
    ].join("\n"));
  }

  async createInspiration(
    folder: string,
    input: {
      title: string;
      content: string;
      image?: string;
      source?: string;
    }
  ): Promise<TFile> {
    const normalizedFolder = normalizePath(folder);
    await this.ensureFolder(normalizedFolder);
    const path = this.availableMarkdownPath(normalizedFolder, input.title);
    const frontmatter = [
      "---",
      `title: ${JSON.stringify(input.title)}`,
      "type: inspiration",
      `created: ${formatLocalDate(new Date())}`
    ];
    if (input.image) frontmatter.push(`image: ${JSON.stringify(input.image)}`);
    if (input.source) frontmatter.push(`source: ${JSON.stringify(input.source)}`);
    frontmatter.push("---");
    return this.app.vault.create(path, [
      ...frontmatter,
      "",
      `# ${input.title}`,
      "",
      input.content || "在这里继续补充这条灵感。",
      ""
    ].join("\n"));
  }

  async saveInspirationAttachment(
    folder: string,
    image: { data: ArrayBuffer; mimeType: string }
  ): Promise<TFile> {
    const normalizedFolder = normalizePath(folder);
    await this.ensureFolder(normalizedFolder);
    const extension = imageExtension(image.mimeType);
    const filename = `inspiration-${Date.now()}.${extension}`;
    const sourcePath = normalizePath(`${normalizedFolder}/灵感.md`);
    const path = await this.app.fileManager.getAvailablePathForAttachment(
      filename,
      sourcePath
    );
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (parent) await this.ensureFolder(parent);
    return this.app.vault.createBinary(path, image.data);
  }

  async ensureFolder(folder: string): Promise<void> {
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
    const safeTitle = title
      .replace(/[\\/:*?"<>|#[\]]/g, "-")
      .replace(/\s+/g, " ")
      .trim() || "未命名";
    let suffix = 0;
    while (true) {
      const name = suffix ? `${safeTitle} ${suffix + 1}` : safeTitle;
      const path = normalizePath(`${folder}/${name}.md`);
      if (!this.app.vault.getAbstractFileByPath(path)) return path;
      suffix += 1;
    }
  }
}

export function normalizeDate(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatRelativeDate(dateText: string): string {
  const target = new Date(`${dateText}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days === 0) return "今天";
  if (days === 1) return "明天";
  if (days === -1) return "昨天";
  return days > 0 ? `${days} 天后` : `逾期 ${Math.abs(days)} 天`;
}

function imageExtension(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/svg+xml") return "svg";
  return "png";
}
