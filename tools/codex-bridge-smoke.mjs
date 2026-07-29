import assert from "node:assert/strict";
import { once } from "node:events";
import {
  buildCodexEnvironment,
  buildCodexPrompt,
  createCodexBridge
} from "../bridge/codex-bridge.mjs";

const token = "test-token-1234567890";
const calls = [];
const server = createCodexBridge({
  token,
  runCodex: async (input) => {
    calls.push(input);
    return {
      text: "Codex OK",
      threadId: input.threadId ?? "thread-test-1234"
    };
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const unauthorized = await fetch(`${baseUrl}/health`);
  assert.equal(unauthorized.status, 401);

  const health = await fetch(`${baseUrl}/health`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).sandbox, "read-only");

  const payload = {
    provider: "codex-local",
    model: "default",
    reasoningEffort: "medium",
    messages: [{ role: "user", content: "总结当前笔记" }],
    context: {
      currentFile: "Notes/Test.md",
      currentContent: "# Test\n正文"
    },
    system: "只根据明确提供的内容回答。"
  };
  const response = await fetch(`${baseUrl}/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    text: "Codex OK",
    threadId: "thread-test-1234"
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /Notes\/Test\.md/);
  assert.match(calls[0].prompt, /总结当前笔记/);

  const resumed = buildCodexPrompt({
    ...payload,
    threadId: "thread-test-1234",
    messages: [
      { role: "user", content: "第一问" },
      { role: "assistant", content: "第一答" },
      { role: "user", content: "继续" }
    ]
  });
  assert.doesNotMatch(resumed, /第一问/);
  assert.match(resumed, /继续/);
  const childEnvironment = buildCodexEnvironment({
    PATH: "safe-path",
    USERPROFILE: "safe-home",
    VW_CODEX_BRIDGE_TOKEN: "must-not-leak",
    OPENAI_API_KEY: "must-not-leak"
  });
  assert.deepEqual(childEnvironment, {
    PATH: "safe-path",
    USERPROFILE: "safe-home"
  });

  console.log("Codex bridge smoke test passed: auth, health, environment isolation, thread resume.");
} finally {
  server.close();
  await once(server, "close");
}
