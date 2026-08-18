import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile("src/plan-model.ts", "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
const { formatPlanTaskLine, normalizePlanText } = await import(moduleUrl);

assert.equal(normalizePlanText("  完成  初稿\n并校对  "), "完成 初稿 并校对");
assert.equal(formatPlanTaskLine("完成初稿"), "- [ ] 完成初稿");
assert.equal(
  formatPlanTaskLine("完成初稿", "2026-08-15"),
  "- [ ] 完成初稿 📅 2026-08-15"
);
assert.equal(
  formatPlanTaskLine("完成初稿", "2026-08-15", "官网改版"),
  "- [ ] 完成初稿 📅 2026-08-15 project:: [[官网改版]]"
);
assert.throws(() => formatPlanTaskLine("   "));

console.log("Plan model smoke test passed: normalize, task syntax, optional due date.");
