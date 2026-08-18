import {
  App,
  Notice,
  normalizePath,
  Plugin,
  PluginSettingTab,
  Setting
} from "obsidian";
import type { SettingDefinition, SettingDefinitionItem } from "obsidian";
import { createDefaultNavigation } from "./navigation";
import {
  ColorSchemeId,
  IconPackId,
  ThemeId,
  ThemeManager,
  WorkspaceColorPalette
} from "./theme-manager";
import { DatabaseColumn, NavNode, VisualWorkspaceSettings } from "./types";
import { AIService, getAISecretId } from "./ai-service";
import { VIEW_TYPE, WorkspaceView } from "./workspace-view";
import { getEmbeddedAssetUrl } from "./embedded-assets";
import { GlobalThemeManager } from "./global-theme";

function createDefaultDatabaseColumns(): DatabaseColumn[] {
  return [
    { id: "db-type", label: "类型", property: "type", type: "text" },
    {
      id: "db-status",
      label: "状态",
      property: "status",
      type: "select",
      options: ["todo", "doing", "done"]
    },
    { id: "db-progress", label: "进度", property: "progress", type: "number" },
    { id: "db-due", label: "截止日期", property: "due", type: "date" },
    { id: "db-tags", label: "标签", property: "tags", type: "tags" }
  ];
}

const NAVIGATION_ICON_DEFAULTS: Record<string, string> = {
  "group-execution": "workflow",
  "group-knowledge": "book-open-check",
  "group-tools": "wrench"
};

function applyNavigationVisualDefaults(nodes: NavNode[]): void {
  nodes.forEach((node) => {
    node.icon ??= NAVIGATION_ICON_DEFAULTS[node.id];
    if (node.children) applyNavigationVisualDefaults(node.children);
  });
}

const DEFAULT_SETTINGS: VisualWorkspaceSettings = {
  projectTag: "project",
  horizonDays: 30,
  showCompleted: true,
  theme: "pixel-sky",
  iconPack: "pixel-blue",
  colorScheme: "light",
  globalThemeEnabled: false,
  customColorsEnabled: false,
  uiColors: {
    text: "#18344d",
    muted: "#587791",
    todo: "#6b7f91",
    doing: "#2f78ad",
    done: "#2f8f64",
    overdue: "#c34444"
  },
  hideObsidianSidebarOnOpen: true,
  dailyFolder: "Daily Notes",
  projectFolder: "Projects",
  databaseNewNoteFolder: "Inbox",
  databaseColumns: createDefaultDatabaseColumns(),
  ai: {
    enabled: false,
    sidebarOpen: false,
    provider: "openai",
    model: "gpt-5.6-terra",
    openaiBaseUrl: "https://api.openai.com/v1",
    anthropicBaseUrl: "https://api.anthropic.com/v1",
    bridgeUrl: "http://127.0.0.1:7777",
    gatewayUrl: "",
    codexThreadId: "",
    includeCurrentNote: false,
    maxContextChars: 24000,
    reasoningEffort: "medium",
    excludedFolders: []
  },
  knowledgeFolder: "Knowledge",
  inspirationFolder: "Inspiration",
  juicerFolder: "Juicer",
  searchExcludedFolders: [],
  navigation: createDefaultNavigation()
};

type SettingsControlKey =
  | "projectTag"
  | "showCompleted"
  | "aiEnabled"
  | "aiProvider"
  | "aiModel"
  | "aiEndpoint"
  | "aiIncludeCurrentNote"
  | "aiMaxContextChars"
  | "aiReasoningEffort"
  | "aiExcludedFolders"
  | "dailyFolder"
  | "projectFolder"
  | "databaseNewNoteFolder"
  | "knowledgeFolder"
  | "inspirationFolder"
  | "juicerFolder"
  | "searchExcludedFolders"
  | "theme"
  | "globalThemeEnabled"
  | "colorScheme"
  | "customColorsEnabled"
  | "colorText"
  | "colorMuted"
  | "colorTodo"
  | "colorDoing"
  | "colorDone"
  | "colorOverdue"
  | "iconPack"
  | "hideObsidianSidebarOnOpen";

export default class VisualWorkspacePlugin extends Plugin {
  settings: VisualWorkspaceSettings = DEFAULT_SETTINGS;
  readonly themeManager = new ThemeManager();
  readonly globalThemeManager = new GlobalThemeManager();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.applyGlobalTheme();
    this.registerView(VIEW_TYPE, (leaf) => new WorkspaceView(leaf, this));

    this.addRibbonIcon(
      "layout-dashboard",
      "打开 pixel-blue Workspace",
      () => void this.activateView()
    );
    this.addCommand({
      id: "open-visual-workspace",
      name: "打开可视化工作台",
      callback: () => void this.activateView()
    });
    this.registerObsidianProtocolHandler(
      "pixel-blue-workspace",
      () => void this.activateView()
    );
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        this.applyThemeToOpenViews();
        this.applyGlobalTheme();
      })
    );
    this.addSettingTab(new VisualWorkspaceSettingTab(this.app, this));
  }

  onunload(): void {
    this.clearGlobalTheme();
  }

  async activateView(): Promise<void> {
    if (this.settings.hideObsidianSidebarOnOpen && !this.app.workspace.leftSplit.collapsed) {
      this.app.workspace.leftSplit.collapse();
    }
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  getAssetUrl(relativePath: string): string {
    const embedded = getEmbeddedAssetUrl(relativePath);
    if (embedded) return embedded;
    const pluginDir = this.manifest.dir
      ?? normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}`);
    return this.app.vault.adapter.getResourcePath(normalizePath(`${pluginDir}/${relativePath}`));
  }

  async loadSettings(): Promise<void> {
    const saved = await this.loadData() as Partial<VisualWorkspaceSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(saved ?? {}),
      navigation: saved?.navigation?.length
        ? saved.navigation
        : createDefaultNavigation(),
      databaseColumns: saved?.databaseColumns?.length
        ? saved.databaseColumns
        : createDefaultDatabaseColumns(),
      uiColors: {
        ...DEFAULT_SETTINGS.uiColors,
        ...(saved?.uiColors ?? {})
      },
      ai: {
        ...DEFAULT_SETTINGS.ai,
        ...(saved?.ai ?? {})
      }
    };
    applyNavigationVisualDefaults(this.settings.navigation);
    await this.saveSettings();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  applyThemeToOpenViews(): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof WorkspaceView) view.applyTheme();
    });
  }

  applyGlobalTheme(): void {
    this.globalThemeManager.apply(document.body, {
      enabled: this.settings.globalThemeEnabled,
      colorScheme: this.settings.colorScheme,
      colors: this.settings.customColorsEnabled
        ? this.settings.uiColors
        : undefined
    });
  }

  clearGlobalTheme(): void {
    this.globalThemeManager.clear(document.body);
  }

  refreshOpenViews(): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof WorkspaceView) void view.refresh();
    });
  }

  invalidateSearchIndexes(): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof WorkspaceView) view.invalidateSearch();
    });
  }
}

class VisualWorkspaceSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: VisualWorkspacePlugin
  ) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const provider = this.plugin.settings.ai.provider;
    const hasCustomColors = this.plugin.settings.customColorsEnabled;
    return [
      {
        type: "group",
        heading: "工作区",
        items: [
          {
            name: "项目标签",
            desc: "除项目区的进行中/已完成目录外，带有该标签或 type: project 的笔记也会被识别",
            control: { type: "text", key: "projectTag" }
          },
          {
            name: "显示已完成任务",
            control: { type: "toggle", key: "showCompleted" }
          }
        ]
      },
      {
        type: "group",
        heading: "AI 与右侧栏",
        items: [
          {
            name: "启用 AI 侧栏",
            desc: "启用后可在工作区右上角显示或隐藏 AI 助手",
            control: { type: "toggle", key: "aiEnabled" }
          },
          {
            name: "AI 提供商",
            desc: "本机 Codex 仅供 Windows 仓库开发环境使用；官方安装和 Mac 请使用 API 或安全网关",
            control: {
              type: "dropdown",
              key: "aiProvider",
              options: {
                openai: "OpenAI API",
                anthropic: "Claude API",
                "codex-local": "本机 Codex（Windows 开发）",
                gateway: "自定义安全网关"
              }
            }
          },
          {
            name: "模型",
            desc: "填写提供商实际支持的模型 ID",
            control: { type: "text", key: "aiModel" }
          },
          {
            name: "接口地址",
            desc: "通常保留默认值；网关和本机桥接需填写自己的 HTTPS/本机地址",
            control: { type: "text", key: "aiEndpoint" }
          },
          {
            name: "Codex 会话",
            desc: this.plugin.settings.ai.codexThreadId
              ? `已保存并续接：${this.plugin.settings.ai.codexThreadId.slice(0, 18)}…`
              : "尚未开始；第一次发送消息后会自动保存 thread ID",
            visible: provider === "codex-local",
            render: (setting) => {
              setting.addButton((button) => button
                .setButtonText("新建会话")
                .setDisabled(!this.plugin.settings.ai.codexThreadId)
                .onClick(async () => {
                  this.plugin.settings.ai.codexThreadId = "";
                  await this.plugin.saveSettings();
                  this.refreshSettings();
                  this.plugin.refreshOpenViews();
                }));
            }
          },
          this.secretSettingDefinition(),
          {
            name: "发送当前笔记",
            desc: "关闭后，侧栏只发送你输入的问题",
            control: { type: "toggle", key: "aiIncludeCurrentNote" }
          },
          {
            name: "上下文长度上限",
            desc: "限制单次发送的当前笔记字符数，避免意外发送过多内容",
            control: {
              type: "number",
              key: "aiMaxContextChars",
              min: 1000,
              max: 100000,
              step: 1000
            }
          },
          {
            name: "推理强度",
            control: {
              type: "dropdown",
              key: "aiReasoningEffort",
              options: {
                none: "无",
                low: "低",
                medium: "中等",
                high: "高"
              }
            }
          },
          {
            name: "AI 排除目录",
            desc: "这些目录中的笔记永远不会作为当前笔记上下文发送，用逗号分隔",
            control: {
              type: "text",
              key: "aiExcludedFolders",
              placeholder: "例如：Private, 财务/原始凭证"
            }
          }
        ]
      },
      {
        type: "group",
        heading: "目录",
        items: [
          this.folderDefinition("每日笔记目录", "每日笔记会按 YYYY-MM-DD.md 保存到这里", "dailyFolder"),
          this.folderDefinition("项目档案目录", "在项目档案中创建的项目保存位置", "projectFolder"),
          this.folderDefinition("多维表新笔记目录", "从多维表新增笔记的保存位置", "databaseNewNoteFolder"),
          this.folderDefinition("知识库目录", "审阅通过的正式知识条目目录", "knowledgeFolder"),
          this.folderDefinition("灵感收集目录", "灵感卡片读取目录", "inspirationFolder"),
          this.folderDefinition("榨汁机目录", "内部使用 Raw、Review 和 Categories 子目录", "juicerFolder"),
          {
            name: "搜索排除目录",
            desc: "用英文逗号分隔；Vault 配置目录和回收站始终排除",
            control: {
              type: "text",
              key: "searchExcludedFolders",
              placeholder: "例如：Private, Attachments/Secret"
            }
          }
        ]
      },
      {
        type: "group",
        heading: "外观",
        items: [
          {
            name: "外观主题",
            desc: "主题只改变颜色、字体、边框和装饰，不改变功能与数据",
            control: {
              type: "dropdown",
              key: "theme",
              options: { obsidian: "跟随 Obsidian", "pixel-sky": "pixel-blue" }
            }
          },
          {
            name: "全局美化模式",
            desc: "把 pixel-blue 配色、纹理和边框扩展到 Obsidian 原生界面",
            control: { type: "toggle", key: "globalThemeEnabled" }
          },
          {
            name: "插件明暗模式",
            control: {
              type: "dropdown",
              key: "colorScheme",
              options: {
                light: "浅色",
                dark: "深色",
                system: "跟随 Obsidian"
              }
            }
          },
          {
            name: "自定义界面文字与状态颜色",
            control: { type: "toggle", key: "customColorsEnabled" }
          },
          {
            name: "主要文字",
            visible: hasCustomColors,
            control: { type: "color", key: "colorText" }
          },
          {
            name: "辅助文字",
            visible: hasCustomColors,
            control: { type: "color", key: "colorMuted" }
          },
          {
            name: "待处理状态",
            visible: hasCustomColors,
            control: { type: "color", key: "colorTodo" }
          },
          {
            name: "进行中状态",
            visible: hasCustomColors,
            control: { type: "color", key: "colorDoing" }
          },
          {
            name: "已完成状态",
            visible: hasCustomColors,
            control: { type: "color", key: "colorDone" }
          },
          {
            name: "逾期 / 错误状态",
            visible: hasCustomColors,
            control: { type: "color", key: "colorOverdue" }
          },
          {
            name: "恢复推荐配色",
            desc: "恢复 pixel-blue 的推荐文字与状态色",
            visible: hasCustomColors,
            render: (setting) => {
              setting.addButton((button) => button
                .setButtonText("恢复")
                .onClick(async () => {
                  this.plugin.settings.uiColors = { ...DEFAULT_SETTINGS.uiColors };
                  await this.plugin.saveSettings();
                  this.plugin.applyThemeToOpenViews();
                  this.plugin.applyGlobalTheme();
                  this.refreshSettings();
                }));
            }
          },
          {
            name: "图标包",
            control: {
              type: "dropdown",
              key: "iconPack",
              options: {
                obsidian: "Obsidian 默认",
                "pixel-blue": "Pixel Blue"
              }
            }
          },
          {
            name: "打开插件时隐藏 Obsidian 左栏",
            desc: "只收起原生文件栏，不修改文件或文件夹",
            control: { type: "toggle", key: "hideObsidianSidebarOnOpen" }
          },
          {
            name: "恢复默认导航",
            desc: "仅重置左侧导航结构，不删除任何 Vault 文件",
            render: (setting) => {
              setting.addButton((button) => button
                .setButtonText("恢复")
                .onClick(async () => {
                  this.plugin.settings.navigation = createDefaultNavigation();
                  await this.plugin.saveSettings();
                  this.plugin.refreshOpenViews();
                  this.refreshSettings();
                }));
            }
          }
        ]
      }
    ];
  }

  getControlValue(key: string): unknown {
    switch (key as SettingsControlKey) {
      case "projectTag": return this.plugin.settings.projectTag;
      case "showCompleted": return this.plugin.settings.showCompleted;
      case "aiEnabled": return this.plugin.settings.ai.enabled;
      case "aiProvider": return this.plugin.settings.ai.provider;
      case "aiModel": return this.plugin.settings.ai.model;
      case "aiEndpoint": return this.plugin.settings.ai[this.aiEndpointKey()];
      case "aiIncludeCurrentNote": return this.plugin.settings.ai.includeCurrentNote;
      case "aiMaxContextChars": return this.plugin.settings.ai.maxContextChars;
      case "aiReasoningEffort": return this.plugin.settings.ai.reasoningEffort;
      case "aiExcludedFolders": return this.plugin.settings.ai.excludedFolders.join(", ");
      case "dailyFolder": return this.plugin.settings.dailyFolder;
      case "projectFolder": return this.plugin.settings.projectFolder;
      case "databaseNewNoteFolder": return this.plugin.settings.databaseNewNoteFolder;
      case "knowledgeFolder": return this.plugin.settings.knowledgeFolder;
      case "inspirationFolder": return this.plugin.settings.inspirationFolder;
      case "juicerFolder": return this.plugin.settings.juicerFolder;
      case "searchExcludedFolders": return this.plugin.settings.searchExcludedFolders.join(", ");
      case "theme": return this.plugin.settings.theme;
      case "globalThemeEnabled": return this.plugin.settings.globalThemeEnabled;
      case "colorScheme": return this.plugin.settings.colorScheme;
      case "customColorsEnabled": return this.plugin.settings.customColorsEnabled;
      case "colorText": return this.plugin.settings.uiColors.text;
      case "colorMuted": return this.plugin.settings.uiColors.muted;
      case "colorTodo": return this.plugin.settings.uiColors.todo;
      case "colorDoing": return this.plugin.settings.uiColors.doing;
      case "colorDone": return this.plugin.settings.uiColors.done;
      case "colorOverdue": return this.plugin.settings.uiColors.overdue;
      case "iconPack": return this.plugin.settings.iconPack;
      case "hideObsidianSidebarOnOpen": return this.plugin.settings.hideObsidianSidebarOnOpen;
      default: return undefined;
    }
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const text = typeof value === "string" ? value : "";
    switch (key as SettingsControlKey) {
      case "projectTag":
        this.plugin.settings.projectTag = text.replace(/^#/, "").trim() || "project";
        break;
      case "showCompleted":
        this.plugin.settings.showCompleted = value === true;
        break;
      case "aiEnabled":
        this.plugin.settings.ai.enabled = value === true;
        if (!this.plugin.settings.ai.enabled) this.plugin.settings.ai.sidebarOpen = false;
        break;
      case "aiProvider":
        if (!["openai", "anthropic", "codex-local", "gateway"].includes(text)) return;
        this.plugin.settings.ai.provider = text as typeof this.plugin.settings.ai.provider;
        if (text === "openai") this.plugin.settings.ai.model = "gpt-5.6-terra";
        if (text === "anthropic") this.plugin.settings.ai.model = "claude-sonnet-4-20250514";
        if (text === "codex-local") this.plugin.settings.ai.model = "default";
        break;
      case "aiModel":
        this.plugin.settings.ai.model = text.trim();
        break;
      case "aiEndpoint":
        this.plugin.settings.ai[this.aiEndpointKey()] = text.trim();
        break;
      case "aiIncludeCurrentNote":
        this.plugin.settings.ai.includeCurrentNote = value === true;
        break;
      case "aiMaxContextChars":
        this.plugin.settings.ai.maxContextChars = Math.max(
          1000,
          Math.min(100000, typeof value === "number" ? value : 24000)
        );
        break;
      case "aiReasoningEffort":
        if (!["none", "low", "medium", "high"].includes(text)) return;
        this.plugin.settings.ai.reasoningEffort = text as typeof this.plugin.settings.ai.reasoningEffort;
        break;
      case "aiExcludedFolders":
        this.plugin.settings.ai.excludedFolders = text
          .split(/[,，]/)
          .map((folder) => folder.trim().replace(/^\/+|\/+$/g, ""))
          .filter(Boolean);
        break;
      case "dailyFolder":
      case "projectFolder":
      case "databaseNewNoteFolder":
      case "knowledgeFolder":
      case "inspirationFolder":
      case "juicerFolder": {
        const folderKey = key as
          | "dailyFolder"
          | "projectFolder"
          | "databaseNewNoteFolder"
          | "knowledgeFolder"
          | "inspirationFolder"
          | "juicerFolder";
        this.plugin.settings[folderKey] = text.trim().replace(/^\/+|\/+$/g, "");
        break;
      }
      case "searchExcludedFolders":
        this.plugin.settings.searchExcludedFolders = text
          .split(",")
          .map((folder) => folder.trim())
          .filter(Boolean);
        break;
      case "theme":
        if (!["obsidian", "pixel-sky"].includes(text)) return;
        this.plugin.settings.theme = text as ThemeId;
        break;
      case "globalThemeEnabled":
        this.plugin.settings.globalThemeEnabled = value === true;
        break;
      case "colorScheme":
        if (!["light", "dark", "system"].includes(text)) return;
        this.plugin.settings.colorScheme = text as ColorSchemeId;
        break;
      case "customColorsEnabled":
        this.plugin.settings.customColorsEnabled = value === true;
        break;
      case "colorText": this.plugin.settings.uiColors.text = text; break;
      case "colorMuted": this.plugin.settings.uiColors.muted = text; break;
      case "colorTodo": this.plugin.settings.uiColors.todo = text; break;
      case "colorDoing": this.plugin.settings.uiColors.doing = text; break;
      case "colorDone": this.plugin.settings.uiColors.done = text; break;
      case "colorOverdue": this.plugin.settings.uiColors.overdue = text; break;
      case "iconPack":
        if (!["obsidian", "pixel-blue"].includes(text)) return;
        this.plugin.settings.iconPack = text as IconPackId;
        break;
      case "hideObsidianSidebarOnOpen":
        this.plugin.settings.hideObsidianSidebarOnOpen = value === true;
        break;
      default:
        return;
    }
    await this.plugin.saveSettings();
    this.applySettingSideEffects(key as SettingsControlKey);
  }

  private secretSettingDefinition(): SettingDefinition {
    const provider = this.plugin.settings.ai.provider;
    const secretId = getAISecretId(provider);
    const hasSecret = Boolean(this.app.secretStorage.getSecret(secretId));
    return {
      name: provider === "codex-local" ? "桥接令牌" : "API 密钥",
      desc: hasSecret ? "已安全保存；留空不会覆盖现有密钥" : "尚未配置",
      render: (setting) => {
        setting
          .addText((text) => {
            text.inputEl.type = "password";
            text.setPlaceholder(hasSecret ? "••••••••（已配置）" : "粘贴密钥");
            text.onChange((value) => {
              const secret = value.trim();
              if (secret) this.app.secretStorage.setSecret(secretId, secret);
            });
          })
          .addButton((button) => button
            .setButtonText("清除")
            .onClick(() => {
              this.app.secretStorage.setSecret(secretId, "");
              this.refreshSettings();
            }))
          .addButton((button) => button
            .setButtonText("测试连接")
            .onClick(async () => {
              button.setDisabled(true);
              button.setButtonText("测试中…");
              try {
                await new AIService(this.app, () => this.plugin.settings.ai)
                  .testConnection();
                button.setButtonText("连接成功");
              } catch (error) {
                button.setButtonText("连接失败");
                new Notice(
                  `AI 连接失败：${error instanceof Error ? error.message : String(error)}`
                );
              } finally {
                window.setTimeout(() => {
                  button.setDisabled(false);
                  button.setButtonText("测试连接");
                }, 1500);
              }
            }));
      }
    };
  }

  private folderDefinition(
    name: string,
    desc: string,
    key:
      | "dailyFolder"
      | "projectFolder"
      | "databaseNewNoteFolder"
      | "knowledgeFolder"
      | "inspirationFolder"
      | "juicerFolder"
  ): SettingDefinition {
    return {
      name,
      desc,
      control: {
        type: "folder",
        key,
        includeRoot: true
      }
    };
  }

  private aiEndpointKey():
    | "openaiBaseUrl"
    | "anthropicBaseUrl"
    | "bridgeUrl"
    | "gatewayUrl" {
    return this.plugin.settings.ai.provider === "openai"
      ? "openaiBaseUrl"
      : this.plugin.settings.ai.provider === "anthropic"
        ? "anthropicBaseUrl"
        : this.plugin.settings.ai.provider === "codex-local"
          ? "bridgeUrl"
          : "gatewayUrl";
  }

  private applySettingSideEffects(key: SettingsControlKey): void {
    if (key === "searchExcludedFolders") {
      this.plugin.invalidateSearchIndexes();
    }
    if (
      key === "theme"
      || key === "colorScheme"
      || key === "customColorsEnabled"
      || key === "iconPack"
      || key.startsWith("color")
    ) {
      this.plugin.applyThemeToOpenViews();
    }
    if (
      key === "globalThemeEnabled"
      || key === "colorScheme"
      || key === "customColorsEnabled"
      || key.startsWith("color")
    ) {
      this.plugin.applyGlobalTheme();
    }
    this.plugin.refreshOpenViews();
    if (key === "aiProvider" || key === "customColorsEnabled") {
      this.refreshSettings();
    }
  }

  private refreshSettings(): void {
    const update = Reflect.get(this, "update");
    if (typeof update === "function") {
      update.call(this);
    } else {
      this.renderLegacySettings();
    }
  }

  display(): void {
    this.renderLegacySettings();
  }

  private renderLegacySettings(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("项目标签")
      .setDesc("除项目区的进行中/已完成目录外，带有该标签或 type: project 的笔记也会被识别")
      .addText((text) => text
        .setValue(this.plugin.settings.projectTag)
        .onChange(async (value) => {
          this.plugin.settings.projectTag = value.replace(/^#/, "").trim() || "project";
          await this.plugin.saveSettings();
          this.plugin.refreshOpenViews();
        }));

    new Setting(containerEl)
      .setName("显示已完成任务")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showCompleted)
        .onChange(async (value) => {
          this.plugin.settings.showCompleted = value;
          await this.plugin.saveSettings();
          this.plugin.refreshOpenViews();
        }));

    new Setting(containerEl)
      .setName("AI 与右侧栏")
      .setHeading();
    containerEl.createEl("p", {
      text: "密钥保存在 Obsidian SecretStorage，不写入笔记或普通插件设置文件。"
    });

    new Setting(containerEl)
      .setName("启用 AI 侧栏")
      .setDesc("启用后可在工作区右上角显示或隐藏 AI 助手")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.ai.enabled)
        .onChange(async (value) => {
          this.plugin.settings.ai.enabled = value;
          if (!value) this.plugin.settings.ai.sidebarOpen = false;
          await this.plugin.saveSettings();
          this.plugin.refreshOpenViews();
        }));

    new Setting(containerEl)
      .setName("AI 提供商")
      .setDesc("本机 Codex 仅供 Windows 仓库开发环境使用；官方安装和 Mac 请使用 API 或安全网关")
      .addDropdown((dropdown) => dropdown
        .addOption("openai", "OpenAI API")
        .addOption("anthropic", "Claude API")
        .addOption("codex-local", "本机 Codex（Windows 开发）")
        .addOption("gateway", "自定义安全网关")
        .setValue(this.plugin.settings.ai.provider)
        .onChange(async (value) => {
          this.plugin.settings.ai.provider = value as typeof this.plugin.settings.ai.provider;
          if (value === "openai") this.plugin.settings.ai.model = "gpt-5.6-terra";
          if (value === "anthropic") {
            this.plugin.settings.ai.model = "claude-sonnet-4-20250514";
          }
          if (value === "codex-local") this.plugin.settings.ai.model = "default";
          await this.plugin.saveSettings();
          this.refreshSettings();
          this.plugin.refreshOpenViews();
        }));

    new Setting(containerEl)
      .setName("模型")
      .setDesc("可填写提供商支持的模型 ID；OpenAI 默认使用兼顾能力与成本的模型")
      .addText((text) => text
        .setValue(this.plugin.settings.ai.model)
        .onChange(async (value) => {
          this.plugin.settings.ai.model = value.trim();
          await this.plugin.saveSettings();
        }));

    const endpointKey = this.plugin.settings.ai.provider === "openai"
      ? "openaiBaseUrl"
      : this.plugin.settings.ai.provider === "anthropic"
        ? "anthropicBaseUrl"
        : this.plugin.settings.ai.provider === "codex-local"
          ? "bridgeUrl"
          : "gatewayUrl";
    new Setting(containerEl)
      .setName("接口地址")
      .setDesc("通常保留默认值；网关和本机桥接需填写自己的 HTTPS/本机地址")
      .addText((text) => text
        .setValue(this.plugin.settings.ai[endpointKey])
        .onChange(async (value) => {
          this.plugin.settings.ai[endpointKey] = value.trim();
          await this.plugin.saveSettings();
        }));

    if (this.plugin.settings.ai.provider === "codex-local") {
      new Setting(containerEl)
        .setName("Codex 会话")
        .setDesc(this.plugin.settings.ai.codexThreadId
          ? `已保存并续接：${this.plugin.settings.ai.codexThreadId.slice(0, 18)}…`
          : "尚未开始；第一次发送消息后会自动保存 thread ID")
        .addButton((button) => button
          .setButtonText("新建会话")
          .setDisabled(!this.plugin.settings.ai.codexThreadId)
          .onClick(async () => {
            this.plugin.settings.ai.codexThreadId = "";
            await this.plugin.saveSettings();
            this.refreshSettings();
            this.plugin.refreshOpenViews();
          }));
    }

    const secretId = getAISecretId(this.plugin.settings.ai.provider);
    const hasSecret = Boolean(this.app.secretStorage.getSecret(secretId));
    new Setting(containerEl)
      .setName(this.plugin.settings.ai.provider === "codex-local" ? "桥接令牌" : "API 密钥")
      .setDesc(hasSecret ? "已安全保存；留空不会覆盖现有密钥" : "尚未配置")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder(hasSecret ? "••••••••（已配置）" : "粘贴密钥");
        text.onChange((value) => {
          const secret = value.trim();
          if (secret) this.app.secretStorage.setSecret(secretId, secret);
        });
      })
      .addButton((button) => button
        .setButtonText("清除")
        .onClick(() => {
          this.app.secretStorage.setSecret(secretId, "");
          this.refreshSettings();
        }))
      .addButton((button) => button
        .setButtonText("测试连接")
        .onClick(async () => {
          button.setDisabled(true);
          button.setButtonText("测试中…");
          try {
            await new AIService(this.app, () => this.plugin.settings.ai)
              .testConnection();
            button.setButtonText("连接成功");
          } catch (error) {
            button.setButtonText("连接失败");
            new Notice(`AI 连接失败：${error instanceof Error ? error.message : String(error)}`);
          } finally {
            window.setTimeout(() => {
              button.setDisabled(false);
              button.setButtonText("测试连接");
            }, 1500);
          }
        }));

    new Setting(containerEl)
      .setName("发送当前笔记")
      .setDesc("关闭后，侧栏只发送你输入的问题")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.ai.includeCurrentNote)
        .onChange(async (value) => {
          this.plugin.settings.ai.includeCurrentNote = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("上下文长度上限")
      .setDesc("限制单次发送的当前笔记字符数，避免意外发送过多内容")
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(this.plugin.settings.ai.maxContextChars));
        text.onChange(async (value) => {
          const next = Math.max(1000, Math.min(100000, Number(value) || 24000));
          this.plugin.settings.ai.maxContextChars = next;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("推理强度")
      .setDesc("OpenAI 模型使用；日常笔记建议中等，需要更快响应可选低")
      .addDropdown((dropdown) => dropdown
        .addOption("none", "无")
        .addOption("low", "低")
        .addOption("medium", "中等")
        .addOption("high", "高")
        .setValue(this.plugin.settings.ai.reasoningEffort)
        .onChange(async (value) => {
          this.plugin.settings.ai.reasoningEffort = value as typeof this.plugin.settings.ai.reasoningEffort;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("AI 排除目录")
      .setDesc("这些目录中的笔记永远不会作为当前笔记上下文发送，用逗号分隔")
      .addText((text) => text
        .setPlaceholder("例如：Private, 财务/原始凭证")
        .setValue(this.plugin.settings.ai.excludedFolders.join(", "))
        .onChange(async (value) => {
          this.plugin.settings.ai.excludedFolders = value
            .split(/[,，]/)
            .map((folder) => folder.trim().replace(/^\/+|\/+$/g, ""))
            .filter(Boolean);
          await this.plugin.saveSettings();
        }));

    this.folderSetting(
      containerEl,
      "每日笔记目录",
      "每日笔记会按 YYYY-MM-DD.md 保存到这里",
      "dailyFolder"
    );
    this.folderSetting(
      containerEl,
      "项目档案目录",
      "在项目档案中新建的项目会保存到这里",
      "projectFolder"
    );
    this.folderSetting(
      containerEl,
      "多维表新笔记目录",
      "从多维表新增的笔记会保存到这里",
      "databaseNewNoteFolder"
    );
    this.folderSetting(
      containerEl,
      "知识库目录",
      "审阅通过的正式知识条目目录",
      "knowledgeFolder"
    );
    this.folderSetting(
      containerEl,
      "灵感收集目录",
      "灵感卡片读取目录",
      "inspirationFolder"
    );
    this.folderSetting(
      containerEl,
      "榨汁机目录",
      "内部使用 Raw、Review 和 Categories 子目录",
      "juicerFolder"
    );

    new Setting(containerEl)
      .setName("搜索排除目录")
      .setDesc("用英文逗号分隔；Vault 配置目录和回收站始终排除")
      .addText((text) => text
        .setPlaceholder("例如：Private, Attachments/Secret")
        .setValue(this.plugin.settings.searchExcludedFolders.join(", "))
        .onChange(async (value) => {
          this.plugin.settings.searchExcludedFolders = value
            .split(",")
            .map((folder) => folder.trim())
            .filter(Boolean);
          await this.plugin.saveSettings();
          this.plugin.invalidateSearchIndexes();
        }));

    new Setting(containerEl)
      .setName("外观主题")
      .setDesc("主题只改变颜色、字体、边框和装饰，不改变功能与数据")
      .addDropdown((dropdown) => dropdown
        .addOption("obsidian", "跟随 Obsidian")
        .addOption("pixel-sky", "pixel-blue")
        .setValue(this.plugin.settings.theme)
        .onChange(async (value) => {
          this.plugin.settings.theme = value as ThemeId;
          await this.plugin.saveSettings();
          this.plugin.applyThemeToOpenViews();
          this.plugin.applyGlobalTheme();
        }));

    new Setting(containerEl)
      .setName("全局美化模式")
      .setDesc("独立把 pixel-blue 配色、方格纸纹理和像素边框扩展到 Obsidian 侧栏、标签页、编辑区与弹窗；关闭或卸载插件会立即恢复")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.globalThemeEnabled)
        .onChange(async (value) => {
          this.plugin.settings.globalThemeEnabled = value;
          await this.plugin.saveSettings();
          this.plugin.applyGlobalTheme();
        }));

    new Setting(containerEl)
      .setName("插件明暗模式")
      .setDesc("改变 pixel-blue Workspace；开启全局美化模式时也会同步应用到 Obsidian")
      .addDropdown((dropdown) => dropdown
        .addOption("light", "浅色（浅蓝像素纸张）")
        .addOption("dark", "深色（深蓝像素蓝图）")
        .addOption("system", "跟随 Obsidian")
        .setValue(this.plugin.settings.colorScheme)
        .onChange(async (value) => {
          this.plugin.settings.colorScheme = value as ColorSchemeId;
          await this.plugin.saveSettings();
          this.plugin.applyThemeToOpenViews();
          this.plugin.applyGlobalTheme();
        }));

    new Setting(containerEl)
      .setName("自定义界面文字与状态颜色")
      .setDesc("关闭时自动跟随当前明暗主题；开启后可分别调整正文和各状态颜色")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.customColorsEnabled)
        .onChange(async (value) => {
          this.plugin.settings.customColorsEnabled = value;
          await this.plugin.saveSettings();
          this.plugin.applyThemeToOpenViews();
          this.plugin.applyGlobalTheme();
          this.refreshSettings();
        }));

    if (this.plugin.settings.customColorsEnabled) {
      this.colorSetting(containerEl, "主要文字", "标题、表格正文和文件名", "text");
      this.colorSetting(containerEl, "辅助文字", "路径、说明和次级信息", "muted");
      this.colorSetting(containerEl, "待处理状态", "尚未开始或等待处理", "todo");
      this.colorSetting(containerEl, "进行中状态", "正在执行的项目或阶段", "doing");
      this.colorSetting(containerEl, "已完成状态", "完成、通过和已保存", "done");
      this.colorSetting(containerEl, "逾期 / 错误状态", "逾期项目、错误和风险提示", "overdue");
      new Setting(containerEl)
        .setName("恢复推荐配色")
        .setDesc("恢复 pixel-blue 的高辨识度文字和状态色")
        .addButton((button) => button
          .setButtonText("恢复")
          .onClick(async () => {
            this.plugin.settings.uiColors = { ...DEFAULT_SETTINGS.uiColors };
            await this.plugin.saveSettings();
            this.plugin.applyThemeToOpenViews();
            this.plugin.applyGlobalTheme();
            this.refreshSettings();
          }));
    }

    new Setting(containerEl)
      .setName("图标包")
      .setDesc("缺失图标自动回退到 Obsidian 默认图标")
      .addDropdown((dropdown) => dropdown
        .addOption("obsidian", "Obsidian 默认")
        .addOption("pixel-blue", "Pixel Blue")
        .setValue(this.plugin.settings.iconPack)
        .onChange(async (value) => {
          this.plugin.settings.iconPack = value as IconPackId;
          await this.plugin.saveSettings();
          this.plugin.applyThemeToOpenViews();
        }));

    new Setting(containerEl)
      .setName("打开插件时隐藏 Obsidian 左栏")
      .setDesc("只收起原生文件栏，不修改文件、文件夹或原生栏设置；仍可随时手动展开")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.hideObsidianSidebarOnOpen)
        .onChange(async (value) => {
          this.plugin.settings.hideObsidianSidebarOnOpen = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("恢复默认导航")
      .setDesc("仅重置左侧导航结构，不删除任何 Vault 文件")
      .addButton((button) => button
        .setButtonText("恢复")
        .onClick(async () => {
          this.plugin.settings.navigation = createDefaultNavigation();
          await this.plugin.saveSettings();
          this.plugin.refreshOpenViews();
          this.refreshSettings();
        }));
  }

  private folderSetting(
    container: HTMLElement,
    name: string,
    description: string,
    key:
      | "dailyFolder"
      | "projectFolder"
      | "databaseNewNoteFolder"
      | "knowledgeFolder"
      | "inspirationFolder"
      | "juicerFolder"
  ): void {
    new Setting(container)
      .setName(name)
      .setDesc(description)
      .addText((text) => text
        .setValue(this.plugin.settings[key])
        .onChange(async (value) => {
          this.plugin.settings[key] = value.trim().replace(/^\/+|\/+$/g, "");
          await this.plugin.saveSettings();
          this.plugin.refreshOpenViews();
        }));
  }

  private colorSetting(
    container: HTMLElement,
    name: string,
    description: string,
    key: keyof WorkspaceColorPalette
  ): void {
    new Setting(container)
      .setName(name)
      .setDesc(description)
      .addColorPicker((picker) => picker
        .setValue(this.plugin.settings.uiColors[key])
        .onChange(async (value) => {
          this.plugin.settings.uiColors[key] = value;
          await this.plugin.saveSettings();
          this.plugin.applyThemeToOpenViews();
          this.plugin.applyGlobalTheme();
        }));
  }
}
