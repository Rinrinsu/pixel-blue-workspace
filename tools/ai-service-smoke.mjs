import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const bundleFile = join(
  tmpdir(),
  `visual-workspace-ai-service-smoke-${process.pid}.mjs`
);

await build({
  entryPoints: ["src/ai-service.ts"],
  outfile: bundleFile,
  bundle: true,
  platform: "node",
  format: "esm",
  plugins: [{
    name: "obsidian-stub",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^obsidian$/ }, () => ({
        path: "obsidian",
        namespace: "obsidian-stub"
      }));
      buildApi.onLoad({ filter: /.*/, namespace: "obsidian-stub" }, () => ({
        contents: "export async function requestUrl() { throw new Error('network disabled in smoke test'); }",
        loader: "js"
      }));
    }
  }]
});

try {
  const {
    buildAnthropicRequest,
    buildOpenAIRequest,
    getAISecretId,
    parseBridgeResponse,
    parseJuicerDraft,
    parseProviderResponse
  } = await import(`${pathToFileURL(bundleFile).href}?t=${Date.now()}`);
  const settings = {
    enabled: true,
    sidebarOpen: true,
    provider: "openai",
    model: "gpt-5.6-terra",
    openaiBaseUrl: "https://api.openai.com/v1",
    anthropicBaseUrl: "https://api.anthropic.com/v1",
    bridgeUrl: "http://127.0.0.1:7777",
    gatewayUrl: "",
    codexThreadId: "",
    includeCurrentNote: true,
    maxContextChars: 24000,
    reasoningEffort: "medium",
    excludedFolders: []
  };
  const messages = [{ role: "user", content: "总结它" }];
  const context = {
    currentFile: "Notes/Test.md",
    currentContent: "# Test\n正文"
  };

  const openai = buildOpenAIRequest(settings, messages, context);
  assert.equal(openai.model, "gpt-5.6-terra");
  assert.equal(openai.reasoning.effort, "medium");
  assert.match(openai.input.at(-1).content, /<current_note>/);

  const anthropic = buildAnthropicRequest(
    { ...settings, provider: "anthropic", model: "claude-test" },
    messages,
    context
  );
  assert.equal(anthropic.model, "claude-test");
  assert.equal(anthropic.max_tokens, 2048);

  assert.equal(
    parseProviderResponse(200, {
      output: [{ content: [{ type: "output_text", text: "OpenAI OK" }] }]
    }),
    "OpenAI OK"
  );
  assert.equal(
    parseProviderResponse(200, {
      content: [{ type: "text", text: "Claude OK" }]
    }),
    "Claude OK"
  );
  assert.throws(
    () => parseProviderResponse(401, { error: { message: "invalid key" } }),
    /invalid key/
  );
  assert.equal(getAISecretId("openai"), "visual-workspace-openai");
  assert.deepEqual(
    parseBridgeResponse(200, {
      text: "Codex OK",
      threadId: "0199a213-81c0-7800-8aa1-bbab2a035a53"
    }),
    {
      text: "Codex OK",
      threadId: "0199a213-81c0-7800-8aa1-bbab2a035a53"
    }
  );

  const draft = parseJuicerDraft(`\`\`\`json
  {
    "title": "AI 工作流",
    "core": "先定义任务，再选择模型。",
    "summary": "把目标、输入和验收标准写清楚。",
    "keyPoints": ["明确目标", "保留验收"],
    "steps": ["收集原料", "人工审阅"],
    "commentInsights": [],
    "platformSuggestions": ["小红书"],
    "categorySuggestions": ["AI"],
    "tags": ["效率", "AI", "AI"],
    "confidence": 1.4,
    "warnings": ["需核对来源"]
  }
  \`\`\``);
  assert.equal(draft.title, "AI 工作流");
  assert.deepEqual(draft.tags, ["效率", "AI"]);
  assert.equal(draft.confidence, 1);
  assert.throws(
    () => parseJuicerDraft('{"title":"缺字段"}'),
    /缺少/
  );

  console.log("AI service smoke test passed: payloads, responses, juicer JSON, secret IDs.");
} finally {
  await unlink(bundleFile).catch(() => undefined);
}
