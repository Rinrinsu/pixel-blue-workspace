import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const bundleFile = join(tmpdir(), `pixel-blue-folder-scope-${process.pid}.mjs`);

await build({
  entryPoints: ["src/folder-scope.ts"],
  outfile: bundleFile,
  bundle: true,
  platform: "node",
  format: "esm"
});

try {
  const { isVaultPathInFolder, normalizeVaultFolderScope } = await import(
    `${pathToFileURL(bundleFile).href}?t=${Date.now()}`
  );

  assert.equal(normalizeVaultFolderScope("/"), "");
  assert.equal(normalizeVaultFolderScope("/Projects/Active/"), "Projects/Active");
  assert.equal(normalizeVaultFolderScope("Projects\\Active"), "Projects/Active");
  assert.equal(isVaultPathInFolder("Projects/A.md", "Projects"), true);
  assert.equal(isVaultPathInFolder("Projects/Active/A.md", "Projects"), true);
  assert.equal(isVaultPathInFolder("Archive/A.md", "Projects"), false);
  assert.equal(isVaultPathInFolder("Anywhere/A.md", "/"), true);

  console.log("Folder scope smoke test passed: normalize, nested folders, root scope.");
} finally {
  await unlink(bundleFile).catch(() => undefined);
}
