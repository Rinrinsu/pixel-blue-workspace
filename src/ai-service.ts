import { App, requestUrl } from "obsidian";
import {
  AIChatResult,
  AIChatMessage,
  AIProviderId,
  AIRequestContext,
  AISettings,
  JuicerDraft
} from "./types";
import { isUnknownRecord, toUnknownArray } from "./type-guards";

const SYSTEM_PROMPT = [
  "你是 pixel-blue Workspace 中的笔记助手。",
  "请优先根据用户明确提供的当前笔记上下文回答。",
  "不要声称读取了未提供的文件，也不要直接修改或删除任何 Vault 内容。",
  "需要改写笔记时，请先给出建议文本并说明修改位置。"
].join("\n");

export class AIService {
  constructor(
    private app: App,
    private settings: () => AISettings
  ) {}

  async testConnection(): Promise<void> {
    const settings = this.settings();
    if (settings.provider === "codex-local") {
      await this.checkCodexBridge(settings);
      return;
    }
    const response = await this.chat(
      [{ role: "user", content: "连接测试：只回复 OK。" }],
      {}
    );
    if (!response.trim()) throw new Error("提供商返回了空内容");
  }

  async chat(
    messages: AIChatMessage[],
    context: AIRequestContext
  ): Promise<string> {
    return (await this.chatDetailed(messages, context)).text;
  }

  async chatDetailed(
    messages: AIChatMessage[],
    context: AIRequestContext,
    threadId?: string
  ): Promise<AIChatResult> {
    const settings = this.settings();
    if (!settings.enabled) throw new Error("请先在设置中启用 AI 侧栏");
    if (!settings.model.trim()) throw new Error("请在设置中填写模型 ID");
    const secret = this.app.secretStorage.getSecret(
      getAISecretId(settings.provider)
    ) ?? "";
    if (!secret) {
      throw new Error(settings.provider === "codex-local"
        ? "尚未配置桥接令牌"
        : "尚未配置 API 密钥或网关令牌");
    }

    if (settings.provider === "openai") {
      return {
        text: await this.callOpenAI(settings, secret, messages, context)
      };
    }
    if (settings.provider === "anthropic") {
      return {
        text: await this.callAnthropic(settings, secret, messages, context)
      };
    }
    return this.callBridge(settings, secret, messages, context, threadId);
  }

  async runJuicer(
    filePath: string,
    content: string
  ): Promise<JuicerDraft> {
    const prompt = [
      "请把当前原料整理为一份可人工审阅的知识草稿。",
      "只返回 JSON，不要 Markdown 代码围栏，不要添加额外说明。",
      "必须严格使用以下字段：",
      "{",
      '  "title": "简洁标题",',
      '  "core": "一句话核心结论",',
      '  "summary": "完整摘要",',
      '  "keyPoints": ["关键点"],',
      '  "steps": ["可执行步骤"],',
      '  "commentInsights": ["评论区或补充洞察，没有则为空数组"],',
      '  "platformSuggestions": ["来源或适用平台，例如小红书、公众号、视频"],',
      '  "categorySuggestions": ["内容分类，例如学习、工作、生活"],',
      '  "tags": ["标签"],',
      '  "confidence": 0.0,',
      '  "warnings": ["不确定、缺少来源或可能过时的内容"]',
      "}",
      "平台分类与内容分类只是建议，不要擅自限制为示例中的类别。"
    ].join("\n");
    const response = await this.chat(
      [{ role: "user", content: prompt }],
      { currentFile: filePath, currentContent: content }
    );
    return parseJuicerDraft(response);
  }

  private async callOpenAI(
    settings: AISettings,
    secret: string,
    messages: AIChatMessage[],
    context: AIRequestContext
  ): Promise<string> {
    const url = apiEndpoint(settings.openaiBaseUrl, "responses");
    const response = await requestUrl({
      url,
      method: "POST",
      contentType: "application/json",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildOpenAIRequest(settings, messages, context)),
      throw: false
    });
    return parseProviderResponse(response.status, response.json, response.text);
  }

  private async callAnthropic(
    settings: AISettings,
    secret: string,
    messages: AIChatMessage[],
    context: AIRequestContext
  ): Promise<string> {
    const url = apiEndpoint(settings.anthropicBaseUrl, "messages");
    const response = await requestUrl({
      url,
      method: "POST",
      contentType: "application/json",
      headers: {
        "x-api-key": secret,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildAnthropicRequest(settings, messages, context)),
      throw: false
    });
    return parseProviderResponse(response.status, response.json, response.text);
  }

  private async callBridge(
    settings: AISettings,
    secret: string,
    messages: AIChatMessage[],
    context: AIRequestContext,
    threadId?: string
  ): Promise<AIChatResult> {
    const baseUrl = settings.provider === "codex-local"
      ? settings.bridgeUrl
      : settings.gatewayUrl;
    const url = apiEndpoint(baseUrl, "chat");
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (secret) headers.Authorization = `Bearer ${secret}`;
    const response = await requestUrl({
      url,
      method: "POST",
      contentType: "application/json",
      headers,
      body: JSON.stringify({
        provider: settings.provider,
        model: settings.model,
        messages,
        context,
        system: SYSTEM_PROMPT,
        reasoningEffort: settings.reasoningEffort,
        ...(threadId ? { threadId } : {})
      }),
      throw: false
    });
    return parseBridgeResponse(response.status, response.json, response.text);
  }

  private async checkCodexBridge(settings: AISettings): Promise<void> {
    const secret = this.app.secretStorage.getSecret(
      getAISecretId("codex-local")
    ) ?? "";
    if (!secret) throw new Error("尚未配置桥接令牌");
    const response = await requestUrl({
      url: apiEndpoint(settings.bridgeUrl, "health"),
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
      throw: false
    });
    const body = isUnknownRecord(response.json) ? response.json : {};
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        extractErrorMessage(body) || response.text || `HTTP ${response.status}`
      );
    }
    if (body.status !== "ok" || body.codexReady !== true) {
      throw new Error("桥接已响应，但 Codex 运行时尚未就绪");
    }
  }
}

export function getAISecretId(provider: AIProviderId): string {
  return `visual-workspace-${provider.replace(/[^a-z0-9-]/g, "-")}`;
}

export function buildOpenAIRequest(
  settings: AISettings,
  messages: AIChatMessage[],
  context: AIRequestContext
): Record<string, unknown> {
  return {
    model: settings.model,
    reasoning: { effort: settings.reasoningEffort },
    text: { verbosity: "medium" },
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      ...withContext(messages, context)
    ]
  };
}

export function buildAnthropicRequest(
  settings: AISettings,
  messages: AIChatMessage[],
  context: AIRequestContext
): Record<string, unknown> {
  return {
    model: settings.model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: withContext(messages, context)
  };
}

export function parseProviderResponse(
  status: number,
  json: unknown,
  fallbackText = ""
): string {
  const body = isUnknownRecord(json) ? json : {};
  if (status < 200 || status >= 300) {
    const message = extractErrorMessage(body) || fallbackText || `HTTP ${status}`;
    throw new Error(message.slice(0, 500));
  }
  if (typeof body.text === "string") return body.text;
  if (typeof body.output_text === "string") return body.output_text;
  const output = toUnknownArray(body.output);
  if (output.length) {
    const text = output
      .flatMap((item) => isUnknownRecord(item) ? toUnknownArray(item.content) : [])
      .map((part) => isUnknownRecord(part) && typeof part.text === "string" ? part.text : "")
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }
  const content = toUnknownArray(body.content);
  if (content.length) {
    const text = content
      .map((part) => isUnknownRecord(part) && typeof part.text === "string" ? part.text : "")
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }
  const choices = toUnknownArray(body.choices);
  const first = isUnknownRecord(choices[0]) ? choices[0] : {};
  const message = isUnknownRecord(first.message) ? first.message : {};
  if (typeof message.content === "string") return message.content;
  throw new Error("无法识别提供商返回的文本格式");
}

export function parseBridgeResponse(
  status: number,
  json: unknown,
  fallbackText = ""
): AIChatResult {
  const text = parseProviderResponse(status, json, fallbackText);
  const body = isUnknownRecord(json) ? json : {};
  const threadId = typeof body.threadId === "string"
    && /^[a-zA-Z0-9-]{8,128}$/.test(body.threadId)
    ? body.threadId
    : undefined;
  return { text, threadId };
}

export function parseJuicerDraft(value: string): JuicerDraft {
  const candidate = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI 没有返回可识别的 JSON 草稿");
    try {
      parsed = JSON.parse(candidate.slice(start, end + 1));
    } catch {
      throw new Error("AI 返回的 JSON 草稿格式不正确");
    }
  }
  if (!isUnknownRecord(parsed)) throw new Error("AI 草稿不是对象");
  const title = cleanText(parsed.title);
  const core = cleanText(parsed.core);
  const summary = cleanText(parsed.summary);
  if (!title || !core || !summary) {
    throw new Error("AI 草稿缺少 title、core 或 summary");
  }
  return {
    title,
    core,
    summary,
    keyPoints: cleanStringArray(parsed.keyPoints),
    steps: cleanStringArray(parsed.steps),
    commentInsights: cleanStringArray(parsed.commentInsights),
    platformSuggestions: cleanStringArray(parsed.platformSuggestions),
    categorySuggestions: cleanStringArray(parsed.categorySuggestions),
    tags: cleanStringArray(parsed.tags),
    confidence: clampConfidence(Number(parsed.confidence ?? 0)),
    warnings: cleanStringArray(parsed.warnings)
  };
}

function withContext(
  messages: AIChatMessage[],
  context: AIRequestContext
): AIChatMessage[] {
  if (!context.currentContent) return messages;
  const contextText = [
    "<current_note>",
    context.currentFile ? `路径：${context.currentFile}` : "",
    context.currentContent,
    "</current_note>"
  ].filter(Boolean).join("\n");
  const copy = messages.map((message) => ({ ...message }));
  const lastUser = [...copy].reverse().find((message) => message.role === "user");
  if (lastUser) lastUser.content = `${contextText}\n\n${lastUser.content}`;
  else copy.push({ role: "user", content: contextText });
  return copy;
}

function apiEndpoint(baseUrl: string, resource: string): string {
  const raw = baseUrl.trim().replace(/\/+$/, "");
  if (!raw) throw new Error("接口地址为空");
  const parsed = new URL(raw);
  const isLocal = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !(isLocal && parsed.protocol === "http:")) {
    throw new Error("接口必须使用 HTTPS；只有 localhost 可使用 HTTP");
  }
  if (parsed.pathname.endsWith(`/${resource}`)) return parsed.toString().replace(/\/$/, "");
  return `${raw}/${resource}`;
}

function extractErrorMessage(body: Record<string, unknown>): string {
  if (typeof body.message === "string") return body.message;
  const error = isUnknownRecord(body.error) ? body.error : {};
  return typeof error.message === "string" ? error.message : "";
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value.map(cleanText).filter(Boolean)
  )].slice(0, 24);
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
