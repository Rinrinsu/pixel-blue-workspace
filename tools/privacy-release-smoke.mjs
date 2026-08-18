import { readFile } from "node:fs/promises";

const releaseFiles = ["main.js", "manifest.json", "styles.css"];
const privatePatterns = [
  { label: "Windows absolute path", pattern: /[A-Za-z]:[\\/](?:Users|Documents|Desktop|Downloads|obsidian)[\\/]/i },
  { label: "local Windows user directory", pattern: /Users[\\/](?:Administrator|ADMINI~1)[\\/]/i },
  { label: "Obsidian local data file", pattern: /\.obsidian[\\/](?:plugins|workspace|workspace-mobile|community-plugins\.json)/i },
  { label: "bridge access token", pattern: /codex-bridge-token/i }
];

const errors = [];
for (const file of releaseFiles) {
  const content = await readFile(file, "utf8");
  for (const { label, pattern } of privatePatterns) {
    if (pattern.test(content)) errors.push(`${file}: contains ${label}`);
  }
}

const gitignore = await readFile(".gitignore", "utf8");
for (const required of ["data.json", ".obsidian/", ".env", "bridge/.codex-bridge-token"]) {
  if (!gitignore.split(/\r?\n/).includes(required)) {
    errors.push(`.gitignore: missing ${required}`);
  }
}

if (errors.length > 0) throw new Error(errors.join("\n"));

console.log("Privacy release check passed: release assets contain no local paths or persisted Vault data");
