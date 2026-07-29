import { readFile, stat } from "node:fs/promises";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const [manifest, packageJson, versions] = await Promise.all([
  readJson("manifest.json"),
  readJson("package.json"),
  readJson("versions.json")
]);

const errors = [];
const maxSyncableMainSize = 5 * 1024 * 1024;
const versionPattern = /^\d+\.\d+\.\d+$/;
const pluginIdPattern = /^[a-z]+(?:-[a-z]+)*$/;

if (!versionPattern.test(manifest.version)) {
  errors.push(`manifest.json version must use x.y.z: ${manifest.version}`);
}
if (
  !pluginIdPattern.test(manifest.id) ||
  manifest.id.endsWith("plugin") ||
  manifest.id.includes("obsidian")
) {
  errors.push(
    "manifest.json id must use lowercase letters and hyphens only, must not end with plugin, and must not contain obsidian"
  );
}
if (packageJson.version !== manifest.version) {
  errors.push("package.json and manifest.json versions do not match");
}
if (versions[manifest.version] !== manifest.minAppVersion) {
  errors.push("versions.json does not map the current version to minAppVersion");
}
if (!String(manifest.author ?? "").trim()) {
  errors.push("manifest.json author is required");
}
if (!String(manifest.description ?? "").trim()) {
  errors.push("manifest.json description is required");
}

const mainStats = await stat("main.js");
if (mainStats.size > maxSyncableMainSize) {
  errors.push(
    `main.js must not exceed 5 MiB for Obsidian Sync Standard: ${mainStats.size} bytes`
  );
}

if (errors.length > 0) {
  throw new Error(errors.join("\n"));
}

console.log(
  `Release verified: ${manifest.id} ${manifest.version}, Obsidian ${manifest.minAppVersion}+, main.js ${mainStats.size} bytes`
);
