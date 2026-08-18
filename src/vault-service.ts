import { App, normalizePath, TFile } from "obsidian";
import {
  DashboardData,
  ProjectItem,
  ProjectRecognitionCandidate,
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
import { isVaultPathInFolder } from "./folder-scope";
import { formatPlanTaskLine } from "./plan-model";

export {
  calculateStageProgress,
  normalizeProjectStages
} from "./project-model";

const DEFAULT_PROJECT_STAGES = ["规划", "执行", "交付"];

export class VaultService {
  constructor(private app: App, private projectTag: () => string) {}

  async collectDashboardData(
    folder?: string
  ): Promise<DashboardData> {
    const files = this.app.vault.getMarkdownFiles()
      .filter((file) => isVaultPathInFolder(file.path, folder));
    const records = await Promise.all(files.map(async (file) => {
      const content = await this.app.vault.cachedRead(file);
      return { file, tasks: this.tasksFromContent(file, content) };
    }));
    const tasks = records.flatMap((record) => record.tasks);
    const projects = records
      .map((record) => this.projectFromFile(
        record.file,
        this.tasksForProject(record.file, record.tasks, tasks),
        this.inferProjectStatus(record.file, folder)
      ))
      .filter((project): project is ProjectItem => Boolean(project));
    return { notes: files.length, tasks, projects };
  }

  listMarkdownInFolder(folder: string): TFile[] {
    return this.app.vault.getMarkdownFiles()
      .filter((file) => isVaultPathInFolder(file.path, folder))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  async listProjectsInFolder(folder: string): Promise<ProjectItem[]> {
    const records = await Promise.all(this.listMarkdownInFolder(folder).map(async (file) => {
      const content = await this.app.vault.cachedRead(file);
      return { file, tasks: this.tasksFromContent(file, content) };
    }));
    const tasks = records.flatMap((record) => record.tasks);
    return records
      .map((record) => this.projectFromFile(
        record.file,
        this.tasksForProject(record.file, record.tasks, tasks),
        this.inferProjectStatus(record.file, folder)
      ))
      .filter((project): project is ProjectItem => Boolean(project));
  }

  previewProjectRecognition(folder: string): ProjectRecognitionCandidate[] {
    return this.listMarkdownInFolder(folder)
      .filter((file) => {
        const frontmatter = toUnknownRecord(
          this.app.metadataCache.getFileCache(file)?.frontmatter
        );
        return frontmatter.type !== "task-list" && file.basename !== "计划清单";
      })
      .map((file) => {
        const inferredStatus = this.inferProjectStatus(file, folder);
        const explicitReason = this.explicitProjectReason(file);
        const project = this.projectFromFile(file, [], inferredStatus);
        return {
          file,
          title: project?.title ?? file.basename,
          detected: Boolean(project),
          reason: explicitReason
            ?? (inferredStatus ? "状态目录结构自动识别" : "尚未识别为项目"),
          status: project?.status
        };
      })
      .sort((left, right) => {
        if (left.detected !== right.detected) return left.detected ? -1 : 1;
        return left.file.path.localeCompare(right.file.path, "zh-CN");
      });
  }

  async markProjectHome(file: TFile, folder: string): Promise<void> {
    const inferredStatus = this.inferProjectStatus(file, folder);
    await this.app.fileManager.processFrontMatter(file, (frontmatter: UnknownRecord) => {
      frontmatter.type = "project";
      if (frontmatter.progress === undefined) frontmatter.progress = 0;
      if (!frontmatter.status) frontmatter.status = inferredStatus ?? "doing";
    });
  }

  private tasksForProject(
    file: TFile,
    directTasks: TaskItem[],
    allTasks: TaskItem[]
  ): TaskItem[] {
    const titles = new Set([file.basename.toLowerCase()]);
    const frontmatter = toUnknownRecord(this.app.metadataCache.getFileCache(file)?.frontmatter);
    if (frontmatter.title) titles.add(String(frontmatter.title).toLowerCase());
    const linked = allTasks.filter((task) => (
      task.file.path !== file.path
      && task.project
      && titles.has(task.project.toLowerCase())
    ));
    const isProjectHome = /^(index|readme|overview|项目总览|项目主页)$/i.test(file.basename)
      || file.basename.toLowerCase() === file.parent?.name.toLowerCase();
    const folderTasks = isProjectHome && file.parent
      ? allTasks.filter((task) => (
          task.file.path !== file.path
          && task.file.path.startsWith(`${file.parent!.path}/`)
        ))
      : [];
    return [...new Set([...directTasks, ...folderTasks, ...linked])];
  }

  private inferProjectStatus(file: TFile, projectFolder?: string): Status | undefined {
    const root = (projectFolder ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const filePath = file.path.replace(/\\/g, "/").replace(/^\/+/, "");
    const relative = root && filePath.startsWith(`${root}/`)
      ? filePath.slice(root.length + 1)
      : filePath;
    const rootName = root.split("/").filter(Boolean).pop();
    const relativeParts = relative.split("/").filter(Boolean);
    const directoryParts = [rootName, ...relativeParts.slice(0, -1)]
      .filter((part): part is string => Boolean(part));
    const statusIndex = directoryParts.findIndex((part) => (
      /^(进行中|active|doing|in-progress)$/i.test(part)
      || /^(已完成|已归档|done|completed|archive|archived)$/i.test(part)
    ));
    if (statusIndex < 0) return undefined;
    const directProjectNote = directoryParts.length === statusIndex + 1;
    const oneProjectFolderDeep = directoryParts.length === statusIndex + 2;
    const projectDirectoryName = directoryParts[statusIndex + 1]?.toLowerCase();
    const basename = file.basename.toLowerCase();
    const projectHomeNote = oneProjectFolderDeep && (
      basename === projectDirectoryName
      || /^(index|readme|overview|项目总览|项目主页)$/.test(basename)
    );
    // Direct notes are projects. Inside a project subfolder, only a conventional
    // home note is auto-detected; the remaining Markdown stays project material.
    if (!directProjectNote && !projectHomeNote) return undefined;
    return /^(已完成|已归档|done|completed|archive|archived)$/i
      .test(directoryParts[statusIndex]!)
      ? "done"
      : "doing";
  }

  private explicitProjectReason(file: TFile): string | undefined {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = toUnknownRecord(cache?.frontmatter);
    if (String(frontmatter.type ?? "").toLowerCase() === "project") {
      return "type: project";
    }
    if (frontmatter.project === true) return "project: true";
    const tags = cache?.tags?.map((tag) => tag.tag.replace(/^#/, "")) ?? [];
    const frontmatterTags = Array.isArray(frontmatter.tags)
      ? frontmatter.tags.map(String)
      : typeof frontmatter.tags === "string"
        ? frontmatter.tags.split(/[ ,]+/)
        : [];
    const projectTag = this.projectTag().toLowerCase();
    return [...tags, ...frontmatterTags]
      .map((tag) => tag.replace(/^#/, "").toLowerCase())
      .includes(projectTag)
      ? `#${this.projectTag()}`
      : undefined;
  }

  private tasksFromContent(file: TFile, content: string): TaskItem[] {
    const tasks: TaskItem[] = [];
    content.split(/\r?\n/).forEach((line, index) => {
      const match = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
      if (!match) return;
      const sourceText = match[2] ?? "";
      const dueMatch = sourceText.match(/(?:📅|due::?)\s*(\d{4}-\d{2}-\d{2})/i);
      const completedMatch = sourceText.match(/(?:✅|completion::?)\s*(\d{4}-\d{2}-\d{2})/i);
      const projectMatch = sourceText.match(/(?:project|项目)::?\s*(?:\[\[)?([^\]\n]+?)(?:\]\])?\s*$/i);
      tasks.push({
        text: sourceText
          .replace(/(?:📅|due::?)\s*\d{4}-\d{2}-\d{2}/i, "")
          .replace(/(?:✅|completion::?)\s*\d{4}-\d{2}-\d{2}/i, "")
          .replace(/(?:project|项目)::?\s*(?:\[\[)?[^\]\n]+?(?:\]\])?\s*$/i, "")
          .trim(),
        done: (match[1] ?? "").toLowerCase() === "x",
        file,
        line: index,
        sourceLine: line,
        due: dueMatch?.[1],
        completed: completedMatch?.[1],
        project: projectMatch?.[1]?.trim()
      });
    });
    return tasks;
  }

  private projectFromFile(
    file: TFile,
    tasks: TaskItem[],
    inferredStatus?: Status
  ): ProjectItem | undefined {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = toUnknownRecord(cache?.frontmatter);
    if (frontmatter.type === "task-list" || file.basename === "计划清单") return undefined;
    const tags = cache?.tags?.map((tag) => tag.tag.replace(/^#/, "")) ?? [];
    const frontmatterTags = Array.isArray(frontmatter.tags)
      ? frontmatter.tags.map(String)
      : typeof frontmatter.tags === "string"
        ? frontmatter.tags.split(/[ ,]+/)
        : [];
    const allTags = [...tags, ...frontmatterTags]
      .map((tag) => tag.replace(/^#/, "").toLowerCase());
    const projectTag = this.projectTag().toLowerCase();
    const type = String(frontmatter.type ?? "").toLowerCase();
    if (
      type !== "project"
      && frontmatter.project !== true
      && !allTags.includes(projectTag)
      && inferredStatus === undefined
    ) {
      return undefined;
    }

    const inferredCompleted = /(^|\/)(done|completed|archive|已完成|已归档)(\/|$)/i
      .test(file.path);
    const fallbackStatus = inferredStatus ?? (inferredCompleted ? "done" : "todo");
    const rawStatus = String(frontmatter.status ?? fallbackStatus).toLowerCase();
    let status: Status = ["done", "completed", "archived", "完成", "已完成", "已归档"]
      .includes(rawStatus)
      ? "done"
      : ["doing", "in-progress", "active", "进行中"].includes(rawStatus)
        ? "doing"
        : "todo";
    const stages = normalizeProjectStages(frontmatter.stages);
    const storedProgress = clampProgress(
      Number(frontmatter.progress ?? (status === "done" ? 100 : 0))
    );
    const taskDone = tasks.filter((task) => task.done).length;
    const progress = stages.length
      ? calculateStageProgress(stages)
      : storedProgress;
    const progressSource = stages.length ? "stages" : "manual";
    if (progress >= 100) status = "done";
    else if (progress > 0 && status === "todo") status = "doing";
    const inferredTitle = inferredStatus && /^(index|readme|overview|项目总览|项目主页)$/i
      .test(file.basename)
      ? file.parent?.name ?? file.basename
      : file.basename;
    return {
      file,
      title: String(frontmatter.title ?? inferredTitle),
      status,
      progress,
      stages,
      taskTotal: tasks.length,
      taskDone,
      progressSource,
      due: normalizeDate(frontmatter.due),
      area: frontmatter.area ? String(frontmatter.area) : undefined
    };
  }

  async getOrCreateDailyFile(folder: string, date: string): Promise<TFile> {
    const normalizedFolder = normalizePath(folder);
    await this.ensureFolder(normalizedFolder);
    const path = joinVaultPath(normalizedFolder, `${date}.md`);
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

  async addPlan(folder: string, text: string, due?: string, project?: string): Promise<TFile> {
    const normalizedFolder = normalizePath(folder);
    await this.ensureFolder(normalizedFolder);
    const path = joinVaultPath(normalizedFolder, "计划清单.md");
    const line = formatPlanTaskLine(text, due, project);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.process(existing, (content) => {
        const eol = content.includes("\r\n") ? "\r\n" : "\n";
        const prefix = content.endsWith(eol) ? "" : eol;
        return `${content}${prefix}${line}${eol}`;
      });
      return existing;
    }
    return this.app.vault.create(path, [
      "---",
      "type: task-list",
      "title: 计划清单",
      "---",
      "",
      "# 计划清单",
      "",
      line,
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

  async updateProjectProgress(file: TFile, progress: number): Promise<void> {
    const normalized = clampProgress(progress);
    await this.app.fileManager.processFrontMatter(file, (frontmatter: UnknownRecord) => {
      frontmatter.progress = normalized;
      frontmatter.status = normalized >= 100
        ? "done"
        : normalized > 0
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
    const sourcePath = joinVaultPath(normalizedFolder, "灵感.md");
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
      const path = joinVaultPath(folder, `${name}.md`);
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

function joinVaultPath(folder: string, name: string): string {
  return normalizePath([folder, name].filter(Boolean).join("/"));
}
