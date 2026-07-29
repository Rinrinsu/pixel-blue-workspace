import { TFile } from "obsidian";
import {
  ColorSchemeId,
  IconPackId,
  ThemeId,
  WorkspaceColorPalette
} from "./theme-manager";

export type Status = "todo" | "doing" | "done";

export interface TaskItem {
  text: string;
  done: boolean;
  file: TFile;
  line: number;
  due?: string;
}

export interface ProjectItem {
  file: TFile;
  title: string;
  status: Status;
  progress: number;
  stages: ProjectStage[];
  due?: string;
  area?: string;
}

export interface ProjectStage {
  id: string;
  name: string;
  progress: number;
}

export type DatabaseColumnType = "text" | "number" | "date" | "select" | "tags";

export interface DatabaseColumn {
  id: string;
  label: string;
  property: string;
  type: DatabaseColumnType;
  options?: string[];
}

export type EditorSpacing = "compact" | "normal" | "loose";
export type HeadingColorMode = "level" | "accent" | "plain";

export interface NoteAnnotation {
  id: string;
  quote: string;
  prefix: string;
  suffix: string;
  note: string;
  createdAt: string;
  resolved: boolean;
}

export interface EditorDocumentState {
  spacing: EditorSpacing;
  headingColors: HeadingColorMode;
  comments: NoteAnnotation[];
}

export type AIProviderId =
  | "openai"
  | "anthropic"
  | "codex-local"
  | "gateway";

export type AIReasoningEffort = "none" | "low" | "medium" | "high";

export interface AISettings {
  enabled: boolean;
  sidebarOpen: boolean;
  provider: AIProviderId;
  model: string;
  openaiBaseUrl: string;
  anthropicBaseUrl: string;
  bridgeUrl: string;
  gatewayUrl: string;
  codexThreadId: string;
  includeCurrentNote: boolean;
  maxContextChars: number;
  reasoningEffort: AIReasoningEffort;
  excludedFolders: string[];
}

export interface AIChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AIChatResult {
  text: string;
  threadId?: string;
}

export interface AIRequestContext {
  currentFile?: string;
  currentContent?: string;
}

export interface JuicerDraft {
  title: string;
  core: string;
  summary: string;
  keyPoints: string[];
  steps: string[];
  commentInsights: string[];
  platformSuggestions: string[];
  categorySuggestions: string[];
  tags: string[];
  confidence: number;
  warnings: string[];
}

export interface DashboardData {
  notes: number;
  tasks: TaskItem[];
  projects: ProjectItem[];
}

export type WorkspacePageId =
  | "dashboard"
  | "projects"
  | "database"
  | "daily"
  | "daily-all"
  | "brain"
  | "knowledge"
  | "inspiration"
  | "juicer"
  | "search"
  | "document"
  | "collection";

export interface NavNode {
  id: string;
  label: string;
  icon?: string;
  page?: WorkspacePageId;
  path?: string;
  expanded?: boolean;
  children?: NavNode[];
}

export interface VisualWorkspaceSettings {
  projectTag: string;
  horizonDays: number;
  showCompleted: boolean;
  theme: ThemeId;
  iconPack: IconPackId;
  colorScheme: ColorSchemeId;
  globalThemeEnabled: boolean;
  customColorsEnabled: boolean;
  uiColors: WorkspaceColorPalette;
  hideObsidianSidebarOnOpen: boolean;
  dailyFolder: string;
  projectFolder: string;
  databaseNewNoteFolder: string;
  databaseColumns: DatabaseColumn[];
  editorDocuments: Record<string, EditorDocumentState>;
  ai: AISettings;
  knowledgeFolder: string;
  inspirationFolder: string;
  juicerFolder: string;
  searchExcludedFolders: string[];
  navigation: NavNode[];
}
