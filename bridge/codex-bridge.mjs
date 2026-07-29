import { timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Codex } from "@openai/codex-sdk";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7777;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BODY_BYTES = 1_000_000;

export function createCodexBridge(options = {}) {
  const token = String(options.token ?? process.env.VW_CODEX_BRIDGE_TOKEN ?? "").trim();
  if (token.length < 16) {
    throw new Error("VW_CODEX_BRIDGE_TOKEN 至少需要 16 个字符");
  }
  const runCodex = options.runCodex ?? runCodexTurn;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  let activeRequests = 0;

  return createServer(async (request, response) => {
    setSecurityHeaders(response);
    if (request.method === "GET" && request.url === "/health") {
      if (!isAuthorized(request.headers.authorization, token)) {
        return sendJson(response, 401, { error: { message: "桥接令牌无效" } });
      }
      return sendJson(response, 200, {
        status: "ok",
        provider: "codex-local",
        codexReady: true,
        activeRequests,
        sandbox: "read-only"
      });
    }

    if (request.method !== "POST" || request.url !== "/chat") {
      return sendJson(response, 404, { error: { message: "接口不存在" } });
    }
    if (!isAuthorized(request.headers.authorization, token)) {
      return sendJson(response, 401, { error: { message: "桥接令牌无效" } });
    }
    if (activeRequests >= 2) {
      return sendJson(response, 429, { error: { message: "桥接正忙，请稍后重试" } });
    }

    let countedAsActive = false;
    try {
      const payload = await readJsonBody(request, maxBodyBytes);
      validateChatPayload(payload);
      activeRequests += 1;
      countedAsActive = true;
      const result = await runCodex({
        prompt: buildCodexPrompt(payload),
        threadId: cleanThreadId(payload.threadId),
        model: cleanModel(payload.model),
        reasoningEffort: normalizeReasoning(payload.reasoningEffort),
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        runtimeDirectory: options.runtimeDirectory
      });
      sendJson(response, 200, result);
    } catch (error) {
      const status = error?.code === "BODY_TOO_LARGE" ? 413
        : error?.code === "INVALID_REQUEST" ? 400
          : error?.name === "AbortError" ? 504
            : 502;
      sendJson(response, status, {
        error: { message: safeErrorMessage(error) }
      });
    } finally {
      if (countedAsActive) activeRequests -= 1;
    }
  });
}

export async function runCodexTurn({
  prompt,
  threadId,
  model,
  reasoningEffort,
  timeoutMs,
  runtimeDirectory
}) {
  const workdir = runtimeDirectory
    ? String(runtimeDirectory)
    : join(tmpdir(), "pixel-blue-workspace-codex");
  await mkdir(workdir, { recursive: true });

  const codex = new Codex({
    env: buildCodexEnvironment(process.env)
  });
  const threadOptions = {
    sandboxMode: "read-only",
    workingDirectory: workdir,
    skipGitRepoCheck: true,
    approvalPolicy: "never",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { modelReasoningEffort: reasoningEffort } : {})
  };
  const thread = threadId
    ? codex.resumeThread(threadId, threadOptions)
    : codex.startThread(threadOptions);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const result = await thread.run(prompt, { signal: controller.signal });
    if (!result.finalResponse?.trim()) throw new Error("Codex 返回了空内容");
    return {
      text: result.finalResponse,
      threadId: thread.id ?? threadId,
      usage: result.usage ?? undefined
    };
  } finally {
    clearTimeout(timer);
  }
}

export function buildCodexPrompt(payload) {
  const system = cleanText(payload.system, 8_000);
  const context = isRecord(payload.context) ? payload.context : {};
  const messages = Array.isArray(payload.messages)
    ? payload.messages
      .filter((message) => isRecord(message))
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: cleanText(message.content, 120_000)
      }))
      .filter((message) => message.content)
      .slice(-60)
    : [];
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const selectedMessages = cleanThreadId(payload.threadId)
    ? latestUserMessage ? [latestUserMessage] : []
    : messages;
  const currentFile = cleanText(context.currentFile, 1_000);
  const currentContent = cleanText(context.currentContent, 160_000);
  const parts = [
    "<visual_workspace_rules>",
    system || "只根据用户明确提供的内容回答，不修改任何文件。",
    "此连接处于只读隔离环境。不要声称已经修改、移动或删除了 Obsidian 文件。",
    "</visual_workspace_rules>"
  ];
  if (currentContent) {
    parts.push(
      "<current_note>",
      currentFile ? `路径：${currentFile}` : "",
      currentContent,
      "</current_note>"
    );
  }
  parts.push(
    "<conversation>",
    ...selectedMessages.map((message) => (
      `${message.role === "assistant" ? "助手" : "用户"}：${message.content}`
    )),
    "</conversation>",
    "请直接回答最后一条用户消息。"
  );
  return parts.filter(Boolean).join("\n");
}

export function buildCodexEnvironment(source) {
  const allowed = new Set([
    "PATH",
    "Path",
    "PATHEXT",
    "SYSTEMROOT",
    "SystemRoot",
    "COMSPEC",
    "ComSpec",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "HOME",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "CODEX_HOME",
    "LANG",
    "LC_ALL",
    "SSL_CERT_FILE"
  ]);
  return Object.fromEntries(
    Object.entries(source)
      .filter(([key, value]) => allowed.has(key) && typeof value === "string")
  );
}

export function startCodexBridge() {
  const host = DEFAULT_HOST;
  const port = normalizePort(process.env.VW_CODEX_BRIDGE_PORT);
  const server = createCodexBridge();
  server.listen(port, host, () => {
    console.log(`pixel-blue Workspace Codex bridge: http://${host}:${port}`);
    console.log("安全模式：仅本机、令牌验证、只读沙盒、无网络工具");
  });
  return server;
}

function validateChatPayload(payload) {
  if (!isRecord(payload)) throw invalidRequest("请求体必须是 JSON 对象");
  if (payload.provider !== "codex-local") {
    throw invalidRequest("本机桥接只接受 codex-local 提供商");
  }
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    throw invalidRequest("messages 不能为空");
  }
  if (!payload.messages.some((message) => (
    isRecord(message)
    && message.role === "user"
    && typeof message.content === "string"
    && message.content.trim()
  ))) {
    throw invalidRequest("缺少用户消息");
  }
}

function readJsonBody(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        const error = new Error("请求内容过大");
        error.code = "BODY_TOO_LARGE";
        reject(error);
        request.removeAllListeners("data");
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(invalidRequest("请求体不是有效 JSON"));
      }
    });
    request.on("error", reject);
  });
}

function isAuthorized(value, expected) {
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return false;
  const actual = value.slice(7).trim();
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

function sendJson(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  const data = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data)
  });
  response.end(data);
}

function setSecurityHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
}

function cleanThreadId(value) {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim();
  return /^[a-zA-Z0-9-]{8,128}$/.test(candidate) ? candidate : undefined;
}

function cleanModel(value) {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim();
  if (!candidate || candidate === "default") return undefined;
  return /^[a-zA-Z0-9._:-]{1,128}$/.test(candidate) ? candidate : undefined;
}

function normalizeReasoning(value) {
  if (value === "none") return "minimal";
  return ["low", "medium", "high"].includes(value) ? value : undefined;
}

function normalizePort(value) {
  const port = Number(value ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) return DEFAULT_PORT;
  return port;
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").slice(0, 500);
}

function invalidRequest(message) {
  const error = new Error(message);
  error.code = "INVALID_REQUEST";
  return error;
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const entryPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (entryPath === import.meta.url) startCodexBridge();
