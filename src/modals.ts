import { App, Modal, Setting } from "obsidian";
import {
  DatabaseColumn,
  DatabaseColumnType,
  ProjectStage
} from "./types";
import { JuicerReviewMetadata } from "./juicer-service";
import {
  decisionsFromComparison,
  JuicerDiffSegment,
  JuicerReviewComparison,
  JuicerReviewDecisions
} from "./juicer-review-model";

export interface InspirationCaptureInput {
  title: string;
  content: string;
  image: string;
  source: string;
  pastedImage?: {
    data: ArrayBuffer;
    mimeType: string;
  };
}

class TextPromptModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private titleText: string,
    private initialValue: string,
    private resolveValue: (value: string | undefined) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.titleText);
    let value = this.initialValue;
    new Setting(this.contentEl)
      .setName("名称")
      .addText((text) => {
        text.setValue(value);
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") this.submit(value);
        });
        text.onChange((nextValue) => { value = nextValue; });
        window.setTimeout(() => {
          text.inputEl.focus();
          text.inputEl.select();
        });
      });
    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText("取消")
        .onClick(() => this.close()))
      .addButton((button) => button
        .setCta()
        .setButtonText("保存")
        .onClick(() => this.submit(value)));
  }

  onClose(): void {
    if (!this.settled) this.resolveValue(undefined);
    this.contentEl.empty();
  }

  private submit(value: string): void {
    const normalized = value.trim();
    if (!normalized) return;
    this.settled = true;
    this.resolveValue(normalized);
    this.close();
  }
}

class InspirationCaptureModal extends Modal {
  private settled = false;
  private previewUrl?: string;

  constructor(
    app: App,
    private resolveValue: (value: InspirationCaptureInput | undefined) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("vw-inspiration-capture-modal");
    this.titleEl.setText("捕捉灵感");
    this.contentEl.createEl("p", {
      text: "先记下来，不必立刻决定归属。保存后会成为灵感墙中的一张卡片。",
      cls: "vw-modal-help"
    });
    const value: InspirationCaptureInput = {
      title: "",
      content: "",
      image: "",
      source: ""
    };

    new Setting(this.contentEl)
      .setName("灵感标题（可选）")
      .setDesc("不填写时，会根据文字或截图时间自动生成")
      .addText((text) => {
        text.setPlaceholder("例如：把每周复盘做成一张视觉地图");
        text.onChange((next) => { value.title = next; });
      });
    const contentSetting = new Setting(this.contentEl)
      .setName("灵感内容")
      .setDesc("直接粘贴文字或截图；截图会自动存入 Vault 附件目录")
      .addTextArea((text) => {
        text.setPlaceholder("在这里 Ctrl+V 粘贴文字或截图……");
        text.inputEl.rows = 7;
        text.onChange((next) => { value.content = next; });
        text.inputEl.addEventListener("paste", (event) => {
          void this.capturePastedImage(event, value, contentSetting.settingEl);
        });
        window.setTimeout(() => text.inputEl.focus());
      });
    new Setting(this.contentEl)
      .setName("来源链接（可选）")
      .setDesc("网页、帖子或素材来源")
      .addText((text) => text
        .setPlaceholder("https://…")
        .onChange((next) => { value.source = next; }));
    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText("取消")
        .onClick(() => this.close()))
      .addButton((button) => button
        .setCta()
        .setButtonText("保存为灵感卡片")
        .onClick(() => this.submit(value)));
  }

  onClose(): void {
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    if (!this.settled) this.resolveValue(undefined);
    this.contentEl.empty();
  }

  private submit(value: InspirationCaptureInput): void {
    const content = value.content.trim();
    const title = value.title.trim()
      || firstContentLine(content)
      || (value.pastedImage ? createScreenshotTitle() : "");
    const normalized: InspirationCaptureInput = {
      title,
      content,
      image: value.image.trim(),
      source: value.source.trim(),
      pastedImage: value.pastedImage
    };
    if (!normalized.title || (!normalized.content && !normalized.pastedImage)) return;
    this.settled = true;
    this.resolveValue(normalized);
    this.close();
  }

  private async capturePastedImage(
    event: ClipboardEvent,
    value: InspirationCaptureInput,
    settingEl: HTMLElement
  ): Promise<void> {
    const imageItem = Array.from(event.clipboardData?.items ?? [])
      .find((item) => item.type.startsWith("image/"));
    const file = imageItem?.getAsFile();
    if (!file) return;
    value.pastedImage = {
      data: await file.arrayBuffer(),
      mimeType: file.type || "image/png"
    };
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = URL.createObjectURL(file);
    let preview = settingEl.querySelector<HTMLElement>(".vw-pasted-image-preview");
    if (!preview) {
      preview = settingEl.createDiv({ cls: "vw-pasted-image-preview" });
    }
    preview.empty();
    preview.createEl("img", {
      attr: {
        src: this.previewUrl,
        alt: "刚刚粘贴的灵感截图"
      }
    });
    const info = preview.createDiv();
    info.createEl("strong", { text: "截图已粘贴" });
    info.createSpan({
      text: "保存时会自动写入 Vault 附件目录",
      cls: "vw-meta"
    });
    const remove = info.createEl("button", {
      text: "移除图片",
      cls: "vw-modal-remove"
    });
    remove.addEventListener("click", () => {
      value.pastedImage = undefined;
      preview?.remove();
      if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = undefined;
    });
  }
}

class ConfirmActionModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private titleText: string,
    private message: string,
    private resolveValue: (value: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.titleText);
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText("取消")
        .onClick(() => this.close()))
      .addButton((button) => button
        .setDestructive()
        .setButtonText("确认")
        .onClick(() => {
          this.settled = true;
          this.resolveValue(true);
          this.close();
        }));
  }

  onClose(): void {
    if (!this.settled) this.resolveValue(false);
    this.contentEl.empty();
  }
}

class ProjectStagesModal extends Modal {
  private settled = false;
  private stages: ProjectStage[];
  private rowsEl!: HTMLElement;

  constructor(
    app: App,
    private projectTitle: string,
    initialStages: ProjectStage[],
    private resolveValue: (value: ProjectStage[] | undefined) => void
  ) {
    super(app);
    this.stages = initialStages.length
      ? initialStages.map((stage) => ({ ...stage }))
      : [
          { id: createModalId("stage"), name: "规划", progress: 0 },
          { id: createModalId("stage"), name: "执行", progress: 0 },
          { id: createModalId("stage"), name: "交付", progress: 0 }
        ];
  }

  onOpen(): void {
    this.titleEl.setText(`管理阶段 · ${this.projectTitle}`);
    this.contentEl.createEl("p", {
      text: "阶段名称和进度都可以自定义；项目总进度会按所有阶段的平均值自动计算。",
      cls: "vw-modal-help"
    });
    this.rowsEl = this.contentEl.createDiv({ cls: "vw-stage-editor" });
    this.renderRows();

    const add = this.contentEl.createEl("button", {
      text: "＋ 添加阶段",
      cls: "mod-cta vw-modal-add"
    });
    add.addEventListener("click", () => {
      this.stages.push({
        id: createModalId("stage"),
        name: `阶段 ${this.stages.length + 1}`,
        progress: 0
      });
      this.renderRows();
    });

    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText("取消")
        .onClick(() => this.close()))
      .addButton((button) => button
        .setCta()
        .setButtonText("保存阶段")
        .onClick(() => this.submit()));
  }

  onClose(): void {
    if (!this.settled) this.resolveValue(undefined);
    this.contentEl.empty();
  }

  private renderRows(): void {
    this.rowsEl.empty();
    this.stages.forEach((stage, index) => {
      const row = this.rowsEl.createDiv({ cls: "vw-stage-editor-row" });
      const name = row.createEl("input", {
        type: "text",
        value: stage.name,
        attr: { "aria-label": `阶段 ${index + 1} 名称` }
      });
      name.addEventListener("input", () => { stage.name = name.value; });

      const progressWrap = row.createDiv({ cls: "vw-stage-editor-progress" });
      const range = progressWrap.createEl("input", {
        type: "range",
        value: String(stage.progress),
        attr: { min: "0", max: "100", step: "5" }
      });
      const value = progressWrap.createEl("input", {
        type: "number",
        value: String(stage.progress),
        attr: { min: "0", max: "100", step: "5", "aria-label": "完成百分比" }
      });
      const updateProgress = (next: number) => {
        stage.progress = Math.max(0, Math.min(100, Number.isFinite(next) ? next : 0));
        range.value = String(stage.progress);
        value.value = String(stage.progress);
      };
      range.addEventListener("input", () => updateProgress(Number(range.value)));
      value.addEventListener("change", () => updateProgress(Number(value.value)));
      progressWrap.createSpan({ text: "%" });

      const remove = row.createEl("button", {
        text: "删除",
        cls: "vw-modal-remove",
        attr: { "aria-label": `删除阶段 ${stage.name}` }
      });
      remove.addEventListener("click", () => {
        this.stages.splice(index, 1);
        this.renderRows();
      });
    });
  }

  private submit(): void {
    const stages = this.stages
      .map((stage) => ({ ...stage, name: stage.name.trim() }))
      .filter((stage) => stage.name);
    if (!stages.length) return;
    this.settled = true;
    this.resolveValue(stages);
    this.close();
  }
}

class DatabaseColumnModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private resolveValue: (value: DatabaseColumn | undefined) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("添加多维表字段");
    let label = "";
    let property = "";
    let type: DatabaseColumnType = "text";
    let options = "";

    new Setting(this.contentEl)
      .setName("显示名称")
      .setDesc("例如：负责人、平台、内容分类")
      .addText((text) => text.onChange((value) => {
        label = value;
        if (!property) property = toPropertyKey(value);
      }));
    new Setting(this.contentEl)
      .setName("属性名称")
      .setDesc("保存在 Markdown 属性区中的字段名，例如 platform")
      .addText((text) => text
        .setPlaceholder("platform")
        .onChange((value) => { property = value; }));
    new Setting(this.contentEl)
      .setName("字段类型")
      .addDropdown((dropdown) => dropdown
        .addOption("text", "文字")
        .addOption("number", "数字")
        .addOption("date", "日期")
        .addOption("select", "单选")
        .addOption("tags", "多标签")
        .setValue(type)
        .onChange((value) => { type = value as DatabaseColumnType; }));
    new Setting(this.contentEl)
      .setName("单选选项")
      .setDesc("只有单选字段使用；用英文或中文逗号分隔")
      .addText((text) => text
        .setPlaceholder("待处理, 进行中, 已完成")
        .onChange((value) => { options = value; }));
    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText("取消")
        .onClick(() => this.close()))
      .addButton((button) => button
        .setCta()
        .setButtonText("添加字段")
        .onClick(() => {
          const normalizedLabel = label.trim();
          const normalizedProperty = toPropertyKey(property || label);
          if (!normalizedLabel || !normalizedProperty) return;
          this.settled = true;
          this.resolveValue({
            id: createModalId("column"),
            label: normalizedLabel,
            property: normalizedProperty,
            type,
            options: type === "select"
              ? options.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
              : undefined
          });
          this.close();
        }));
  }

  onClose(): void {
    if (!this.settled) this.resolveValue(undefined);
    this.contentEl.empty();
  }
}

class JuicerMetadataModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private initial: JuicerReviewMetadata,
    private resolveValue: (value: JuicerReviewMetadata | undefined) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("审阅平台与内容分类");
    const value: JuicerReviewMetadata = {
      platforms: [...this.initial.platforms],
      categories: [...this.initial.categories],
      tags: [...this.initial.tags],
      bodyReviewStatus: this.initial.bodyReviewStatus,
      acceptedBlocks: this.initial.acceptedBlocks,
      rejectedBlocks: this.initial.rejectedBlocks
    };
    this.listSetting(
      "平台分类",
      "例如：小红书、公众号、视频；可自由填写",
      value.platforms,
      (next) => { value.platforms = next; }
    );
    this.listSetting(
      "内容分类",
      "例如：学习、工作、生活；不限制分类数量",
      value.categories,
      (next) => { value.categories = next; }
    );
    this.listSetting(
      "标签",
      "用于后续搜索和关联",
      value.tags,
      (next) => { value.tags = next; }
    );
    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText("取消")
        .onClick(() => this.close()))
      .addButton((button) => button
        .setCta()
        .setButtonText("保存分类")
        .onClick(() => {
          this.settled = true;
          this.resolveValue(value);
          this.close();
        }));
  }

  onClose(): void {
    if (!this.settled) this.resolveValue(undefined);
    this.contentEl.empty();
  }

  private listSetting(
    name: string,
    description: string,
    initial: string[],
    onChange: (value: string[]) => void
  ): void {
    new Setting(this.contentEl)
      .setName(name)
      .setDesc(description)
      .addText((text) => text
        .setValue(initial.join(", "))
        .onChange((value) => onChange(
          value.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
        )));
  }
}

class JuicerBodyReviewModal extends Modal {
  private settled = false;
  private decisions: JuicerReviewDecisions;
  private summaryEl?: HTMLElement;
  private readonly decisionButtons = new Map<string, HTMLButtonElement>();

  constructor(
    app: App,
    private comparison: JuicerReviewComparison,
    private resolveValue: (value: JuicerReviewDecisions | undefined) => void
  ) {
    super(app);
    this.decisions = decisionsFromComparison(comparison);
  }

  onOpen(): void {
    this.modalEl.addClass("vw-juicer-diff-modal");
    this.titleEl.setText("正文差异审阅");
    this.contentEl.createDiv({
      text: this.comparison.sourcePath
        ? `左侧为原料 ${this.comparison.sourcePath} 的相近片段，右侧为 AI 草稿。绿色是新增，红色是原料中未保留的内容。`
        : "未找到原料文件。你仍可逐段决定是否采用 AI 草稿。",
      cls: "vw-juicer-diff-intro"
    });

    const toolbar = this.contentEl.createDiv({ cls: "vw-juicer-diff-toolbar" });
    this.summaryEl = toolbar.createDiv({ cls: "vw-juicer-diff-summary" });
    const toolbarActions = toolbar.createDiv({ cls: "vw-juicer-diff-toolbar-actions" });
    const acceptAll = toolbarActions.createEl("button", {
      text: "全部采用",
      cls: "vw-secondary-button"
    });
    acceptAll.addEventListener("click", () => this.setAll(true));
    const rejectAll = toolbarActions.createEl("button", {
      text: "全部暂不采用",
      cls: "vw-secondary-button"
    });
    rejectAll.addEventListener("click", () => this.setAll(false));

    const list = this.contentEl.createDiv({ cls: "vw-juicer-diff-list" });
    this.comparison.blocks.forEach((block) => {
      const card = list.createDiv({ cls: "vw-juicer-diff-card" });
      const header = card.createDiv({ cls: "vw-juicer-diff-card-header" });
      header.createEl("strong", { text: block.section || "正文" });
      header.createSpan({
        text: block.sourceText
          ? `原料匹配 ${Math.round(block.similarity * 100)}%`
          : "AI 新增段落",
        cls: "vw-muted"
      });

      const columns = card.createDiv({ cls: "vw-juicer-diff-columns" });
      const original = columns.createDiv({ cls: "vw-juicer-diff-pane is-original" });
      original.createDiv({ text: "原料相近片段", cls: "vw-meta" });
      const originalText = original.createDiv({ cls: "vw-juicer-diff-text" });
      if (block.originalDiff.length) {
        renderDiffSegments(originalText, block.originalDiff);
      } else {
        originalText.createSpan({
          text: "原料中未找到直接对应片段",
          cls: "vw-muted"
        });
      }

      const draft = columns.createDiv({ cls: "vw-juicer-diff-pane is-draft" });
      draft.createDiv({ text: "AI 草稿", cls: "vw-meta" });
      const draftText = draft.createDiv({ cls: "vw-juicer-diff-text" });
      renderDiffSegments(draftText, block.draftDiff);

      const actions = card.createDiv({ cls: "vw-juicer-diff-card-actions" });
      if (!block.selectable) {
        actions.createSpan({ text: "来源信息会始终保留", cls: "vw-muted" });
      } else {
        const button = actions.createEl("button", { cls: "vw-secondary-button" });
        button.addEventListener("click", () => {
          this.decisions[block.id] = this.decisions[block.id] === false;
          this.updateDecisionButton(block.id);
          this.updateSummary();
        });
        this.decisionButtons.set(block.id, button);
        this.updateDecisionButton(block.id);
      }
    });

    const footer = this.contentEl.createDiv({ cls: "vw-juicer-diff-footer" });
    const cancel = footer.createEl("button", {
      text: "取消",
      cls: "vw-secondary-button"
    });
    cancel.addEventListener("click", () => this.close());
    const save = footer.createEl("button", {
      text: "保存正文审阅",
      cls: "vw-primary-button"
    });
    save.addEventListener("click", () => {
      this.settled = true;
      this.resolveValue({ ...this.decisions });
      this.close();
    });
    this.updateSummary();
  }

  onClose(): void {
    if (!this.settled) this.resolveValue(undefined);
    this.contentEl.empty();
  }

  private setAll(accepted: boolean): void {
    this.comparison.blocks.forEach((block) => {
      if (block.selectable) this.decisions[block.id] = accepted;
    });
    this.decisionButtons.forEach((_button, id) => this.updateDecisionButton(id));
    this.updateSummary();
  }

  private updateDecisionButton(id: string): void {
    const button = this.decisionButtons.get(id);
    if (!button) return;
    const accepted = this.decisions[id] !== false;
    button.setText(accepted ? "✓ 已采用此段" : "暂不采用此段");
    button.toggleClass("is-accepted", accepted);
    button.toggleClass("is-rejected", !accepted);
  }

  private updateSummary(): void {
    if (!this.summaryEl) return;
    const selectable = this.comparison.blocks.filter((block) => block.selectable);
    const accepted = selectable.filter((block) => this.decisions[block.id] !== false).length;
    this.summaryEl.setText(`已采用 ${accepted} 段 · 暂不采用 ${selectable.length - accepted} 段`);
  }
}

export function requestText(
  app: App,
  title: string,
  initialValue = ""
): Promise<string | undefined> {
  return new Promise((resolve) => {
    new TextPromptModal(app, title, initialValue, resolve).open();
  });
}

export function requestInspirationCapture(
  app: App
): Promise<InspirationCaptureInput | undefined> {
  return new Promise((resolve) => {
    new InspirationCaptureModal(app, resolve).open();
  });
}

export function requestConfirmation(
  app: App,
  title: string,
  message: string
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmActionModal(app, title, message, resolve).open();
  });
}

export function editProjectStages(
  app: App,
  title: string,
  stages: ProjectStage[]
): Promise<ProjectStage[] | undefined> {
  return new Promise((resolve) => {
    new ProjectStagesModal(app, title, stages, resolve).open();
  });
}

export function requestDatabaseColumn(
  app: App
): Promise<DatabaseColumn | undefined> {
  return new Promise((resolve) => {
    new DatabaseColumnModal(app, resolve).open();
  });
}

export function editJuicerMetadata(
  app: App,
  initial: JuicerReviewMetadata
): Promise<JuicerReviewMetadata | undefined> {
  return new Promise((resolve) => {
    new JuicerMetadataModal(app, initial, resolve).open();
  });
}

export function reviewJuicerBody(
  app: App,
  comparison: JuicerReviewComparison
): Promise<JuicerReviewDecisions | undefined> {
  return new Promise((resolve) => {
    new JuicerBodyReviewModal(app, comparison, resolve).open();
  });
}

function renderDiffSegments(
  parent: HTMLElement,
  segments: JuicerDiffSegment[]
): void {
  segments.forEach((segment) => {
    const element = parent.createSpan({ text: segment.text });
    if (segment.kind === "added") element.addClass("is-added");
    if (segment.kind === "removed") element.addClass("is-removed");
  });
}

function createModalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function toPropertyKey(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .toLowerCase();
}

function firstContentLine(content: string): string {
  const line = content
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  if (!line) return "";
  return line.length > 36 ? `${line.slice(0, 36)}…` : line;
}

function createScreenshotTitle(): string {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
  const time = [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0")
  ].join("-");
  return `截图灵感 ${date} ${time}`;
}
