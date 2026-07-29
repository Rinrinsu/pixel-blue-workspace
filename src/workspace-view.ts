import {
  ItemView,
  Menu,
  Notice,
  normalizePath,
  setIcon,
  TFile,
  WorkspaceLeaf
} from "obsidian";
import {
  createNavigationId,
  findNavNode,
  findNavNodeLocation
} from "./navigation";
import {
  editProjectStages,
  editJuicerMetadata,
  reviewJuicerBody,
  requestConfirmation,
  requestDatabaseColumn,
  requestInspirationCapture,
  requestText
} from "./modals";
import {
  SearchMode,
  SearchService,
  SearchSyntaxError,
  VaultSearchResult
} from "./search-service";
import { ThemeManager } from "./theme-manager";
import {
  AIChatMessage,
  AIRequestContext,
  DatabaseColumn,
  NavNode,
  ProjectItem,
  TaskItem,
  VisualWorkspaceSettings,
  WorkspacePageId
} from "./types";
import {
  formatLocalDate,
  formatRelativeDate,
  VaultService
} from "./vault-service";
import {
  createDefaultEditorDocumentState,
  VisualMarkdownEditor
} from "./visual-editor";
import { AIService } from "./ai-service";
import { JuicerService } from "./juicer-service";
import { toUnknownRecord } from "./type-guards";

export const VIEW_TYPE = "visual-workspace-dashboard";

const PIXEL_ICON_ASSETS: Record<string, string> = {
  "layout-dashboard": "assets/pixel-sky/icons/dashboard.png",
  "folder-kanban": "assets/pixel-sky/icons/projects.png",
  "table-properties": "assets/pixel-sky/action-icons/database.png",
  "notebook-pen": "assets/pixel-sky/icons/daily.png",
  "calendar-days": "assets/pixel-sky/icons/calendar.png",
  "brain-circuit": "assets/pixel-sky/icons/knowledge.png",
  "library-big": "assets/pixel-sky/action-icons/knowledge-base.png",
  sparkles: "assets/pixel-sky/icons/inspiration.png",
  search: "assets/pixel-sky/action-icons/search.png",
  blender: "assets/pixel-sky/icons/juicer.png",
  "panel-right": "assets/pixel-sky/action-icons/panel-toggle.png",
  "panel-right-close": "assets/pixel-sky/action-icons/panel-toggle.png",
  "refresh-cw": "assets/pixel-sky/action-icons/refresh.png",
  pencil: "assets/pixel-sky/action-icons/navigation-rename.png",
  "list-plus": "assets/pixel-sky/action-icons/navigation-add.png",
  "folder-plus": "assets/pixel-sky/action-icons/navigation-add.png",
  "trash-2": "assets/pixel-sky/action-icons/navigation-delete.png",
  "file-text": "assets/pixel-sky/action-icons/open-source.png",
	workflow: "assets/pixel-sky/action-icons/task-done.png",
  "book-open-check": "assets/pixel-sky/action-icons/knowledge-base.png",
  wrench: "assets/pixel-sky/action-icons/settings-theme.png",
  network: "assets/pixel-sky/action-icons/knowledge-base.png"
};

export interface WorkspaceViewHost {
  settings: VisualWorkspaceSettings;
  readonly themeManager: ThemeManager;
  getAssetUrl(relativePath: string): string;
  saveSettings(): Promise<void>;
}

export class WorkspaceView extends ItemView {
  private activeNodeId = "dashboard";
  private activePage: WorkspacePageId = "dashboard";
  private activePath: string | undefined;
  private activeDate = formatLocalDate(new Date());
  private projectFilter: "doing" | "done" = "doing";
  private refreshTimer: number | undefined;
  private dailySaveTimer: number | undefined;
  private searchTimer: number | undefined;
  private searchRequest = 0;
  private searchMode: SearchMode = "relevance";
  private searchQuery = "";
  private renderToken = 0;
  private sidebarScrollTop = 0;
  private aiRequest = 0;
  private aiBusy = false;
  private aiMessages: AIChatMessage[] = [];
  private readonly juicerBusyPaths = new Set<string>();
  private activeDocumentPath: string | undefined;
  private activeEditorMarkdown:
    | { path: string; content: string }
    | undefined;
  private documentReturn:
    | { nodeId: string; page: WorkspacePageId; path?: string }
    | undefined;
  private readonly service: VaultService;
  private readonly searchService: SearchService;
  private readonly aiService: AIService;
  private readonly juicerService: JuicerService;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: WorkspaceViewHost
  ) {
    super(leaf);
    this.service = new VaultService(this.app, () => this.plugin.settings.projectTag);
    this.searchService = new SearchService(
      this.app,
      () => this.plugin.settings.searchExcludedFolders
    );
    this.aiService = new AIService(this.app, () => this.plugin.settings.ai);
    this.juicerService = new JuicerService(this.app);
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "pixel-blue Workspace"; }
  getIcon(): string { return "layout-dashboard"; }

  async onOpen(): Promise<void> {
    await this.render();
    this.registerEvent(this.app.vault.on("modify", () => this.handleVaultChange()));
    this.registerEvent(this.app.vault.on("create", () => this.handleVaultChange()));
    this.registerEvent(this.app.vault.on("delete", () => this.handleVaultChange()));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile) void this.handleFileRename(file, oldPath);
      this.handleVaultChange();
    }));
  }

  async onClose(): Promise<void> {
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer);
    if (this.dailySaveTimer !== undefined) window.clearTimeout(this.dailySaveTimer);
    if (this.searchTimer !== undefined) window.clearTimeout(this.searchTimer);
  }

  applyTheme(): void {
    const root = this.containerEl.children[1];
    if (!root?.instanceOf(HTMLElement)) return;
    root.addClass("vw-root");
    root.addClass("vw-app-root");
    this.plugin.themeManager.apply(root, {
      theme: this.plugin.settings.theme,
      iconPack: this.plugin.settings.iconPack,
      colorScheme: this.plugin.settings.colorScheme,
      colors: this.plugin.settings.customColorsEnabled
        ? this.plugin.settings.uiColors
        : undefined
    });
  }

  refresh(): Promise<void> {
    return this.render();
  }

  invalidateSearch(): void {
    this.searchService.invalidate();
  }

  private scheduleRefresh(): void {
    if (this.activePage === "daily" || this.activePage === "document") return;
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = undefined;
      void this.render();
    }, 250);
  }

  private handleVaultChange(): void {
    this.searchService.invalidate();
    this.scheduleRefresh();
  }

  private async handleFileRename(file: TFile, oldPath: string): Promise<void> {
    const state = this.plugin.settings.editorDocuments[oldPath];
    if (state) {
      delete this.plugin.settings.editorDocuments[oldPath];
      this.plugin.settings.editorDocuments[file.path] = state;
      await this.plugin.saveSettings();
    }
    if (this.activeDocumentPath === oldPath) this.activeDocumentPath = file.path;
  }

  private async render(): Promise<void> {
    const token = ++this.renderToken;
    const root = this.containerEl.children[1] as HTMLElement;
    const currentSidebar = root.querySelector<HTMLElement>(".vw-sidebar");
    if (currentSidebar) this.sidebarScrollTop = currentSidebar.scrollTop;
    root.empty();
    this.applyTheme();

    const showAI = this.plugin.settings.ai.enabled
      && this.plugin.settings.ai.sidebarOpen;
    const shell = root.createDiv({
      cls: `vw-app-shell${showAI ? " has-ai-sidebar" : ""}`
    });
    this.renderSidebar(shell);
    const workspace = shell.createDiv({ cls: "vw-workspace" });
    this.renderTopbar(workspace);
    const page = workspace.createDiv({ cls: "vw-page" });
    await this.renderActivePage(page);
    if (token !== this.renderToken) return;
    if (showAI) this.renderAISidebar(shell);
  }

  private renderSidebar(parent: HTMLElement): void {
    const sidebar = parent.createEl("aside", { cls: "vw-sidebar" });
    const brand = sidebar.createDiv({ cls: "vw-brand" });
    brand.createEl("img", {
      cls: "vw-brand-mark",
      attr: {
        src: this.plugin.getAssetUrl("assets/pixel-sky/brand-icon.png"),
        alt: "",
        "aria-hidden": "true"
      }
    });
    const brandText = brand.createDiv();
    brandText.createDiv({
      text: this.app.vault.getName() || "My Vault",
      cls: "vw-brand-title"
    });
    brandText.createDiv({ text: "PIXEL BLUE WORKSPACE", cls: "vw-brand-caption" });

    const navigation = sidebar.createEl("nav", {
      cls: "vw-navigation",
      attr: { "aria-label": "pixel-blue Workspace 导航" }
    });
    this.plugin.settings.navigation.forEach((node) => {
      this.renderNavNode(navigation, node, 0);
    });

    const hint = sidebar.createDiv({ cls: "vw-sidebar-hint" });
    hint.createSpan({ text: "右键导航可重命名、添加或删除" });

    sidebar.scrollTop = this.sidebarScrollTop;
    sidebar.addEventListener("scroll", () => {
      this.sidebarScrollTop = sidebar.scrollTop;
    }, { passive: true });
  }

  private renderNavNode(parent: HTMLElement, node: NavNode, depth: number): void {
    const wrapper = parent.createDiv({ cls: "vw-nav-node" });
    const row = wrapper.createDiv({
      cls: [
        "vw-nav-row",
        depth === 0 ? "is-group" : "",
        this.activeNodeId === node.id ? "is-active" : ""
      ].filter(Boolean).join(" ")
    });
    row.style.setProperty("--vw-nav-depth", String(depth));

    const hasChildren = Boolean(node.children?.length);
    const toggle = row.createEl("button", {
      cls: `vw-nav-toggle${hasChildren ? "" : " is-placeholder"}`,
      attr: { "aria-label": node.expanded ? "收起" : "展开" }
    });
    if (hasChildren) {
      setIcon(toggle, node.expanded ? "chevron-down" : "chevron-right");
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        node.expanded = !node.expanded;
        void this.plugin.saveSettings();
        void this.render();
      });
    }

    const button = row.createEl("button", {
      cls: "vw-nav-button",
      attr: { title: `${node.label} · 右键管理` }
    });
    if (node.icon) {
      const icon = button.createSpan({ cls: "vw-nav-icon" });
      this.setWorkspaceIcon(icon, node.icon);
    }
    button.createSpan({ text: node.label, cls: "vw-nav-label" });
    button.addEventListener("click", () => {
      if (node.page) {
        this.activeNodeId = node.id;
        this.activePage = node.page;
        this.activePath = node.path;
      } else if (hasChildren) {
        node.expanded = !node.expanded;
        void this.plugin.saveSettings();
      }
      void this.render();
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.showNavigationMenu(event, node);
    });

    if (hasChildren && node.expanded) {
      const children = wrapper.createDiv({ cls: "vw-nav-children" });
      node.children?.forEach((child) => this.renderNavNode(children, child, depth + 1));
    }
  }

  private showNavigationMenu(event: MouseEvent, node: NavNode): void {
    const menu = new Menu();
    menu.addItem((item) => item
      .setTitle("重命名")
      .setIcon("pencil")
      .onClick(() => void this.renameNavigation(node)));
    menu.addItem((item) => item
      .setTitle("添加同级")
      .setIcon("list-plus")
      .onClick(() => void this.addNavigationSibling(node)));
    menu.addItem((item) => item
      .setTitle("添加子级")
      .setIcon("folder-plus")
      .onClick(() => void this.addNavigationChild(node)));
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle("删除导航入口")
      .setIcon("trash-2")
      .onClick(() => void this.deleteNavigation(node)));
    menu.showAtMouseEvent(event);
  }

  private async renameNavigation(node: NavNode): Promise<void> {
    const label = await requestText(this.app, "重命名导航", node.label);
    if (!label) return;
    node.label = label;
    await this.plugin.saveSettings();
    await this.render();
  }

  private async addNavigationSibling(node: NavNode): Promise<void> {
    const label = await requestText(this.app, "添加同级导航");
    if (!label) return;
    const location = findNavNodeLocation(this.plugin.settings.navigation, node.id);
    if (!location) return;
    location.container.splice(location.index + 1, 0, {
      id: createNavigationId(),
      label,
      icon: "file",
      page: "collection"
    });
    await this.plugin.saveSettings();
    await this.render();
  }

  private async addNavigationChild(node: NavNode): Promise<void> {
    const label = await requestText(this.app, `在“${node.label}”下添加子级`);
    if (!label) return;
    node.children ??= [];
    node.children.push({
      id: createNavigationId(),
      label,
      icon: "file",
      page: "collection"
    });
    node.expanded = true;
    await this.plugin.saveSettings();
    await this.render();
  }

  private async deleteNavigation(node: NavNode): Promise<void> {
    const confirmed = await requestConfirmation(
      this.app,
      "删除导航入口",
      `只会删除“${node.label}”及其子级导航，不会删除 Vault 中的笔记。确认继续吗？`
    );
    if (!confirmed) return;
    const location = findNavNodeLocation(this.plugin.settings.navigation, node.id);
    if (!location) return;
    location.container.splice(location.index, 1);
    if (this.activeNodeId === node.id) {
      this.activeNodeId = "dashboard";
      this.activePage = "dashboard";
      this.activePath = undefined;
    }
    await this.plugin.saveSettings();
    await this.render();
  }

  private renderTopbar(parent: HTMLElement): void {
    const topbar = parent.createDiv({ cls: "vw-topbar" });
    const active = findNavNode(this.plugin.settings.navigation, this.activeNodeId);
    topbar.createDiv({
      text: active?.label ?? "pixel-blue Workspace",
      cls: "vw-topbar-location"
    });
    const actions = topbar.createDiv({ cls: "vw-topbar-actions" });
    const ai = actions.createEl("button", {
      cls: `vw-icon-button${this.plugin.settings.ai.sidebarOpen ? " is-active" : ""}`,
      attr: {
        "aria-label": "显示或隐藏 AI 侧栏",
        title: this.plugin.settings.ai.enabled ? "AI 助手" : "请先在设置中启用 AI"
      }
    });
    this.setWorkspaceIcon(ai, "panel-right");
    ai.createSpan({ text: "AI", cls: "vw-icon-button-label" });
    ai.addEventListener("click", () => void this.toggleAISidebar());
    const search = actions.createEl("button", {
      cls: "vw-icon-button",
      attr: { "aria-label": "全库搜索", title: "全库搜索" }
    });
    this.setWorkspaceIcon(search, "search");
    search.createSpan({ text: "搜索", cls: "vw-icon-button-label" });
    search.addEventListener("click", () => {
      this.activeNodeId = "search";
      this.activePage = "search";
      this.activePath = undefined;
      void this.render();
    });
    const refresh = actions.createEl("button", {
      cls: "vw-icon-button",
      attr: { "aria-label": "刷新当前页面", title: "刷新" }
    });
    this.setWorkspaceIcon(refresh, "refresh-cw");
    refresh.createSpan({ text: "刷新", cls: "vw-icon-button-label" });
    refresh.addEventListener("click", () => void this.render());
  }

  private async toggleAISidebar(): Promise<void> {
    if (!this.plugin.settings.ai.enabled) {
      new Notice("请先在 pixel-blue Workspace 设置中启用 AI 侧栏");
      return;
    }
    this.plugin.settings.ai.sidebarOpen = !this.plugin.settings.ai.sidebarOpen;
    await this.plugin.saveSettings();
    await this.render();
  }

  private renderAISidebar(parent: HTMLElement): void {
    const sidebar = parent.createEl("aside", { cls: "vw-ai-sidebar" });
    const header = sidebar.createDiv({ cls: "vw-ai-header" });
    const identity = header.createDiv();
    identity.createDiv({ text: "AI COMPANION", cls: "vw-section-code" });
    identity.createEl("strong", { text: providerLabel(this.plugin.settings.ai.provider) });
    const headerActions = header.createDiv({ cls: "vw-ai-header-actions" });
    if (this.aiMessages.length) {
      const clear = headerActions.createEl("button", {
        cls: "vw-icon-button",
        attr: { "aria-label": "清空本次对话", title: "清空本次对话" }
      });
      this.setWorkspaceIcon(clear, "trash-2");
      clear.addEventListener("click", () => void (async () => {
        this.aiMessages = [];
        if (this.plugin.settings.ai.provider === "codex-local") {
          this.plugin.settings.ai.codexThreadId = "";
          await this.plugin.saveSettings();
        }
        await this.render();
      })());
    }
    const close = headerActions.createEl("button", {
      cls: "vw-icon-button",
      attr: { "aria-label": "隐藏 AI 侧栏", title: "隐藏侧栏" }
    });
    this.setWorkspaceIcon(close, "panel-right-close");
    close.addEventListener("click", () => void this.toggleAISidebar());

    const contextFile = this.getAIContextFile();
    const contextExcluded = contextFile ? this.isAIExcluded(contextFile) : false;
    const context = sidebar.createDiv({ cls: "vw-ai-context" });
    const contextIcon = context.createSpan();
    this.setWorkspaceIcon(contextIcon, contextFile ? "file-text" : "circle-slash-2");
    const contextText = context.createDiv();
    contextText.createEl("strong", {
      text: contextFile ? contextFile.basename : "未选择当前笔记"
    });
    contextText.createSpan({
      text: contextExcluded
        ? "当前笔记位于 AI 排除目录，不会发送"
        : contextFile && this.plugin.settings.ai.includeCurrentNote
          ? `将发送笔记内容 · 最多 ${this.plugin.settings.ai.maxContextChars} 字`
        : "本次只发送对话文字",
      cls: "vw-meta"
    });

    const shortcuts = sidebar.createDiv({ cls: "vw-ai-shortcuts" });
    const messages = sidebar.createDiv({ cls: "vw-ai-messages" });
    this.aiMessages.forEach((message) => this.renderAIMessage(messages, message));
    if (!this.aiMessages.length) {
      messages.createDiv({
        text: "可以围绕当前笔记提问。AI 不会自动修改 Vault；需要改写时只会先给建议。",
        cls: "vw-ai-empty"
      });
    }

    const composer = sidebar.createDiv({ cls: "vw-ai-composer" });
    const input = composer.createEl("textarea", {
      cls: "vw-ai-input",
      attr: {
        placeholder: "询问、总结或整理当前笔记…",
        "aria-label": "发送给 AI 的消息"
      }
    });
    const shortcutPrompts: Array<[string, string]> = [
      ["总结", "请总结当前笔记，列出核心观点和下一步。"],
      ["提取任务", "请从当前笔记中提取可执行任务，按优先级排列。"],
      ["建议批注", "请找出当前笔记中值得补充说明的地方，并给出批注建议。"]
    ];
    shortcutPrompts.forEach(([label, prompt]) => {
      const button = shortcuts.createEl("button", {
        text: label,
        cls: "vw-ai-shortcut"
      });
      button.addEventListener("click", () => {
        input.value = prompt;
        input.focus();
      });
    });
    const footer = composer.createDiv({ cls: "vw-ai-composer-footer" });
    footer.createSpan({
      text: this.plugin.settings.ai.provider === "codex-local"
        ? `${this.plugin.settings.ai.model} · ${
          this.plugin.settings.ai.codexThreadId ? "会话已续接" : "新会话"
        } · 只读`
        : `${this.plugin.settings.ai.model} · 内容发送前受设置范围限制`,
      cls: "vw-meta"
    });
    const send = footer.createEl("button", {
      text: this.aiBusy ? "生成中…" : "发送",
      cls: "vw-primary-button"
    });
    send.disabled = this.aiBusy;
    send.addEventListener("click", () => void this.sendAIMessage(
      input,
      messages,
      send
    ));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void this.sendAIMessage(input, messages, send);
      }
    });
    window.setTimeout(() => {
      messages.scrollTop = messages.scrollHeight;
    });
  }

  private renderAIMessage(parent: HTMLElement, message: AIChatMessage): void {
    const card = parent.createDiv({
      cls: `vw-ai-message is-${message.role}`
    });
    card.createDiv({
      text: message.role === "user" ? "你" : providerLabel(this.plugin.settings.ai.provider),
      cls: "vw-ai-message-role"
    });
    card.createDiv({ text: message.content, cls: "vw-ai-message-content" });
  }

  private async sendAIMessage(
    input: HTMLTextAreaElement,
    messagesEl: HTMLElement,
    sendButton: HTMLButtonElement
  ): Promise<void> {
    const content = input.value.trim();
    if (!content || this.aiBusy) return;
    const request = ++this.aiRequest;
    this.aiBusy = true;
    input.value = "";
    sendButton.disabled = true;
    sendButton.setText("生成中…");
    const userMessage: AIChatMessage = { role: "user", content };
    this.aiMessages.push(userMessage);
    messagesEl.empty();
    this.aiMessages.forEach((message) => this.renderAIMessage(messagesEl, message));
    const loading = messagesEl.createDiv({
      text: "正在读取允许的上下文并生成回答…",
      cls: "vw-ai-loading"
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;

    try {
      const context = await this.buildAIContext();
      const result = await this.aiService.chatDetailed(
        this.aiMessages,
        context,
        this.plugin.settings.ai.provider === "codex-local"
          ? this.plugin.settings.ai.codexThreadId
          : undefined
      );
      if (request !== this.aiRequest || !messagesEl.isConnected) return;
      if (
        this.plugin.settings.ai.provider === "codex-local"
        && result.threadId
        && result.threadId !== this.plugin.settings.ai.codexThreadId
      ) {
        this.plugin.settings.ai.codexThreadId = result.threadId;
        await this.plugin.saveSettings();
      }
      this.aiMessages.push({ role: "assistant", content: result.text });
      loading.remove();
      this.renderAIMessage(messagesEl, this.aiMessages[this.aiMessages.length - 1]!);
    } catch (error) {
      if (request !== this.aiRequest || !messagesEl.isConnected) return;
      loading.setText(`连接失败：${getErrorMessage(error)}`);
      loading.addClass("is-error");
    } finally {
      if (request === this.aiRequest) {
        this.aiBusy = false;
        if (sendButton.isConnected) {
          sendButton.disabled = false;
          sendButton.setText("发送");
        }
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  private getAIContextFile(): TFile | undefined {
    if (this.activeDocumentPath) {
      const file = this.app.vault.getAbstractFileByPath(this.activeDocumentPath);
      if (file instanceof TFile) return file;
    }
    if (this.activePage === "daily") {
      const path = normalizePath(
        `${this.plugin.settings.dailyFolder}/${this.activeDate}.md`
      );
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) return file;
    }
    return this.app.workspace.getActiveFile() ?? undefined;
  }

  private async buildAIContext(): Promise<AIRequestContext> {
    const file = this.getAIContextFile();
    if (!file || !this.plugin.settings.ai.includeCurrentNote) return {};
    if (this.isAIExcluded(file)) throw new Error("当前笔记位于 AI 排除目录中");
    const editorIsOpen = this.activePage === "daily" || this.activePage === "document";
    const content = editorIsOpen && this.activeEditorMarkdown?.path === file.path
      ? this.activeEditorMarkdown.content
      : await this.app.vault.cachedRead(file);
    return {
      currentFile: file.path,
      currentContent: content.slice(0, this.plugin.settings.ai.maxContextChars)
    };
  }

  private isAIExcluded(file: TFile): boolean {
    return this.plugin.settings.ai.excludedFolders
      .map((folder) => normalizePath(folder).replace(/\/$/, ""))
      .filter(Boolean)
      .some((folder) => file.path === folder || file.path.startsWith(`${folder}/`));
  }

  private async renderActivePage(parent: HTMLElement): Promise<void> {
    switch (this.activePage) {
      case "dashboard":
        await this.renderDashboard(parent);
        break;
      case "projects":
        await this.renderProjectsPage(parent);
        break;
      case "database":
        await this.renderDatabasePage(parent);
        break;
      case "daily":
        await this.renderDailyPage(parent);
        break;
      case "daily-all":
        this.renderDailyArchive(parent);
        break;
      case "brain":
        this.renderBrainPage(parent);
        break;
      case "knowledge":
        this.renderKnowledgePage(parent);
        break;
      case "inspiration":
        await this.renderInspirationPage(parent);
        break;
      case "juicer":
        this.renderJuicerPage(parent);
        break;
      case "search":
        this.renderSearchPage(parent);
        break;
      case "document":
        await this.renderDocumentPage(parent);
        break;
      case "collection":
        this.renderCollectionPage(parent, this.activePath);
        break;
    }
  }

  private pageHeading(
    parent: HTMLElement,
    code: string,
    title: string,
    description: string,
    bannerAsset?: string
  ): HTMLElement {
    const header = parent.createDiv({
      cls: `vw-page-heading${bannerAsset ? " has-banner" : ""}`
    });
    const text = header.createDiv();
    text.createDiv({ text: code, cls: "vw-eyebrow" });
    text.createEl("h1", { text: title });
    text.createEl("p", { text: description });
    if (bannerAsset) {
      header.createEl("img", {
        cls: "vw-page-banner",
        attr: {
          src: this.plugin.getAssetUrl(bannerAsset),
          alt: "",
          "aria-hidden": "true"
        }
      });
    }
    return header;
  }

  private async renderDashboard(parent: HTMLElement): Promise<void> {
    const data = await this.service.collectDashboardData();
    const visibleTasks = this.plugin.settings.showCompleted
      ? data.tasks
      : data.tasks.filter((task) => !task.done);

    const header = parent.createDiv({ cls: "vw-header" });
    const titleBox = header.createDiv({ cls: "vw-title-box" });
    titleBox.createDiv({ text: "VISUAL VAULT / OVERVIEW", cls: "vw-eyebrow" });
    titleBox.createEl("h1", { text: "我的工作台" });
    titleBox.createEl("p", {
      text: `${new Intl.DateTimeFormat("zh-CN", { dateStyle: "full" }).format(new Date())} · 把散落的想法拼成清晰的进度`
    });
    const ornament = header.createDiv({
      cls: "vw-theme-ornament",
      attr: { "aria-hidden": "true" }
    });
    ornament.createEl("img", {
      cls: "vw-hero-collage",
      attr: {
        src: this.plugin.getAssetUrl("assets/pixel-sky/hero-collage-v2.png"),
        alt: ""
      }
    });
    ornament.createDiv({ cls: "vw-theme-shape is-cloud" });
    ornament.createDiv({ cls: "vw-theme-shape is-paper is-back" });
    ornament.createDiv({ cls: "vw-theme-shape is-paper is-front" });
    ornament.createDiv({
      text: "NOTE / PLAN / DO",
      cls: "vw-theme-shape is-tape"
    });

    const stats = parent.createDiv({ cls: "vw-stats" });
    const openPage = (nodeId: string, page: WorkspacePageId): void => {
      this.activeNodeId = nodeId;
      this.activePage = page;
      this.activePath = undefined;
      void this.render();
    };
    const scrollToBoard = (): void => {
      parent.querySelector(".vw-board-section")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    };
    this.stat(
      stats,
      "笔记",
      data.notes,
      "file-text",
      () => openPage("database", "database")
    );
    this.stat(
      stats,
      "进行中的项目",
      data.projects.filter((project) => project.status === "doing").length,
      "folder-kanban",
      () => openPage("projects", "projects")
    );
    this.stat(
      stats,
      "未完成任务",
      data.tasks.filter((task) => !task.done).length,
      "circle-check-big",
      scrollToBoard
    );
    const completed = data.tasks.length
      ? Math.round(data.tasks.filter((task) => task.done).length / data.tasks.length * 100)
      : 0;
    this.stat(
      stats,
      "任务完成率",
      `${completed}%`,
      "trending-up",
      scrollToBoard
    );

    const grid = parent.createDiv({ cls: "vw-grid" });
    this.renderProjectSummary(grid, data.projects);
    this.renderTimeline(grid, visibleTasks, data.projects);
    this.renderBoard(parent, data.tasks);
  }

  private stat(
    parent: HTMLElement,
    label: string,
    value: string | number,
    iconName: string,
    onActivate?: () => void
  ): void {
    const card = onActivate
      ? parent.createEl("button", {
          cls: "vw-stat is-action",
          attr: {
            type: "button",
            "aria-label": `${label}：${value}，点击查看`
          }
        })
      : parent.createDiv({ cls: "vw-stat" });
    onActivate && card.addEventListener("click", onActivate);
    const icon = card.createSpan({ cls: "vw-stat-icon" });
    this.setWorkspaceIcon(icon, iconName);
    const body = card.createDiv();
    body.createDiv({ text: String(value), cls: "vw-stat-value" });
    body.createDiv({ text: label, cls: "vw-muted" });
  }

  private renderProjectSummary(parent: HTMLElement, projects: ProjectItem[]): void {
    const section = parent.createDiv({ cls: "vw-section" });
    this.sectionHeading(section, "PROJECT FILES", "项目进度");
    const list = section.createDiv({ cls: "vw-project-list" });
    const active = projects.filter((project) => project.status === "doing");
    if (!active.length) {
      list.createDiv({ text: "还没有进行中的项目", cls: "vw-empty" });
    } else {
      active.slice(0, 8).forEach((project) => this.renderProjectRow(list, project));
    }
    this.renderProjectCategories(section, projects, "doing");
  }

  private renderProjectRow(parent: HTMLElement, project: ProjectItem): void {
    const row = parent.createDiv({ cls: "vw-project" });
    const top = row.createDiv({ cls: "vw-project-top" });
    const link = top.createEl("button", { text: project.title, cls: "vw-link" });
    link.addEventListener("click", () => this.openVisualDocument(project.file));
    top.createSpan({
      text: `${project.progress}%`,
      cls: `vw-status is-${project.status}`
    });
    const track = row.createDiv({ cls: "vw-progress" });
    const bar = track.createDiv({ cls: `vw-progress-bar is-${project.status}` });
    bar.style.width = `${project.progress}%`;
    if (project.area || project.due) {
      row.createDiv({
        text: [project.area, project.due].filter(Boolean).join(" · "),
        cls: "vw-meta"
      });
    }
  }

  private renderTimeline(
    parent: HTMLElement,
    tasks: TaskItem[],
    projects: ProjectItem[]
  ): void {
    const section = parent.createDiv({ cls: "vw-section" });
    this.sectionHeading(section, "SCHEDULE STRIP", "近期排期");
    const items = [
      ...tasks
        .filter((task) => !task.done && task.due)
        .map((task) => ({
          title: task.text,
          due: task.due!,
          file: task.file,
          kind: "任务"
        })),
      ...projects
        .filter((project) => project.status === "doing" && project.due)
        .map((project) => ({
          title: project.title,
          due: project.due!,
          file: project.file,
          kind: "项目"
        }))
    ].sort((a, b) => a.due.localeCompare(b.due)).slice(0, 8);
    const list = section.createDiv({ cls: "vw-timeline" });
    if (!items.length) {
      list.createDiv({ text: "添加 due 日期后会显示在这里", cls: "vw-empty" });
      return;
    }
    items.forEach((item) => {
      const row = list.createDiv({ cls: "vw-timeline-item" });
      row.createDiv({ cls: "vw-dot" });
      const body = row.createDiv();
      body.createDiv({
        text: `${formatRelativeDate(item.due)} · ${item.kind}`,
        cls: "vw-meta"
      });
      const link = body.createEl("button", { text: item.title, cls: "vw-link" });
      link.addEventListener("click", () => this.openVisualDocument(item.file));
    });
  }

  private renderBoard(parent: HTMLElement, tasks: TaskItem[]): void {
    const section = parent.createDiv({ cls: "vw-section vw-board-section" });
    this.sectionHeading(section, "TASK PATCHWORK", "任务看板");
    const board = section.createDiv({ cls: "vw-board" });
    const overdue = tasks.filter((task) => (
      !task.done
      && task.due
      && new Date(`${task.due}T23:59:59`) < new Date()
    ));
    const upcoming = tasks.filter((task) => !task.done && !overdue.includes(task));
    this.taskColumn(board, "待处理", upcoming, "todo");
    this.taskColumn(board, "已逾期", overdue, "overdue");
    this.taskColumn(board, "已完成", tasks.filter((task) => task.done), "done");
  }

  private taskColumn(
    parent: HTMLElement,
    title: string,
    tasks: TaskItem[],
    state: string
  ): void {
    const column = parent.createDiv({ cls: `vw-column is-${state}` });
    const heading = column.createDiv({ cls: "vw-column-title" });
    heading.createSpan({ text: title });
    heading.createSpan({ text: String(tasks.length), cls: "vw-count" });
    if (!tasks.length) {
      column.createDiv({ text: "暂无任务", cls: "vw-empty" });
      return;
    }
    tasks.slice(0, 12).forEach((task) => {
      const card = column.createDiv({
        cls: "vw-task",
        attr: { title: `打开来源：${task.file.basename}` }
      });
      const top = card.createDiv({ cls: "vw-task-top" });
      const completion = top.createEl("input", {
        type: "checkbox",
        cls: "vw-task-check",
        attr: {
          "aria-label": task.done ? `将“${task.text}”恢复为待处理` : `完成“${task.text}”`
        }
      });
      completion.checked = task.done;
      completion.addEventListener("change", () => {
        completion.disabled = true;
        void this.updateTask(
          task,
          completion.checked,
          task.due,
          completion.checked ? "任务已移入已完成" : "任务已恢复为待处理"
        );
      });
      const titleButton = top.createEl("button", {
        text: task.text,
        cls: "vw-link vw-task-title",
        attr: { type: "button" }
      });
      titleButton.addEventListener("click", () => {
        this.openVisualDocument(task.file);
        new Notice(`已打开：${task.file.basename}`);
      });
      card.createEl("small", {
        text: task.due
          ? `截止 ${task.due} · 来源：${task.file.basename}`
          : `来源：${task.file.basename}`,
        cls: "vw-task-meta"
      });
      const schedule = card.createEl("label", { cls: "vw-task-schedule" });
      schedule.createSpan({ text: "截止日期" });
      const dueInput = schedule.createEl("input", {
        type: "date",
        cls: "vw-task-date",
        attr: { "aria-label": `设置“${task.text}”的截止日期` }
      });
      dueInput.value = task.due ?? "";
      dueInput.addEventListener("change", () => {
        dueInput.disabled = true;
        void this.updateTask(
          task,
          task.done,
          dueInput.value || undefined,
          dueInput.value ? "截止日期已更新" : "截止日期已清除"
        );
      });
    });
    if (tasks.length > 12) {
      column.createDiv({
        text: `另有 ${tasks.length - 12} 项未在概览中展示`,
        cls: "vw-task-overflow"
      });
    }
  }

  private async renderProjectsPage(parent: HTMLElement): Promise<void> {
    const heading = this.pageHeading(
      parent,
      "PROJECT ARCHIVE",
      "项目档案",
      "每个项目都能自定义阶段名称与进度；进行中优先，已完成归档在下方。"
    );
    const create = heading.createEl("button", {
      text: "＋ 新建项目",
      cls: "vw-primary-button"
    });
    create.addEventListener("click", () => void this.createProject());
    const data = await this.service.collectDashboardData();
    const projects = data.projects.filter((project) => project.status === this.projectFilter);
    this.renderProjectGroup(
      parent,
      this.projectFilter === "doing" ? "进行中" : "已完成",
      projects,
      this.projectFilter === "doing" ? "ACTIVE" : "COMPLETED"
    );
    this.renderProjectCategories(parent, data.projects);
  }

  private renderProjectCategories(
    parent: HTMLElement,
    projects: ProjectItem[],
    selected: "doing" | "done" = this.projectFilter
  ): void {
    const categories = parent.createDiv({ cls: "vw-project-categories" });
    categories.createSpan({ text: "项目分类", cls: "vw-project-categories-label" });
    ([
      ["doing", "进行中"],
      ["done", "已完成"]
    ] as const).forEach(([status, label]) => {
      const count = projects.filter((project) => project.status === status).length;
      const button = categories.createEl("button", {
        text: `${label} ${count}`,
        cls: `vw-project-category${selected === status ? " is-active" : ""}`,
        attr: { type: "button" }
      });
      button.addEventListener("click", () => {
        this.projectFilter = status;
        this.activeNodeId = "projects";
        this.activePage = "projects";
        this.activePath = undefined;
        void this.render();
      });
    });
  }

  private async updateTask(
    task: TaskItem,
    done: boolean,
    due: string | undefined,
    successMessage: string
  ): Promise<void> {
    try {
      await this.app.vault.process(task.file, (content) => {
        const eol = content.includes("\r\n") ? "\r\n" : "\n";
        const lines = content.split(/\r?\n/);
        const current = lines[task.line];
        if (current === undefined || !/^\s*[-*]\s+\[[ xX]\]\s+/.test(current)) {
          throw new Error("任务所在行已经变化，请刷新后重试");
        }
        let next = current.replace(
          /^(\s*[-*]\s+\[)[ xX](\]\s+)/,
          `$1${done ? "x" : " "}$2`
        );
        next = next
          .replace(/\s*(?:📅|due::?)\s*\d{4}-\d{2}-\d{2}/i, "")
          .trimEnd();
        if (due) next = `${next} 📅 ${due}`;
        lines[task.line] = next;
        return lines.join(eol);
      });
      this.searchService.invalidate();
      new Notice(successMessage);
      await this.render();
    } catch (error) {
      new Notice(`任务更新失败：${getErrorMessage(error)}`, 6000);
      await this.render();
    }
  }

  private renderProjectGroup(
    parent: HTMLElement,
    title: string,
    projects: ProjectItem[],
    code: string
  ): void {
    const section = parent.createDiv({ cls: "vw-section vw-project-group" });
    this.sectionHeading(section, code, title);
    const list = section.createDiv({ cls: "vw-project-list" });
    if (!projects.length) {
      list.createDiv({ text: "暂无项目", cls: "vw-empty" });
      return;
    }
    projects.forEach((project) => this.renderProjectArchiveCard(list, project));
  }

  private renderProjectArchiveCard(parent: HTMLElement, project: ProjectItem): void {
    const card = parent.createDiv({ cls: "vw-project-archive-card" });
    const header = card.createDiv({ cls: "vw-project-archive-header" });
    const identity = header.createDiv();
    const link = identity.createEl("button", {
      text: project.title,
      cls: "vw-link vw-project-archive-title"
    });
    link.addEventListener("click", () => this.openVisualDocument(project.file));
    identity.createDiv({
      text: [project.area, project.due].filter(Boolean).join(" · ") || project.file.path,
      cls: "vw-meta"
    });
    const actions = header.createDiv({ cls: "vw-project-archive-actions" });
    actions.createSpan({
      text: `${project.progress}%`,
      cls: `vw-status is-${project.status}`
    });
    const edit = actions.createEl("button", {
      text: "管理阶段",
      cls: "vw-secondary-button"
    });
    edit.addEventListener("click", () => void this.manageProjectStages(project));

    const progress = card.createDiv({ cls: "vw-progress vw-project-total-progress" });
    const bar = progress.createDiv({ cls: `vw-progress-bar is-${project.status}` });
    bar.style.width = `${project.progress}%`;

    const stages = card.createDiv({ cls: "vw-stage-track" });
    if (!project.stages.length) {
      stages.createDiv({
        text: "还没有阶段，点击“管理阶段”开始规划。",
        cls: "vw-empty vw-stage-empty"
      });
      return;
    }
    project.stages.forEach((stage, index) => {
      const state = stage.progress >= 100
        ? "done"
        : stage.progress > 0
          ? "doing"
          : "todo";
      const item = stages.createDiv({ cls: `vw-stage-item is-${state}` });
      const top = item.createDiv({ cls: "vw-stage-top" });
      top.createSpan({ text: String(index + 1).padStart(2, "0"), cls: "vw-stage-number" });
      top.createSpan({ text: stage.name, cls: "vw-stage-name" });
      top.createSpan({ text: `${stage.progress}%`, cls: "vw-stage-value" });
      const track = item.createDiv({ cls: "vw-stage-progress" });
      const fill = track.createDiv({ cls: "vw-stage-progress-fill" });
      fill.style.width = `${stage.progress}%`;
    });
  }

  private async createProject(): Promise<void> {
    const title = await requestText(this.app, "新建项目");
    if (!title) return;
    try {
      const file = await this.service.createProject(
        this.plugin.settings.projectFolder,
        title
      );
      const stages = await editProjectStages(this.app, title, []);
      if (stages) await this.service.updateProjectStages(file, stages);
      new Notice(`项目已保存：${file.path}`);
      await this.render();
    } catch (error) {
      new Notice(`新建项目失败：${getErrorMessage(error)}`);
    }
  }

  private async manageProjectStages(project: ProjectItem): Promise<void> {
    const stages = await editProjectStages(
      this.app,
      project.title,
      project.stages
    );
    if (!stages) return;
    try {
      await this.service.updateProjectStages(project.file, stages);
      new Notice(`已更新 ${project.title} 的阶段与总进度`);
      await this.render();
    } catch (error) {
      new Notice(`保存项目阶段失败：${getErrorMessage(error)}`);
    }
  }

  private async renderDatabasePage(parent: HTMLElement): Promise<void> {
    const heading = this.pageHeading(
      parent,
      "DATABASE",
      "多维表",
      "直接编辑 Vault 笔记属性；可新增笔记、扩展字段，并从最近 28 天热力图查看任务燃尽量。"
    );
    const actions = heading.createDiv({ cls: "vw-heading-actions" });
    const create = actions.createEl("button", {
      text: "＋ 新增笔记",
      cls: "vw-primary-button"
    });
    create.addEventListener("click", () => void this.createDatabaseNote());
    const addColumn = actions.createEl("button", {
      text: "＋ 添加字段",
      cls: "vw-secondary-button"
    });
    addColumn.addEventListener("click", () => void this.addDatabaseColumn());

    const dashboard = await this.service.collectDashboardData();
    this.renderTaskHeatmap(parent, dashboard.tasks);

    const files = this.app.vault.getMarkdownFiles()
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 100);
    const section = parent.createDiv({ cls: "vw-section vw-table-section" });
    const scroller = section.createDiv({ cls: "vw-table-scroll" });
    const table = scroller.createEl("table", { cls: "vw-data-table" });
    const header = table.createEl("thead").createEl("tr");
    header.createEl("th", { text: "标题" });
    this.plugin.settings.databaseColumns.forEach((column) => {
      const cell = header.createEl("th");
      const wrap = cell.createDiv({ cls: "vw-table-header-field" });
      wrap.createSpan({ text: column.label });
      const remove = wrap.createEl("button", {
        text: "×",
        cls: "vw-table-column-remove",
        attr: { title: `从视图移除“${column.label}”` }
      });
      remove.addEventListener("click", () => void this.removeDatabaseColumn(column));
    });
    header.createEl("th", { text: "路径" });
    header.createEl("th", { text: "最近修改" });
    const body = table.createEl("tbody");
    files.forEach((file) => {
      const frontmatter = toUnknownRecord(
        this.app.metadataCache.getFileCache(file)?.frontmatter
      );
      const row = body.createEl("tr");
      const titleCell = row.createEl("td");
      const open = titleCell.createEl("button", {
        text: String(frontmatter.title ?? file.basename),
        cls: "vw-link"
      });
      open.addEventListener("click", () => this.openVisualDocument(file));
      this.plugin.settings.databaseColumns.forEach((column) => {
        const cell = row.createEl("td", { cls: "vw-editable-cell" });
        this.renderDatabaseCell(cell, file, column, frontmatter[column.property]);
      });
      row.createEl("td", { text: file.parent?.path ?? "/" });
      row.createEl("td", {
        text: new Intl.DateTimeFormat("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        }).format(file.stat.mtime)
      });
    });
  }

  private renderTaskHeatmap(parent: HTMLElement, tasks: TaskItem[]): void {
    const dates: Array<{
      date: Date;
      dateText: string;
      count: { total: number; done: number };
    }> = [];
    const byDate = new Map<string, { total: number; done: number }>();
    tasks.forEach((task) => {
      const dailyDate = /^\d{4}-\d{2}-\d{2}$/.test(task.file.basename)
        ? task.file.basename
        : undefined;
      const date = task.due ?? dailyDate;
      if (!date) return;
      const count = byDate.get(date) ?? { total: 0, done: 0 };
      count.total += 1;
      if (task.done) count.done += 1;
      byDate.set(date, count);
    });
    for (let offset = -27; offset <= 0; offset += 1) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + offset);
      const dateText = formatLocalDate(date);
      dates.push({
        date,
        dateText,
        count: byDate.get(dateText) ?? { total: 0, done: 0 }
      });
    }

    const section = parent.createDiv({ cls: "vw-section vw-heatmap" });
    const title = section.createDiv({ cls: "vw-heatmap-heading" });
    const titleText = title.createDiv();
    titleText.createDiv({ text: "LAST 28 DAYS", cls: "vw-section-code" });
    titleText.createEl("h2", { text: "任务燃尽热力图" });
    const completed = dates.reduce((sum, item) => sum + item.count.done, 0);
    const total = dates.reduce((sum, item) => sum + item.count.total, 0);
    title.createDiv({
      text: `近 28 天完成 ${completed} / ${total}`,
      cls: "vw-heatmap-summary"
    });

    const grid = section.createDiv({ cls: "vw-heatmap-grid" });
    dates.forEach(({ date, dateText, count }) => {
      const level = count.done === 0
        ? "empty"
        : count.done === 1
          ? "green"
          : count.done <= 3
            ? "blue"
            : "red";
      const cell = grid.createDiv({
        cls: `vw-heat-cell is-${level}`,
        attr: {
          title: `${dateText} · 完成 ${count.done}/${count.total}`,
          "aria-label": `${dateText} 完成 ${count.done} 个任务`
        }
      });
      cell.style.setProperty("--vw-heat-depth", String(Math.min(count.done, 6)));
      cell.createSpan({ text: String(date.getDate()) });
    });
    const legend = section.createDiv({ cls: "vw-heatmap-legend" });
    legend.createSpan({ text: "完成量" });
    [
      ["is-empty", "0"],
      ["is-green", "少"],
      ["is-blue", "中"],
      ["is-red", "多"]
    ].forEach(([className, label]) => {
      legend.createSpan({ cls: `vw-heat-legend-cell ${className}` });
      legend.createSpan({ text: label });
    });
  }

  private renderDatabaseCell(
    parent: HTMLElement,
    file: TFile,
    column: DatabaseColumn,
    rawValue: unknown
  ): void {
    if (column.type === "select") {
      const select = parent.createEl("select", { cls: "vw-cell-control" });
      select.createEl("option", { value: "", text: "—" });
      const current = String(rawValue ?? "");
      const options = [...new Set([...(column.options ?? []), current].filter(Boolean))];
      options.forEach((option) => select.createEl("option", {
        value: option,
        text: option
      }));
      select.value = current;
      if (column.property === "status") {
        this.applyStatusColorClass(select, current);
      }
      select.addEventListener("change", () => {
        if (column.property === "status") {
          this.applyStatusColorClass(select, select.value);
        }
        void this.saveDatabaseCell(file, column, select.value, select);
      });
      return;
    }

    const input = parent.createEl("input", {
      cls: "vw-cell-control",
      type: column.type === "number"
        ? "number"
        : column.type === "date"
          ? "date"
          : "text",
      value: databaseValueToText(rawValue, column.type),
      attr: {
        placeholder: column.type === "tags" ? "标签1, 标签2" : "—",
        "aria-label": `${file.basename} 的${column.label}`
      }
    });
    if (column.type === "number") {
      input.setAttr("min", "0");
      input.setAttr("step", "1");
    }
    input.addEventListener("change", () => {
      const value: unknown = column.type === "number"
        ? (input.value === "" ? "" : Number(input.value))
        : column.type === "tags"
          ? input.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)
          : input.value;
      void this.saveDatabaseCell(file, column, value, input);
    });
  }

  private applyStatusColorClass(control: HTMLElement, value: string): void {
    control.removeClass("is-status", "is-todo", "is-doing", "is-done", "is-overdue");
    control.addClass("is-status");
    const normalized = value.trim().toLowerCase();
    if (normalized === "done" || normalized === "完成" || normalized === "已完成") {
      control.addClass("is-done");
    } else if (
      normalized === "doing"
      || normalized === "进行中"
      || normalized === "active"
    ) {
      control.addClass("is-doing");
    } else if (
      normalized === "overdue"
      || normalized === "逾期"
      || normalized === "已逾期"
    ) {
      control.addClass("is-overdue");
    } else {
      control.addClass("is-todo");
    }
  }

  private async saveDatabaseCell(
    file: TFile,
    column: DatabaseColumn,
    value: unknown,
    control: HTMLElement
  ): Promise<void> {
    control.addClass("is-saving");
    try {
      await this.service.updateFrontmatter(file, column.property, value);
      control.removeClass("is-saving");
      control.addClass("is-saved");
      window.setTimeout(() => control.removeClass("is-saved"), 900);
    } catch (error) {
      control.removeClass("is-saving");
      control.addClass("is-error");
      new Notice(`保存“${column.label}”失败：${getErrorMessage(error)}`);
    }
  }

  private async createDatabaseNote(): Promise<void> {
    const title = await requestText(this.app, "新增多维表笔记");
    if (!title) return;
    try {
      const file = await this.service.createNote(
        this.plugin.settings.databaseNewNoteFolder,
        title
      );
      new Notice(`笔记已保存：${file.path}`);
      await this.render();
    } catch (error) {
      new Notice(`新增笔记失败：${getErrorMessage(error)}`);
    }
  }

  private async addDatabaseColumn(): Promise<void> {
    const column = await requestDatabaseColumn(this.app);
    if (!column) return;
    if (this.plugin.settings.databaseColumns.some(
      (item) => item.property === column.property
    )) {
      new Notice(`属性“${column.property}”已经在表格中`);
      return;
    }
    this.plugin.settings.databaseColumns.push(column);
    await this.plugin.saveSettings();
    await this.render();
  }

  private async removeDatabaseColumn(column: DatabaseColumn): Promise<void> {
    const confirmed = await requestConfirmation(
      this.app,
      "移除多维表字段",
      `只从表格视图移除“${column.label}”，不会删除笔记中已经保存的属性。确认继续吗？`
    );
    if (!confirmed) return;
    this.plugin.settings.databaseColumns = this.plugin.settings.databaseColumns
      .filter((item) => item.id !== column.id);
    await this.plugin.saveSettings();
    await this.render();
  }

  private async renderDailyPage(parent: HTMLElement): Promise<void> {
    const heading = this.pageHeading(
      parent,
      "DAILY NOTES",
      "每日笔记",
      "打开后直接记录今天的笔记、临时想法、完成事项和 AI 使用过程。",
      "assets/pixel-sky/hero-daily-notes.png"
    );
    heading.addClass("has-action");
    const allDates = heading.createEl("button", {
      text: "查看全部日期",
      cls: "vw-secondary-button"
    });
    allDates.addEventListener("click", () => {
      this.activeNodeId = "daily-all";
      this.activePage = "daily-all";
      void this.render();
    });

    const strip = parent.createDiv({ cls: "vw-date-strip" });
    for (let offset = -6; offset <= 0; offset += 1) {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      const dateText = formatLocalDate(date);
      const button = strip.createEl("button", {
        cls: `vw-date-button${dateText === this.activeDate ? " is-active" : ""}`
      });
      button.createSpan({
        text: offset === 0
          ? "今天"
          : new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date)
      });
      button.createEl("strong", { text: String(date.getDate()) });
      button.addEventListener("click", () => {
        this.activeDate = dateText;
        void this.render();
      });
    }

    const file = await this.service.getOrCreateDailyFile(
      this.plugin.settings.dailyFolder,
      this.activeDate
    );
    await this.renderEditorSection(parent, file, this.activeDate);
  }

  private async renderEditorSection(
    parent: HTMLElement,
    file: TFile,
    code: string
  ): Promise<void> {
    const editor = parent.createDiv({ cls: "vw-daily-editor vw-section" });
    const editorBar = editor.createDiv({ cls: "vw-editor-bar" });
    const editorTitle = editorBar.createDiv();
    editorTitle.createDiv({ text: code, cls: "vw-section-code" });
    editorTitle.createEl("h2", { text: file.basename });
    const editorActions = editorBar.createDiv({ cls: "vw-editor-actions" });
    const saveState = editorActions.createSpan({
      text: "已保存",
      cls: "vw-save-state"
    });
    const openSource = editorActions.createEl("button", {
      text: "在 Obsidian 编辑器中打开",
      cls: "vw-secondary-button"
    });
    openSource.addEventListener("click", () => void this.app.workspace.getLeaf().openFile(file));
    const content = await this.app.vault.read(file);
    this.activeEditorMarkdown = { path: file.path, content };
    const documentState = this.plugin.settings.editorDocuments[file.path]
      ?? createDefaultEditorDocumentState();
    const visualEditor = new VisualMarkdownEditor({
      app: this.app,
      filePath: file.path,
      markdown: content,
      state: documentState,
      onChange: (nextContent) => {
        this.activeEditorMarkdown = { path: file.path, content: nextContent };
        saveState.setText("保存中…");
        if (this.dailySaveTimer !== undefined) window.clearTimeout(this.dailySaveTimer);
        this.dailySaveTimer = window.setTimeout(async () => {
          this.dailySaveTimer = undefined;
          try {
            await this.app.vault.process(file, () => nextContent);
            saveState.setText("已保存");
          } catch {
            saveState.setText("保存失败");
            new Notice("笔记保存失败，请重试");
          }
        }, 500);
      },
      onStateChange: async (nextState) => {
        this.plugin.settings.editorDocuments[file.path] = nextState;
        await this.plugin.saveSettings();
      }
    });
    visualEditor.mount(editor);
  }

  private async renderDocumentPage(parent: HTMLElement): Promise<void> {
    const abstract = this.activeDocumentPath
      ? this.app.vault.getAbstractFileByPath(this.activeDocumentPath)
      : undefined;
    if (!(abstract instanceof TFile)) {
      parent.createDiv({
        text: "这篇笔记已经移动或删除，请返回原页面重新选择。",
        cls: "vw-empty vw-section"
      });
      return;
    }
    const heading = this.pageHeading(
      parent,
      "FOCUS EDITOR",
      abstract.basename,
      abstract.path
    );
    const back = heading.createEl("button", {
      text: "← 返回",
      cls: "vw-secondary-button"
    });
    back.addEventListener("click", () => this.closeVisualDocument());
    await this.renderEditorSection(parent, abstract, "VISUAL MARKDOWN");
  }

  private openVisualDocument(file: TFile): void {
    if (this.activePage !== "document") {
      this.documentReturn = {
        nodeId: this.activeNodeId,
        page: this.activePage,
        path: this.activePath
      };
    }
    this.activeDocumentPath = file.path;
    this.activePage = "document";
    void this.render();
  }

  private closeVisualDocument(): void {
    const target = this.documentReturn;
    this.activeNodeId = target?.nodeId ?? "dashboard";
    this.activePage = target?.page ?? "dashboard";
    this.activePath = target?.path;
    this.activeDocumentPath = undefined;
    this.documentReturn = undefined;
    void this.render();
  }

  private renderDailyArchive(parent: HTMLElement): void {
    this.pageHeading(
      parent,
      "DAILY ARCHIVE",
      "全部日期",
      "按日期浏览所有每日笔记，点击即可继续编辑。"
    );
    const files = this.service.listMarkdownInFolder(this.plugin.settings.dailyFolder);
    this.renderFileList(parent, files, "尚未创建每日笔记", (file) => {
      this.activeDate = file.basename;
      this.activeNodeId = "daily";
      this.activePage = "daily";
      void this.render();
    });
  }

  private renderBrainPage(parent: HTMLElement): void {
    this.pageHeading(
      parent,
      "KNOWLEDGE CENTER",
      "知识中心",
      "集中浏览和调用知识库中的内容，不重复复制正文。",
      "assets/pixel-sky/hero-knowledge-center.png"
    );
    const knowledge = this.service.listMarkdownInFolder(this.plugin.settings.knowledgeFolder);
    const cards = parent.createDiv({ cls: "vw-stats" });
    this.stat(cards, "知识条目", knowledge.length, "library-big");
    this.stat(cards, "最近 7 天新增", knowledge.filter((file) => (
      Date.now() - file.stat.ctime <= 7 * 86400000
    )).length, "sparkles");
    this.stat(cards, "可展开分类", 4, "folders");
    this.stat(cards, "项目引用", "待统计", "link");
    const section = parent.createDiv({ cls: "vw-section" });
    this.sectionHeading(section, "RECENT KNOWLEDGE", "最近更新");
    this.renderCompactFiles(section, knowledge.slice(0, 12));
  }

  private renderKnowledgePage(parent: HTMLElement): void {
    this.pageHeading(
      parent,
      "KNOWLEDGE BASE",
      "知识库",
      "集中保存审阅通过的正式知识条目，其他页面只引用这里。"
    );
    const files = this.service.listMarkdownInFolder(this.plugin.settings.knowledgeFolder);
    this.renderFileList(parent, files, "知识库还是空的");
  }

  private async renderInspirationPage(parent: HTMLElement): Promise<void> {
    const heading = this.pageHeading(
      parent,
      "INSPIRATION BOARD",
      "灵感收集",
      "快速保存尚未决定用途的想法、链接、截图和片段。"
    );
    const capture = heading.createEl("button", {
      text: "＋ 捕捉灵感",
      cls: "vw-primary-button vw-inspiration-capture"
    });
    capture.addEventListener("click", () => void this.captureInspiration());
    const files = this.service
      .listMarkdownInFolder(this.plugin.settings.inspirationFolder)
      .slice(0, 40);
    const wall = parent.createDiv({ cls: "vw-inspiration-wall" });
    if (!files.length) {
      const empty = wall.createDiv({ cls: "vw-inspiration-empty" });
      empty.createDiv({ text: "还没有灵感卡片", cls: "vw-inspiration-title" });
      empty.createEl("p", {
        text: "点击右上角「捕捉灵感」，第一张卡片就会出现在这里。"
      });
      const emptyCapture = empty.createEl("button", {
        text: "捕捉第一条灵感",
        cls: "vw-secondary-button"
      });
      emptyCapture.addEventListener("click", () => void this.captureInspiration());
      return;
    }
    for (const [index, file] of files.entries()) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = toUnknownRecord(cache?.frontmatter);
      const card = wall.createEl("button", {
        cls: `vw-inspiration-card is-${index % 4}`
      });
      const content = await this.app.vault.cachedRead(file);
      const image = this.resolveInspirationImage(
        typeof frontmatter.image === "string" ? frontmatter.image : ""
      );
      if (image) {
        const media = card.createDiv({ cls: "vw-inspiration-media" });
        media.createEl("img", {
          attr: {
            src: image,
            alt: String(frontmatter.title ?? file.basename),
            loading: "lazy"
          }
        });
      }
      card.createDiv({
        text: String(frontmatter.title ?? file.basename),
        cls: "vw-inspiration-title"
      });
      card.createDiv({
        text: content
          .replace(/^---[\s\S]*?---/, "")
          .replace(/^#\s+.*$/m, "")
          .replace(/[#>*_`\u005B\u005D]/g, "")
          .trim()
          .slice(0, 180) || "打开卡片继续记录…",
        cls: "vw-inspiration-excerpt"
      });
      const footer = card.createDiv({ cls: "vw-inspiration-footer" });
      footer.createSpan({
        text: new Intl.DateTimeFormat("zh-CN", {
          month: "2-digit",
          day: "2-digit"
        }).format(file.stat.mtime),
        cls: "vw-meta"
      });
      if (frontmatter.source) {
        footer.createSpan({ text: "有来源 ↗", cls: "vw-inspiration-source" });
      }
      card.addEventListener("click", () => this.openVisualDocument(file));
    }
  }

  private async captureInspiration(): Promise<void> {
    const input = await requestInspirationCapture(this.app);
    if (!input) return;
    if (input.pastedImage) {
      const attachment = await this.service.saveInspirationAttachment(
        this.plugin.settings.inspirationFolder,
        input.pastedImage
      );
      input.image = attachment.path;
    }
    await this.service.createInspiration(
      this.plugin.settings.inspirationFolder,
      input
    );
    new Notice(`已捕捉灵感：${input.title}`);
    await this.render();
  }

  private resolveInspirationImage(value: string): string | undefined {
    const normalized = value.trim();
    if (!normalized) return undefined;
    if (/^https?:\/\//i.test(normalized)) return normalized;
    const file = this.app.vault.getAbstractFileByPath(normalizePath(normalized));
    return file instanceof TFile ? this.app.vault.getResourcePath(file) : undefined;
  }

  private renderJuicerPage(parent: HTMLElement): void {
    const heading = this.pageHeading(
      parent,
      "NOTE JUICER",
      "笔记榨汁机",
      "原料经过榨汁机整理和人工审阅后，才会进入正式知识库。"
    );
    const knowledgeButton = heading.createEl("button", {
      text: "打开知识库",
      cls: "vw-secondary-button"
    });
    knowledgeButton.addEventListener("click", () => {
      this.activeNodeId = "knowledge";
      this.activePage = "knowledge";
      void this.render();
    });
    const root = this.plugin.settings.juicerFolder.replace(/\/$/, "");
    const raw = this.service.listMarkdownInFolder(`${root}/Raw`);
    const review = this.service.listMarkdownInFolder(`${root}/Review`);
    const knowledge = this.service.listMarkdownInFolder(this.plugin.settings.knowledgeFolder);
    const flow = parent.createDiv({ cls: "vw-juicer-flow" });
    const steps: Array<[string, string | number, string]> = [
      ["原料", raw.length, "inbox"],
      ["榨汁机", this.plugin.settings.ai.enabled ? "已连接" : "未启用", "sparkles"],
      ["人工审阅", review.length, "scan-text"],
      ["知识库", knowledge.length, "library-big"]
    ];
    steps.forEach(([label, value, iconName], index) => {
      const step = flow.createDiv({ cls: "vw-juicer-step" });
      const icon = step.createSpan({ cls: "vw-stat-icon" });
      this.setWorkspaceIcon(icon, iconName);
      step.createEl("strong", { text: label });
      step.createSpan({ text: String(value), cls: "vw-muted" });
      if (index < 3) {
        const arrow = flow.createSpan({ cls: "vw-flow-arrow" });
        this.setWorkspaceIcon(arrow, "arrow-right");
      }
    });
    const grid = parent.createDiv({ cls: "vw-grid" });
    const rawSection = grid.createDiv({ cls: "vw-section" });
    this.sectionHeading(rawSection, "RAW", "处理队列");
    this.renderJuicerRawQueue(rawSection, raw.slice(0, 12));
    const reviewSection = grid.createDiv({ cls: "vw-section" });
    this.sectionHeading(reviewSection, "REVIEW", "审阅队列");
    this.renderJuicerReviewQueue(reviewSection, review.slice(0, 12));
  }

  private renderJuicerRawQueue(parent: HTMLElement, files: TFile[]): void {
    const list = parent.createDiv({ cls: "vw-juicer-list" });
    if (!files.length) {
      list.createDiv({
        text: `把待处理 Markdown 放入 ${this.plugin.settings.juicerFolder}/Raw`,
        cls: "vw-empty"
      });
      return;
    }
    files.forEach((file) => {
      const frontmatter = toUnknownRecord(
        this.app.metadataCache.getFileCache(file)?.frontmatter
      );
      const processed = frontmatter.juicerStatus === "processed";
      const row = list.createDiv({ cls: "vw-juicer-card" });
      const body = row.createDiv({ cls: "vw-juicer-card-body" });
      const open = body.createEl("button", { text: file.basename, cls: "vw-link" });
      open.addEventListener("click", () => this.openVisualDocument(file));
      body.createDiv({
        text: processed ? "已生成过 Review 草稿" : file.path,
        cls: "vw-meta"
      });
      const action = row.createEl("button", {
        text: this.juicerBusyPaths.has(file.path)
          ? "处理中…"
          : processed
            ? "重新榨汁"
            : "开始榨汁",
        cls: "vw-primary-button"
      });
      action.disabled = this.juicerBusyPaths.has(file.path);
      action.addEventListener("click", () => void this.processJuicerRaw(file, action));
    });
  }

  private renderJuicerReviewQueue(parent: HTMLElement, files: TFile[]): void {
    const list = parent.createDiv({ cls: "vw-juicer-list" });
    if (!files.length) {
      list.createDiv({ text: "暂无待审阅草稿", cls: "vw-empty" });
      return;
    }
    files.forEach((file) => {
      const metadata = this.juicerService.getReviewMetadata(file);
      const card = list.createDiv({ cls: "vw-juicer-review-card" });
      const top = card.createDiv({ cls: "vw-juicer-review-top" });
      const title = top.createEl("button", { text: file.basename, cls: "vw-link" });
      title.addEventListener("click", () => this.openVisualDocument(file));
      const confidence = toUnknownRecord(
        this.app.metadataCache.getFileCache(file)?.frontmatter
      ).confidence;
      if (confidence !== undefined) {
        top.createSpan({
          text: `可信度 ${Math.round(Number(confidence) * 100)}%`,
          cls: "vw-status"
        });
      }
      const chips = card.createDiv({ cls: "vw-juicer-chips" });
      metadata.platforms.forEach((item) => {
        chips.createSpan({ text: `平台 · ${item}`, cls: "vw-juicer-chip is-platform" });
      });
      metadata.categories.forEach((item) => {
        chips.createSpan({ text: `内容 · ${item}`, cls: "vw-juicer-chip is-category" });
      });
      metadata.tags.forEach((item) => {
        chips.createSpan({ text: `#${item}`, cls: "vw-juicer-chip" });
      });
      chips.createSpan({
        text: metadata.bodyReviewStatus === "reviewed"
          ? `正文 · 已采用 ${metadata.acceptedBlocks} / 暂不采用 ${metadata.rejectedBlocks}`
          : "正文 · 待审阅",
        cls: `vw-juicer-chip ${metadata.bodyReviewStatus === "reviewed"
          ? "is-reviewed"
          : "is-pending"}`
      });
      const actions = card.createDiv({ cls: "vw-juicer-review-actions" });
      const open = actions.createEl("button", {
        text: "打开草稿",
        cls: "vw-secondary-button"
      });
      open.addEventListener("click", () => this.openVisualDocument(file));
      const bodyReview = actions.createEl("button", {
        text: "正文差异审阅",
        cls: "vw-secondary-button"
      });
      bodyReview.addEventListener("click", () => void this.reviewJuicerBody(file));
      const classify = actions.createEl("button", {
        text: "编辑分类",
        cls: "vw-secondary-button"
      });
      classify.addEventListener("click", () => void this.editJuicerReview(file));
      const approve = actions.createEl("button", {
        text: "确认入库",
        cls: "vw-primary-button"
      });
      approve.addEventListener("click", () => void this.approveJuicerReview(file));
    });
  }

  private async processJuicerRaw(
    file: TFile,
    button: HTMLButtonElement
  ): Promise<void> {
    if (!this.plugin.settings.ai.enabled) {
      new Notice("请先在设置中启用并配置 AI");
      return;
    }
    if (this.isAIExcluded(file)) {
      new Notice("该原料位于 AI 排除目录中，未发送任何内容");
      return;
    }
    this.juicerBusyPaths.add(file.path);
    button.disabled = true;
    button.setText("榨汁处理中…");
    try {
      const raw = await this.app.vault.cachedRead(file);
      const draft = await this.aiService.runJuicer(
        file.path,
        raw.slice(0, this.plugin.settings.ai.maxContextChars)
      );
      const review = await this.juicerService.createReview(
        `${this.plugin.settings.juicerFolder.replace(/\/$/, "")}/Review`,
        file,
        draft
      );
      new Notice(`Review 草稿已生成：${review.path}`);
      this.openVisualDocument(review);
    } catch (error) {
      new Notice(`榨汁失败：${getErrorMessage(error)}`, 7000);
      if (button.isConnected) {
        button.disabled = false;
        button.setText("重试榨汁");
      }
    } finally {
      this.juicerBusyPaths.delete(file.path);
    }
  }

  private async reviewJuicerBody(file: TFile): Promise<void> {
    try {
      const comparison = await this.juicerService.getReviewComparison(file);
      if (!comparison.blocks.some((block) => block.selectable)) {
        new Notice("草稿正文中没有可审阅段落");
        return;
      }
      const decisions = await reviewJuicerBody(this.app, comparison);
      if (!decisions) return;
      await this.juicerService.updateReviewDecisions(file, comparison, decisions);
      const accepted = comparison.blocks.filter(
        (block) => block.selectable && decisions[block.id] !== false
      ).length;
      const rejected = comparison.blocks.filter(
        (block) => block.selectable && decisions[block.id] === false
      ).length;
      new Notice(`正文审阅已保存：采用 ${accepted} 段，暂不采用 ${rejected} 段`);
      await this.render();
    } catch (error) {
      new Notice(`正文审阅失败：${getErrorMessage(error)}`, 7000);
    }
  }

  private async editJuicerReview(file: TFile): Promise<void> {
    const current = this.juicerService.getReviewMetadata(file);
    const next = await editJuicerMetadata(this.app, current);
    if (!next) return;
    try {
      await this.juicerService.updateReviewMetadata(file, next);
      new Notice("平台、内容分类和标签已保存");
      await this.render();
    } catch (error) {
      new Notice(`分类保存失败：${getErrorMessage(error)}`);
    }
  }

  private async approveJuicerReview(file: TFile): Promise<void> {
    const metadata = this.juicerService.getReviewMetadata(file);
    const category = metadata.categories[0] ?? "未分类";
    const reviewSummary = metadata.bodyReviewStatus === "reviewed"
      ? `正文已采用 ${metadata.acceptedBlocks} 段、暂不采用 ${metadata.rejectedBlocks} 段。`
      : "正文尚未逐段审阅，当前草稿将默认全部采用。";
    const confirmed = await requestConfirmation(
      this.app,
      "确认入库",
      `${reviewSummary} 草稿将移动到知识库的“${category}”分类下，并成为正式知识条目。确认继续吗？`
    );
    if (!confirmed) return;
    try {
      const knowledge = await this.juicerService.approveReview(
        file,
        this.plugin.settings.knowledgeFolder
      );
      new Notice(`已进入知识库：${knowledge.path}`);
      this.openVisualDocument(knowledge);
    } catch (error) {
      new Notice(`入库失败：${getErrorMessage(error)}`);
    }
  }

  private renderSearchPage(parent: HTMLElement): void {
    this.pageHeading(
      parent,
      "VAULT SEARCH",
      "全库搜索",
      "精确布尔查询与关键词加权已接入；AI 语义检索需要后续连接嵌入模型。"
    );
    const section = parent.createDiv({ cls: "vw-section vw-search-panel" });
    const modes = section.createDiv({ cls: "vw-search-tabs" });
    const modesData: Array<[string, string, string]> = [
      ["精确查询", "关键词与布尔语法，适合明确条件", "scan-search"],
      ["相关性排序", "标题、文件名和词频加权", "list-filter"],
      ["AI 语义检索", "按意思寻找相似内容，需要模型或嵌入", "brain-circuit"]
    ];
    const modeIds: SearchMode[] = ["exact", "relevance", "semantic"];
    modesData.forEach(([title, description, iconName], index) => {
      const mode = modeIds[index];
      if (!mode) return;
      const card = modes.createEl("button", {
        cls: `vw-search-tab${this.searchMode === mode ? " is-active" : ""}`,
        attr: { title: description }
      });
      const icon = card.createSpan({ cls: "vw-search-tab-icon" });
      this.setWorkspaceIcon(icon, iconName);
      const text = card.createSpan();
      text.createEl("strong", { text: title });
      text.createEl("small", { text: description });
      card.addEventListener("click", () => {
        this.searchMode = mode;
        void this.render();
      });
    });

    const form = section.createDiv({ cls: "vw-search-form" });
    const input = form.createEl("input", {
      type: "search",
      cls: "vw-search-input",
      attr: {
        placeholder: this.searchMode === "exact"
          ? "例如：title:\"检索方法\" AND tag:#学习 NOT status:done"
          : this.searchMode === "semantic"
            ? "语义检索将在连接嵌入模型后启用"
            : "输入你记得的几个词，例如：短剧 冲突 开头",
        "aria-label": "搜索整个 Vault"
      }
    });
    input.value = this.searchQuery;
    input.disabled = this.searchMode === "semantic";
    const submit = form.createEl("button", {
      text: "搜索",
      cls: "vw-primary-button"
    });
    submit.disabled = this.searchMode === "semantic";
    const status = section.createDiv({ cls: "vw-search-status" });
    const help = section.createDiv({ cls: "vw-search-help" });
    help.setText(this.searchMode === "exact"
      ? "支持 AND、OR、NOT、括号、完整短语，以及 title:、file:、path:、tag:、type:、status:、project:、before:、after:。"
      : this.searchMode === "semantic"
        ? "语义检索需要本地嵌入模型或远程 provider；当前不会把关键词结果冒充语义相似度。"
        : "排序使用 BM25 风格归一化，并按标题、文件名、别名、标签、标题层级、属性和正文词频加权。");
    const results = parent.createDiv({ cls: "vw-search-results" });

    const run = (): void => {
      this.searchQuery = input.value.trim();
      void this.executeSearch(status, results);
    };
    submit.addEventListener("click", run);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") run();
    });
    input.addEventListener("input", () => {
      this.searchQuery = input.value;
      if (this.searchTimer !== undefined) window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => {
        this.searchTimer = undefined;
        void this.executeSearch(status, results);
      }, 250);
    });

    if (this.searchMode === "semantic") {
      status.setText("等待配置语义检索 provider");
      results.createDiv({
        text: "关键词索引已经可用；语义检索的卡点是模型、密钥保存方式和私密目录授权。",
        cls: "vw-implementation-note"
      });
    } else if (this.searchQuery.trim()) {
      void this.executeSearch(status, results);
    } else {
      status.setText("输入查询后才会建立本地索引，不影响 Obsidian 启动速度。");
    }
  }

  private async executeSearch(
    status: HTMLElement,
    results: HTMLElement
  ): Promise<void> {
    const query = this.searchQuery.trim();
    if (this.searchMode === "semantic") return;
    const request = ++this.searchRequest;
    results.empty();
    if (!query) {
      status.setText("输入查询后才会建立本地索引，不影响 Obsidian 启动速度。");
      return;
    }
    status.setText("正在准备索引…");
    try {
      const found = await this.searchService.search(
        query,
        this.searchMode,
        (completed, total) => {
          if (request !== this.searchRequest || !status.isConnected) return;
          status.setText(`正在建立索引 ${completed} / ${total}`);
        }
      );
      if (request !== this.searchRequest || !results.isConnected) return;
      status.setText(`找到 ${found.length} 条结果`);
      if (!found.length) {
        results.createDiv({
          text: "没有符合条件的笔记，可以减少条件或换一种查询模式。",
          cls: "vw-empty vw-section"
        });
        return;
      }
      found.forEach((result) => this.renderSearchResult(results, result));
    } catch (error) {
      if (request !== this.searchRequest || !results.isConnected) return;
      const message = error instanceof SearchSyntaxError
        ? error.message
        : "搜索索引建立失败，请重试";
      status.setText(message);
      results.createDiv({ text: message, cls: "vw-search-error" });
    }
  }

  private renderSearchResult(
    parent: HTMLElement,
    result: VaultSearchResult
  ): void {
    const card = parent.createEl("button", { cls: "vw-search-result" });
    const top = card.createDiv({ cls: "vw-search-result-top" });
    top.createEl("strong", { text: result.title });
    top.createSpan({
      text: result.mode === "exact"
        ? `条件 ${Math.floor(result.score)}`
        : `相关度 ${result.score.toFixed(2)}`,
      cls: "vw-search-score"
    });
    card.createDiv({ text: result.filePath, cls: "vw-meta" });
    card.createDiv({ text: result.snippet, cls: "vw-search-snippet" });
    const reasons = card.createDiv({ cls: "vw-search-reasons" });
    result.reasons.forEach((reason) => {
      reasons.createSpan({ text: reason });
    });
    card.addEventListener("click", () => this.openVisualDocument(result.file));
  }

  private renderCollectionPage(parent: HTMLElement, path?: string): void {
    const active = findNavNode(this.plugin.settings.navigation, this.activeNodeId);
    this.pageHeading(
      parent,
      "COLLECTION",
      active?.label ?? "自定义分类",
      path
        ? `读取 Vault 目录：${path}`
        : "这是一个自定义导航分类，可继续右键增加子级。"
    );
    if (!path) {
      parent.createDiv({
        text: "该导航尚未绑定 Vault 目录，后续会在分类属性中提供目录选择。",
        cls: "vw-empty vw-section"
      });
      return;
    }
    this.renderFileList(
      parent,
      this.service.listMarkdownInFolder(path),
      "该目录下还没有 Markdown 笔记"
    );
  }

  private renderFileList(
    parent: HTMLElement,
    files: TFile[],
    emptyText: string,
    onClick?: (file: TFile) => void
  ): void {
    const section = parent.createDiv({ cls: "vw-section" });
    const list = section.createDiv({ cls: "vw-file-list" });
    if (!files.length) {
      list.createDiv({ text: emptyText, cls: "vw-empty" });
      return;
    }
    files.forEach((file) => {
      const button = list.createEl("button", { cls: "vw-file-row" });
      const icon = button.createSpan({ cls: "vw-file-icon" });
      this.setWorkspaceIcon(icon, "file-text");
      const body = button.createDiv();
      body.createEl("strong", { text: file.basename });
      body.createSpan({ text: file.path, cls: "vw-meta" });
      button.addEventListener("click", () => {
        if (onClick) onClick(file);
        else this.openVisualDocument(file);
      });
    });
  }

  private renderCompactFiles(parent: HTMLElement, files: TFile[]): void {
    const list = parent.createDiv({ cls: "vw-compact-files" });
    if (!files.length) {
      list.createDiv({ text: "暂无内容", cls: "vw-empty" });
      return;
    }
    files.forEach((file) => {
      const button = list.createEl("button", { cls: "vw-compact-file" });
      button.createSpan({ text: file.basename });
      button.createSpan({
        text: new Intl.DateTimeFormat("zh-CN", {
          month: "2-digit",
          day: "2-digit"
        }).format(file.stat.mtime),
        cls: "vw-meta"
      });
      button.addEventListener("click", () => this.openVisualDocument(file));
    });
  }

  private sectionHeading(parent: HTMLElement, label: string, title: string): void {
    const heading = parent.createDiv({ cls: "vw-section-heading" });
    heading.createDiv({ text: label, cls: "vw-section-code" });
    heading.createEl("h2", { text: title });
  }

  private setWorkspaceIcon(element: HTMLElement, iconName: string): void {
    const asset = this.plugin.settings.iconPack === "pixel-blue"
      ? PIXEL_ICON_ASSETS[iconName]
      : undefined;
    if (!asset) {
      setIcon(element, iconName);
      return;
    }
    element.empty();
    element.createEl("img", {
      cls: "vw-pixel-icon",
      attr: {
        src: this.plugin.getAssetUrl(asset),
        alt: "",
        "aria-hidden": "true"
      }
    });
  }
}

function databaseValueToText(
  value: unknown,
  type: DatabaseColumn["type"]
): string {
  if (value === undefined || value === null) return "";
  if (type === "tags" && Array.isArray(value)) return value.map(String).join(", ");
  if (value instanceof Date) return formatLocalDate(value);
  return String(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function providerLabel(provider: VisualWorkspaceSettings["ai"]["provider"]): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic") return "Claude";
  if (provider === "codex-local") return "Codex";
  return "AI Gateway";
}
