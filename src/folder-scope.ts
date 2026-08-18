export function normalizeVaultFolderScope(path: string | undefined): string {
  return (path ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

export function isVaultPathInFolder(
  filePath: string,
  folderPath: string | undefined
): boolean {
  const folder = normalizeVaultFolderScope(folderPath);
  if (!folder) return true;
  const file = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return file === folder || file.startsWith(`${folder}/`);
}
