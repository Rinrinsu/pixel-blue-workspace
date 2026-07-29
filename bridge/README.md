# Codex 本机桥接

这个小服务把 pixel-blue Workspace 的右侧栏连接到 OpenAI 官方 Codex SDK。

## 启动

1. 在 Windows 中双击 `start-codex-bridge.cmd`。
2. 第一次启动会生成一个本机桥接令牌，并显示在窗口里。
3. 在 Obsidian → pixel-blue Workspace 设置中：
   - 启用 AI 侧栏
   - 提供商选择“本机 Codex 桥接”
   - 接口地址保留 `http://127.0.0.1:7777`
   - 粘贴窗口中显示的桥接令牌
   - 点击“测试连接”
4. 保持桥接窗口开启。关闭窗口即停止连接。

令牌会保存在 `bridge/.codex-bridge-token`，该文件已被 Git 忽略。后续重启沿用同一令牌，不需要再次修改 Obsidian 设置。

## 安全边界

- 服务固定监听 `127.0.0.1`，局域网和公网设备无法直接访问。
- `/health` 和 `/chat` 都必须提供桥接令牌。
- 请求体限制为 1 MB，同时最多处理两个请求。
- Codex 使用独立临时目录、只读沙盒、禁止审批、关闭网络和 Web 搜索。
- Codex 子进程只继承运行所需的最小环境变量；桥接令牌和其他 API 密钥不会传入。
- 桥接不会把 Vault 路径交给 Codex；只有插件按设置允许的当前笔记内容会进入提示词。
- Codex 的回复只是建议，不会直接写入、移动或删除笔记。

## 会话续接

第一次对话后，插件会保存桥接返回的 Codex thread ID。再次发送时自动续接同一会话。

- 右侧栏“清空本次对话”会同时新建 Codex 会话。
- 设置页“Codex 会话 → 新建会话”也会断开旧 thread。
- thread ID 不是密钥，只用于寻找本机保存的 Codex 会话。

## 运行要求

- Node.js 18 或更高版本。
- 项目根目录已运行依赖安装，包含 `@openai/codex-sdk`。
- Codex SDK 使用本机 Codex 登录状态；如果尚未登录，首次真实对话会返回登录错误。
