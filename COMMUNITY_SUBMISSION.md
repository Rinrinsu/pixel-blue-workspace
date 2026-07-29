# pixel-blue Workspace 社区目录提交清单

## 提交前检查

- `manifest.json` 与 `package.json` 使用公开开发者署名 `Rin`。
- 仓库根目录包含 MIT `LICENSE`。
- 确认 GitHub 仓库为公开仓库，并把默认分支上的源码、`README.md`、`manifest.json` 和 `versions.json` 更新到最终版本。
- 确认插件 ID `pixel-blue-workspace` 和显示名称 `pixel-blue Workspace` 在提交时仍未被占用。

## 创建首个 GitHub Release

1. `manifest.json`、`package.json` 与 `versions.json` 使用同一个版本号。
2. Git tag 必须与版本号完全一致，例如 `0.1.0`，不要添加 `v` 前缀。
3. 推送同名 tag 后，由仓库的 GitHub Actions 自动创建 Release；也可从 `release-public/github-release/` 手动上传以下附件：
   - `main.js`
   - `manifest.json`
   - `styles.css`
4. 发布 Release，确认三个附件可以公开下载。

## 提交到 Obsidian 社区目录

1. 登录 `https://community.obsidian.md`。
2. 在个人资料中关联拥有该仓库的 GitHub 账号。
3. 进入 **Plugins → New plugin**。
4. 填写公开 GitHub 仓库地址。
5. 阅读并同意开发者政策，确认愿意持续维护。
6. 提交后按自动检查与人工审核意见修正；每次修正都发布递增版本的新 Release。

## 当前公开边界

- AI 功能默认关闭，网络用途已在 README 中披露。
- API 密钥和桥接令牌使用 Obsidian SecretStorage。
- 公开包不包含 `data.json`、`.env`、`.codex-bridge-token`、Vault 内容或私人绝对路径。
- 视觉资源已无损转换为 WebP 并嵌入 `main.js`；官方安装器只下载三个标准文件时仍可完整显示，同时保持 `main.js` 小于 5 MiB。
