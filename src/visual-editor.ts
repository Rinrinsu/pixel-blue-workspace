import { App, Notice, setIcon } from "obsidian";
import { requestText } from "./modals";
import { resolveAnnotation } from "./editor-model";
import {
  EditorDocumentState,
  EditorSpacing,
  HeadingColorMode,
  NoteAnnotation
} from "./types";

export interface VisualMarkdownEditorOptions {
  app: App;
  filePath: string;
  markdown: string;
  state: EditorDocumentState;
  onChange(markdown: string): void;
  onStateChange(state: EditorDocumentState): void | Promise<void>;
}

type EditorMode = "visual" | "markdown";

interface SelectionSnapshot {
  quote: string;
  prefix: string;
  suffix: string;
  range?: Range;
  sourceStart?: number;
  sourceEnd?: number;
}

export { createDefaultEditorDocumentState } from "./editor-model";

export class VisualMarkdownEditor {
  private mode: EditorMode = "visual";
  private markdown: string;
  private state: EditorDocumentState;
  private root!: HTMLElement;
  private layout!: HTMLElement;
  private visualSurface!: HTMLElement;
  private sourceSurface!: HTMLTextAreaElement;
  private modeButton!: HTMLButtonElement;
  private composer!: HTMLElement;
  private sidebar!: HTMLElement;
  private selection?: SelectionSnapshot;

  constructor(private options: VisualMarkdownEditorOptions) {
    this.markdown = options.markdown;
    this.state = {
      ...options.state,
      comments: options.state.comments.map((comment) => ({ ...comment }))
    };
  }

  mount(parent: HTMLElement): void {
    this.root = parent.createDiv({ cls: "vw-visual-editor" });
    this.renderToolbar();
    this.composer = this.root.createDiv({ cls: "vw-comment-composer" });
    this.composer.hidden = true;
    this.layout = this.root.createDiv({ cls: "vw-document-layout" });
    const document = this.layout.createDiv({ cls: "vw-document-pane" });
    this.visualSurface = document.createDiv({
      cls: "vw-visual-surface",
      attr: {
        contenteditable: "true",
        role: "textbox",
        "aria-multiline": "true",
        spellcheck: "true",
        "aria-label": "可视化 Markdown 编辑器"
      }
    });
    this.sourceSurface = document.createEl("textarea", {
      cls: "vw-markdown-source",
      attr: {
        spellcheck: "true",
        "aria-label": "Markdown 源码编辑器"
      }
    });
    this.sidebar = this.layout.createEl("aside", {
      cls: "vw-comment-sidebar",
      attr: { "aria-label": "笔记批注" }
    });

    this.visualSurface.addEventListener("input", () => {
      this.syncFromVisual();
      this.options.onChange(this.markdown);
      this.refreshAnnotationStates();
    });
    this.sourceSurface.addEventListener("input", () => {
      this.markdown = this.sourceSurface.value;
      this.options.onChange(this.markdown);
      this.refreshAnnotationStates();
    });
    this.visualSurface.addEventListener("mouseup", () => this.captureSelection());
    this.visualSurface.addEventListener("keyup", () => this.captureSelection());
    this.sourceSurface.addEventListener("select", () => this.captureSelection());
    this.sourceSurface.addEventListener("keyup", () => this.captureSelection());

    this.renderVisualSurface();
    this.sourceSurface.value = this.markdown;
    this.applyDocumentPreferences();
    this.setMode("visual");
    this.renderComments();
  }

  getMarkdown(): string {
    return this.markdown;
  }

  private renderToolbar(): void {
    const toolbar = this.root.createDiv({
      cls: "vw-format-toolbar",
      attr: { role: "toolbar", "aria-label": "文档格式工具" }
    });

    const block = toolbar.createEl("select", {
      cls: "vw-format-select",
      attr: { title: "正文与标题层级", "aria-label": "正文与标题层级" }
    });
    [
      ["p", "正文"],
      ["h1", "标题 1"],
      ["h2", "标题 2"],
      ["h3", "标题 3"]
    ].forEach(([value, label]) => block.createEl("option", { value, text: label }));
    this.preserveSelectionOnPointer(block);
    block.addEventListener("change", () => {
      this.restoreVisualSelection();
      this.applyVisualBlock(block.value);
      this.handleVisualCommand();
    });

    const font = toolbar.createEl("select", {
      cls: "vw-format-select",
      attr: { title: "字体", "aria-label": "字体" }
    });
    [
      ["", "默认字体"],
      ["Microsoft YaHei", "微软雅黑"],
      ["SimSun", "宋体"],
      ["SimHei", "黑体"],
      ["FangSong", "仿宋"],
      ["KaiTi", "楷体"]
    ].forEach(([value, label]) => font.createEl("option", { value, text: label }));
    this.preserveSelectionOnPointer(font);
    font.addEventListener("change", () => {
      this.restoreVisualSelection();
      this.applyVisualInlineStyle({ fontFamily: font.value });
      this.handleVisualCommand();
    });

    const colorWrap = toolbar.createEl("label", {
      cls: "vw-color-control",
      attr: { title: "字体颜色" }
    });
    colorWrap.createSpan({ text: "颜色" });
    const color = colorWrap.createEl("input", {
      type: "color",
      value: "#3f76c5",
      attr: { "aria-label": "字体颜色" }
    });
    this.preserveSelectionOnPointer(color);
    color.addEventListener("input", () => {
      this.restoreVisualSelection();
      this.applyVisualInlineStyle({ color: color.value });
      this.handleVisualCommand();
    });

    const spacing = toolbar.createEl("select", {
      cls: "vw-format-select",
      attr: { title: "段落间距", "aria-label": "段落间距" }
    });
    [
      ["compact", "紧凑间距"],
      ["normal", "标准间距"],
      ["loose", "宽松间距"]
    ].forEach(([value, label]) => spacing.createEl("option", { value, text: label }));
    spacing.value = this.state.spacing;
    spacing.addEventListener("change", () => {
      this.state.spacing = spacing.value as EditorSpacing;
      this.applyDocumentPreferences();
      void this.persistState();
    });

    const headingColors = toolbar.createEl("select", {
      cls: "vw-format-select",
      attr: { title: "标题配色", "aria-label": "标题配色" }
    });
    [
      ["level", "标题层级分色"],
      ["accent", "标题统一强调"],
      ["plain", "标题跟随正文"]
    ].forEach(([value, label]) => headingColors.createEl("option", { value, text: label }));
    headingColors.value = this.state.headingColors;
    headingColors.addEventListener("change", () => {
      this.state.headingColors = headingColors.value as HeadingColorMode;
      this.applyDocumentPreferences();
      void this.persistState();
    });

    const divider = () => toolbar.createSpan({
      cls: "vw-toolbar-divider",
      attr: { "aria-hidden": "true" }
    });
    divider();
    this.commandButton(toolbar, "bold", "粗体", "bold");
    this.commandButton(toolbar, "italic", "斜体", "italic");
    this.commandButton(toolbar, "underline", "下划线", "underline");
    divider();
    this.commandButton(toolbar, "align-left", "左对齐", "justifyLeft");
    this.commandButton(toolbar, "align-center", "居中", "justifyCenter");
    this.commandButton(toolbar, "list", "无序列表", "insertUnorderedList");

    const image = this.iconButton(toolbar, "image", "插入图片");
    image.addEventListener("mousedown", () => this.captureSelection());
    image.addEventListener("click", () => void this.insertImage());

    const comment = this.iconButton(toolbar, "message-square-plus", "添加批注");
    comment.addClass("vw-comment-tool");
    comment.addEventListener("mousedown", () => this.captureSelection());
    comment.addEventListener("click", () => this.openCommentComposer());

    this.modeButton = toolbar.createEl("button", {
      text: "Markdown",
      cls: "vw-mode-toggle",
      attr: { title: "切换可视化 / Markdown 源码" }
    });
    this.modeButton.addEventListener("click", () => {
      this.setMode(this.mode === "visual" ? "markdown" : "visual");
    });
  }

  private commandButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    command: string
  ): void {
    const button = this.iconButton(parent, icon, label);
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.captureSelection();
    });
    button.addEventListener("click", () => {
      if (this.mode === "markdown") {
        this.applyMarkdownCommand(command);
        return;
      }
      this.restoreVisualSelection();
      this.applyVisualCommand(command);
      this.handleVisualCommand();
    });
  }

  private iconButton(parent: HTMLElement, icon: string, label: string): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "vw-format-button",
      attr: { title: label, "aria-label": label }
    });
    setIcon(button, icon);
    return button;
  }

  private preserveSelectionOnPointer(element: HTMLElement): void {
    element.addEventListener("mousedown", () => this.captureSelection());
  }

  private applyVisualCommand(command: string): void {
    if (command === "bold") {
      this.wrapVisualSelection("strong");
    } else if (command === "italic") {
      this.wrapVisualSelection("em");
    } else if (command === "underline") {
      this.wrapVisualSelection("u");
    } else if (command === "justifyLeft") {
      this.alignVisualBlock("left");
    } else if (command === "justifyCenter") {
      this.alignVisualBlock("center");
    } else if (command === "insertUnorderedList") {
      this.convertVisualBlockToList();
    }
  }

  private applyVisualBlock(tagName: string): void {
    const range = this.getVisualRange();
    const block = range ? this.getVisualBlock(range) : undefined;
    if (!block) return;
    const replacement = tagName === "h1"
      ? createEl("h1")
      : tagName === "h2"
        ? createEl("h2")
        : tagName === "h3"
          ? createEl("h3")
          : createEl("p");
    while (block.firstChild) replacement.appendChild(block.firstChild);
    block.replaceWith(replacement);
  }

  private applyVisualInlineStyle(styles: {
    color?: string;
    fontFamily?: string;
  }): void {
    const range = this.getVisualRange();
    if (!range || range.collapsed) return;
    const span = createEl("span");
    if (styles.color) span.style.color = styles.color;
    if (styles.fontFamily) span.style.fontFamily = styles.fontFamily;
    span.appendChild(range.extractContents());
    range.insertNode(span);
    this.selectInsertedNode(span);
  }

  private wrapVisualSelection(tagName: "strong" | "em" | "u"): void {
    const range = this.getVisualRange();
    if (!range || range.collapsed) return;
    const wrapper = tagName === "strong"
      ? createEl("strong")
      : tagName === "em"
        ? createEl("em")
        : createEl("u");
    wrapper.appendChild(range.extractContents());
    range.insertNode(wrapper);
    this.selectInsertedNode(wrapper);
  }

  private alignVisualBlock(alignment: "left" | "center"): void {
    const range = this.getVisualRange();
    const block = range ? this.getVisualBlock(range) : undefined;
    if (block) block.style.textAlign = alignment;
  }

  private convertVisualBlockToList(): void {
    const range = this.getVisualRange();
    const block = range ? this.getVisualBlock(range) : undefined;
    if (!block || block.tagName.toLowerCase() === "li") return;
    const list = createEl("ul");
    const item = list.createEl("li");
    while (block.firstChild) item.appendChild(block.firstChild);
    block.replaceWith(list);
    this.selectInsertedNode(item);
  }

  private getVisualRange(): Range | undefined {
    const selection = this.visualSurface.win.getSelection();
    if (!selection?.rangeCount) return undefined;
    const range = selection.getRangeAt(0);
    const ancestor = range.commonAncestorContainer;
    return ancestor === this.visualSurface || this.visualSurface.contains(ancestor)
      ? range
      : undefined;
  }

  private getVisualBlock(range: Range): HTMLElement | undefined {
    const ancestor = range.commonAncestorContainer;
    const element = ancestor.instanceOf(HTMLElement)
      ? ancestor
      : ancestor.parentElement;
    const block = element?.closest("p,h1,h2,h3,h4,h5,h6,blockquote,div,li");
    return block?.instanceOf(HTMLElement) && this.visualSurface.contains(block)
      ? block
      : undefined;
  }

  private selectInsertedNode(node: Node): void {
    const selection = this.visualSurface.win.getSelection();
    if (!selection) return;
    const range = this.visualSurface.doc.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  private renderVisualSurface(): void {
    const { body } = splitFrontmatter(this.markdown);
    renderMarkdownBlocks(this.visualSurface, body);
    this.hydrateVaultImages();
  }

  private syncFromVisual(): void {
    const { frontmatter } = splitFrontmatter(this.markdown);
    const body = serializeVisualBlocks(this.visualSurface);
    this.markdown = `${frontmatter}${body}`;
    this.sourceSurface.value = this.markdown;
  }

  private setMode(mode: EditorMode): void {
    if (this.mode === "visual" && mode === "markdown") this.syncFromVisual();
    if (this.mode === "markdown" && mode === "visual") {
      this.markdown = this.sourceSurface.value;
      this.renderVisualSurface();
      this.applyDocumentPreferences();
    }
    this.mode = mode;
    this.visualSurface.hidden = mode !== "visual";
    this.sourceSurface.hidden = mode !== "markdown";
    this.modeButton.setText(mode === "visual" ? "Markdown" : "可视化");
    this.root.toggleClass("is-source-mode", mode === "markdown");
  }

  private applyDocumentPreferences(): void {
    if (!this.visualSurface) return;
    ["is-spacing-compact", "is-spacing-normal", "is-spacing-loose"].forEach(
      (className) => this.visualSurface.removeClass(className)
    );
    this.visualSurface.addClass(`is-spacing-${this.state.spacing}`);
    ["is-headings-level", "is-headings-accent", "is-headings-plain"].forEach(
      (className) => this.visualSurface.removeClass(className)
    );
    this.visualSurface.addClass(`is-headings-${this.state.headingColors}`);
  }

  private handleVisualCommand(): void {
    this.visualSurface.focus();
    this.syncFromVisual();
    this.options.onChange(this.markdown);
  }

  private applyMarkdownCommand(command: string): void {
    const input = this.sourceSurface;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const value = input.value.slice(start, end);
    const wrappers: Record<string, [string, string]> = {
      bold: ["**", "**"],
      italic: ["*", "*"],
      underline: ["<u>", "</u>"]
    };
    const wrapper = wrappers[command];
    if (!wrapper) {
      if (command === "insertUnorderedList") {
        const lineStart = input.value.lastIndexOf("\n", start - 1) + 1;
        input.setRangeText("- ", lineStart, lineStart, "end");
      }
      return;
    }
    input.setRangeText(`${wrapper[0]}${value}${wrapper[1]}`, start, end, "select");
    this.markdown = input.value;
    this.options.onChange(this.markdown);
  }

  private captureSelection(): void {
    if (this.mode === "markdown") {
      const start = this.sourceSurface.selectionStart;
      const end = this.sourceSurface.selectionEnd;
      if (start === end) return;
      const quote = this.sourceSurface.value.slice(start, end).trim();
      if (!quote) return;
      this.selection = {
        quote,
        prefix: this.sourceSurface.value.slice(Math.max(0, start - 32), start),
        suffix: this.sourceSurface.value.slice(end, end + 32),
        sourceStart: start,
        sourceEnd: end
      };
      return;
    }

    const selection = this.visualSurface.win.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!this.visualSurface.contains(range.commonAncestorContainer)) return;
    const quote = selection.toString().trim();
    if (!quote) return;
    const plainText = this.visualSurface.innerText;
    const before = range.cloneRange();
    before.selectNodeContents(this.visualSurface);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    this.selection = {
      quote,
      prefix: plainText.slice(Math.max(0, start - 32), start),
      suffix: plainText.slice(start + quote.length, start + quote.length + 32),
      range: range.cloneRange()
    };
  }

  private restoreVisualSelection(): void {
    if (!this.selection?.range || this.mode !== "visual") return;
    const selection = this.visualSurface.win.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(this.selection.range);
  }

  private openCommentComposer(): void {
    this.captureSelection();
    if (!this.selection?.quote) {
      new Notice("请先选中一段原文，再点击批注");
      return;
    }
    this.composer.empty();
    this.composer.hidden = false;
    const top = this.composer.createDiv({ cls: "vw-comment-composer-top" });
    const quote = this.selection.quote.length > 120
      ? `${this.selection.quote.slice(0, 120)}…`
      : this.selection.quote;
    top.createDiv({ text: `“${quote}”`, cls: "vw-comment-quote" });
    const close = top.createEl("button", {
      text: "×",
      cls: "vw-table-column-remove",
      attr: { "aria-label": "关闭批注输入" }
    });
    close.addEventListener("click", () => { this.composer.hidden = true; });
    const input = this.composer.createEl("textarea", {
      cls: "vw-comment-input",
      attr: { placeholder: "写下批注…", "aria-label": "批注内容" }
    });
    const actions = this.composer.createDiv({ cls: "vw-comment-composer-actions" });
    const save = actions.createEl("button", {
      text: "添加批注",
      cls: "vw-primary-button"
    });
    save.addEventListener("click", () => {
      const note = input.value.trim();
      if (!note || !this.selection) return;
      this.state.comments.push({
        id: createAnnotationId(),
        quote: this.selection.quote,
        prefix: this.selection.prefix,
        suffix: this.selection.suffix,
        note,
        createdAt: new Date().toISOString(),
        resolved: false
      });
      this.composer.hidden = true;
      void this.persistState();
      this.renderComments();
    });
    input.focus();
  }

  private async insertImage(): Promise<void> {
    const path = await requestText(this.options.app, "插入图片地址或 Vault 路径");
    if (!path) return;
    if (this.mode === "markdown") {
      const start = this.sourceSurface.selectionStart;
      const end = this.sourceSurface.selectionEnd;
      this.sourceSurface.setRangeText(`![图片](${path})`, start, end, "end");
      this.markdown = this.sourceSurface.value;
      this.options.onChange(this.markdown);
      return;
    }
    this.restoreVisualSelection();
    const image = createEl("img");
    image.dataset.markdownSrc = path;
    image.alt = "图片";
    image.src = this.resolveImageSource(path);
    const selection = this.visualSurface.win.getSelection();
    if (selection?.rangeCount) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(image);
      range.setStartAfter(image);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      this.visualSurface.appendChild(image);
    }
    this.handleVisualCommand();
  }

  private hydrateVaultImages(): void {
    this.visualSurface.querySelectorAll("img").forEach((image) => {
      const source = image.dataset.markdownSrc ?? image.getAttribute("src") ?? "";
      image.dataset.markdownSrc = source;
      image.src = this.resolveImageSource(source);
    });
  }

  private resolveImageSource(source: string): string {
    if (/^(?:https?:|data:|app:|blob:)/i.test(source)) return source;
    const file = this.options.app.metadataCache.getFirstLinkpathDest(
      source,
      this.options.filePath
    );
    return file ? this.options.app.vault.getResourcePath(file) : source;
  }

  private renderComments(): void {
    this.sidebar.empty();
    const comments = this.state.comments;
    this.layout.toggleClass("has-comments", comments.length > 0);
    this.sidebar.hidden = comments.length === 0;
    if (!comments.length) return;

    const heading = this.sidebar.createDiv({ cls: "vw-comment-sidebar-heading" });
    heading.createEl("strong", { text: "批注" });
    heading.createSpan({
      text: String(comments.filter((comment) => !comment.resolved).length),
      cls: "vw-count"
    });
    comments.forEach((comment) => {
      const located = resolveAnnotation(this.markdown, comment) >= 0
        || this.visualSurface.innerText.includes(comment.quote);
      const card = this.sidebar.createDiv({
        cls: [
          "vw-comment-card",
          comment.resolved ? "is-resolved" : "",
          located ? "" : "is-orphaned"
        ].filter(Boolean).join(" ")
      });
      const quote = card.createEl("button", {
        text: located ? `“${truncate(comment.quote, 76)}”` : "原文已改变 · 待重新定位",
        cls: "vw-comment-card-quote"
      });
      quote.disabled = !located;
      quote.addEventListener("click", () => this.focusAnnotation(comment));
      card.createDiv({ text: comment.note, cls: "vw-comment-card-body" });
      card.createDiv({
        text: new Intl.DateTimeFormat("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        }).format(new Date(comment.createdAt)),
        cls: "vw-meta"
      });
      const actions = card.createDiv({ cls: "vw-comment-card-actions" });
      const resolve = actions.createEl("button", {
        text: comment.resolved ? "重新打开" : "解决",
        cls: "vw-secondary-button"
      });
      resolve.addEventListener("click", () => {
        comment.resolved = !comment.resolved;
        void this.persistState();
        this.renderComments();
      });
      const remove = actions.createEl("button", {
        text: "删除",
        cls: "vw-comment-delete"
      });
      remove.addEventListener("click", () => {
        this.state.comments = this.state.comments
          .filter((item) => item.id !== comment.id);
        void this.persistState();
        this.renderComments();
      });
    });
  }

  private refreshAnnotationStates(): void {
    if (this.state.comments.length) this.renderComments();
  }

  private focusAnnotation(comment: NoteAnnotation): void {
    if (this.mode === "markdown") {
      const index = resolveAnnotation(this.sourceSurface.value, comment);
      if (index < 0) return;
      this.sourceSurface.focus();
      this.sourceSurface.setSelectionRange(index, index + comment.quote.length);
      return;
    }
    const range = findTextRange(this.visualSurface, comment.quote);
    if (!range) return;
    this.visualSurface.focus();
    const selection = this.visualSurface.win.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    range.startContainer.parentElement?.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }

  private async persistState(): Promise<void> {
    await this.options.onStateChange({
      ...this.state,
      comments: this.state.comments.map((comment) => ({ ...comment }))
    });
  }
}

function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
  if (!markdown.startsWith("---")) return { frontmatter: "", body: markdown };
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) return { frontmatter: "", body: markdown };
  return {
    frontmatter: match[0],
    body: markdown.slice(match[0].length)
  };
}

function renderMarkdownBlocks(parent: HTMLElement, markdown: string): void {
  parent.empty();
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      const pre = parent.createEl("pre");
      const codeEl = pre.createEl("code", { text: code.join("\n") });
      if (language) codeEl.addClass(`language-${language}`);
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      const element = parent.createEl(`h${level}` as keyof HTMLElementTagNameMap);
      renderInline(element, heading[2] ?? "");
      index += 1;
      continue;
    }
    const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (task) {
      const row = parent.createDiv({ cls: "vw-editor-task-line" });
      const checkbox = row.createEl("input", {
        type: "checkbox",
        attr: { contenteditable: "false", "aria-label": "任务状态" }
      });
      checkbox.checked = (task[1] ?? "").toLowerCase() === "x";
      const text = row.createSpan({ cls: "vw-editor-task-text" });
      renderInline(text, task[2] ?? "");
      index += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const list = parent.createEl("ul");
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? "")) {
        const item = list.createEl("li");
        renderInline(item, (lines[index] ?? "").replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const list = parent.createEl("ol");
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? "")) {
        const item = list.createEl("li");
        renderInline(item, (lines[index] ?? "").replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote = parent.createEl("blockquote");
      renderInline(quote, line.replace(/^>\s?/, ""));
      index += 1;
      continue;
    }
    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      parent.createEl("hr");
      index += 1;
      continue;
    }
    const aligned = line.match(/^<div style="text-align:\s*(left|center|right)">([\s\S]*)<\/div>$/i);
    if (aligned) {
      const block = parent.createDiv();
      block.style.textAlign = aligned[1] ?? "left";
      renderInline(block, aligned[2] ?? "");
      index += 1;
      continue;
    }
    const paragraph = parent.createEl("p");
    if (line) renderInline(paragraph, line);
    else paragraph.createEl("br");
    index += 1;
  }
}

function renderInline(parent: HTMLElement, text: string): void {
  const patterns: Array<{
    regex: RegExp;
    render(match: RegExpMatchArray): void;
  }> = [
    {
      regex: /!\[([^\]]*)\]\(([^)]+)\)/,
      render: (match) => {
        const source = match[2] ?? "";
        const image = parent.createEl("img", {
          attr: { alt: match[1] ?? "", src: source }
        });
        image.dataset.markdownSrc = source;
      }
    },
    {
      regex: /\[([^\]]+)\]\(([^)]+)\)/,
      render: (match) => {
        const link = parent.createEl("a", { attr: { href: match[2] ?? "" } });
        renderInline(link, match[1] ?? "");
      }
    },
    {
      regex: /\*\*([^*]+)\*\*/,
      render: (match) => {
        const strong = parent.createEl("strong");
        renderInline(strong, match[1] ?? "");
      }
    },
    {
      regex: /__([^_]+)__/,
      render: (match) => {
        const strong = parent.createEl("strong");
        renderInline(strong, match[1] ?? "");
      }
    },
    {
      regex: /\*([^*]+)\*/,
      render: (match) => {
        const emphasis = parent.createEl("em");
        renderInline(emphasis, match[1] ?? "");
      }
    },
    {
      regex: /`([^`]+)`/,
      render: (match) => parent.createEl("code", { text: match[1] ?? "" })
    },
    {
      regex: /<u>([\s\S]*?)<\/u>/i,
      render: (match) => {
        const underline = parent.createEl("u");
        renderInline(underline, match[1] ?? "");
      }
    },
    {
      regex: /<span style="([^"]*)">([\s\S]*?)<\/span>/i,
      render: (match) => {
        const span = parent.createSpan();
        applySafeInlineStyle(span, match[1] ?? "");
        renderInline(span, match[2] ?? "");
      }
    }
  ];

  let remaining = text;
  while (remaining) {
    const candidates = patterns
      .map((pattern) => ({ pattern, match: remaining.match(pattern.regex) }))
      .filter((item): item is { pattern: typeof patterns[number]; match: RegExpMatchArray } => (
        Boolean(item.match && item.match.index !== undefined)
      ))
      .sort((a, b) => (a.match.index ?? 0) - (b.match.index ?? 0));
    const candidate = candidates[0];
    if (!candidate) {
      parent.appendText(remaining);
      return;
    }
    const index = candidate.match.index ?? 0;
    if (index > 0) parent.appendText(remaining.slice(0, index));
    candidate.pattern.render(candidate.match);
    remaining = remaining.slice(index + candidate.match[0].length);
  }
}

function serializeVisualBlocks(parent: HTMLElement): string {
  const lines: string[] = [];
  parent.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) lines.push(text);
      return;
    }
    if (!node.instanceOf(HTMLElement)) return;
    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      lines.push(`${"#".repeat(Number(tag.slice(1)))} ${serializeInline(node)}`);
    } else if (node.matches(".vw-editor-task-line")) {
      const checkbox = node.querySelector<HTMLInputElement>("input[type='checkbox']");
      const text = node.querySelector(".vw-editor-task-text");
      lines.push(`- [${checkbox?.checked ? "x" : " "}] ${text ? serializeInline(text) : ""}`);
    } else if (tag === "ul" || tag === "ol") {
      Array.from(node.children).forEach((item, index) => {
        lines.push(`${tag === "ul" ? "-" : `${index + 1}.`} ${serializeInline(item)}`);
      });
    } else if (tag === "blockquote") {
      lines.push(`> ${serializeInline(node)}`);
    } else if (tag === "pre") {
      const code = node.querySelector("code");
      const language = Array.from(code?.classList ?? [])
        .find((className) => className.startsWith("language-"))
        ?.slice("language-".length) ?? "";
      lines.push(`\`\`\`${language}\n${code?.textContent ?? node.textContent ?? ""}\n\`\`\``);
    } else if (tag === "hr") {
      lines.push("---");
    } else {
      const content = serializeInline(node);
      const alignment = node.style.textAlign;
      lines.push(
        alignment && alignment !== "left"
          ? `<div style="text-align: ${alignment}">${content}</div>`
          : content
      );
    }
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function serializeInline(node: Node): string {
  return Array.from(node.childNodes).map((child) => {
    if (child.nodeType === Node.TEXT_NODE) return child.textContent ?? "";
    if (!child.instanceOf(HTMLElement)) return "";
    const content = serializeInline(child);
    switch (child.tagName.toLowerCase()) {
      case "strong":
      case "b":
        return `**${content}**`;
      case "em":
      case "i":
        return `*${content}*`;
      case "u":
        return `<u>${content}</u>`;
      case "code":
        return `\`${child.textContent ?? ""}\``;
      case "a":
        return `[${content}](${child.getAttribute("href") ?? ""})`;
      case "img":
        return `![${child.getAttribute("alt") ?? "图片"}](${child.dataset.markdownSrc ?? child.getAttribute("src") ?? ""})`;
      case "br":
        return "";
      case "font": {
        const styles = [
          child.getAttribute("color") ? `color: ${child.getAttribute("color")}` : "",
          child.getAttribute("face") ? `font-family: ${child.getAttribute("face")}` : ""
        ].filter(Boolean).join("; ");
        return styles ? `<span style="${styles}">${content}</span>` : content;
      }
      case "span": {
        const styles = [
          child.style.color ? `color: ${child.style.color}` : "",
          child.style.fontFamily ? `font-family: ${child.style.fontFamily}` : ""
        ].filter(Boolean).join("; ");
        return styles ? `<span style="${styles}">${content}</span>` : content;
      }
      default:
        return content;
    }
  }).join("");
}

function applySafeInlineStyle(element: HTMLElement, styles: string): void {
  styles.split(";").forEach((declaration) => {
    const [rawProperty, ...rawValue] = declaration.split(":");
    const property = rawProperty?.trim().toLowerCase();
    const value = rawValue.join(":").trim();
    if (property === "color" && /^(#[\da-f]{3,8}|rgb|hsl|var\()/i.test(value)) {
      element.style.color = value;
    }
    if (property === "font-family" && value.length < 80) {
      element.style.fontFamily = value;
    }
  });
}

function createAnnotationId(): string {
  return `comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function findTextRange(root: HTMLElement, quote: string): Range | undefined {
  const walker = root.doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let text = "";
  let current = walker.nextNode();
  while (current) {
    if (current.instanceOf(Text)) {
      nodes.push(current);
      text += current.data;
    }
    current = walker.nextNode();
  }
  const start = text.indexOf(quote);
  if (start < 0) return undefined;
  const end = start + quote.length;
  let offset = 0;
  let startNode: Text | undefined;
  let endNode: Text | undefined;
  let startOffset = 0;
  let endOffset = 0;
  for (const node of nodes) {
    const next = offset + node.data.length;
    if (!startNode && start >= offset && start <= next) {
      startNode = node;
      startOffset = start - offset;
    }
    if (end >= offset && end <= next) {
      endNode = node;
      endOffset = end - offset;
      break;
    }
    offset = next;
  }
  if (!startNode || !endNode) return undefined;
  const range = root.doc.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}
