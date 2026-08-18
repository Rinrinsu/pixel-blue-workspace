# pixel-blue Workspace

A pixel-blue visual workspace for Obsidian that brings notes, projects, tasks,
daily notes, ideas, and knowledge workflows into one dashboard.

## Highlights

- Expandable multi-level navigation with persistent custom items
- Project dashboards with manually maintained progress and recent schedules
- Filterable, sortable note property tables with inline property editing
- Daily-note quick capture, read-only preview, and native Obsidian editing
- Full-vault Boolean search with BM25-style keyword weighting
- Native Obsidian Markdown editing from every file entry
- Optional OpenAI, Claude, and secure gateway integrations
- A pixel-blue light and dark skin that pairs with the official pixel-blue theme
- No telemetry, advertising, or background data collection

## Installation

After the plugin is approved for the Obsidian Community directory:

1. Open **Settings → Community plugins** in Obsidian.
2. Select **Browse** and search for **pixel-blue Workspace**.
3. Select **Install**, then **Enable**.
4. Use the ribbon icon or run **Open Visual Workspace** from the command palette.

Before approval, developers can install the three files from the latest GitHub
Release into `.obsidian/plugins/pixel-blue-workspace/` for testing.

---

## 中文说明

把 Obsidian 中分散的笔记、项目、任务和日期聚合成一个可视化工作台。

## 当前已实现

- 可展开、可右键维护并持久化的多层导航
- 工作台、项目档案、多维表、每日笔记、知识中心、知识库、灵感收集和笔记榨汁机页面
- 笔记数、进行中项目、未完成任务、完成率总览
- 项目进度、Markdown 任务清单和近期排期
- 项目阶段和总进度由用户通过可视化滑块手工维护；关联任务只用于展示，不会擅自修改进度
- 项目档案提供识别预览，可查看自动识别依据并把任意笔记手动指定为项目主页
- 新增计划及现有任务都可以从下拉框选择或更换所属项目
- 可新增笔记、添加字段、筛选、排序并直接编辑属性的笔记属性表
- 基于 `✅ YYYY-MM-DD` 真实完成日期的最近 28 天任务完成记录
- 每日笔记快速记录、只读预览和 Obsidian 原生编辑
- 所有笔记入口统一打开 Obsidian 原生 Markdown 编辑器，不重新序列化正文
- 可隐藏 AI 右侧栏，以及 OpenAI、Claude、安全网关和 Windows 开发用本机 Codex 设置
- API 密钥使用 Obsidian SecretStorage，不写入 Markdown 或普通插件数据
- 笔记榨汁机：Raw 原料生成结构化 Review，人工确认平台/内容分类后进入知识库
- Review 支持正文级差异审阅：对照原料相近片段、标记增删，并逐段采用或暂不采用
- 灵感收集可直接粘贴文字或截图，自动保存附件并生成 pixel-blue 方格纸瀑布流卡片
- 从真实 Vault 目录读取知识、灵感和榨汁队列
- 全库布尔精确查询与 BM25 风格关键词加权搜索
- pixel-blue 浅色/深色外观、方格纸和便利贴纹理
- 可选“全局美化模式”，把 pixel-blue 延伸到 Obsidian 侧栏、标签页、编辑区和弹窗
- 设置中可自定义主要文字、辅助文字以及待处理/进行中/完成/逾期状态色
- 顶部常用操作使用放大像素图标与可见文字标签
- 自动适配 Obsidian 明暗主题与窄屏

## 数据约定

项目笔记使用如下属性：

```yaml
---
type: project
status: doing
progress: 65
due: 2026-08-15
area: 工作
stages:
  - id: research
    name: 调研
    progress: 100
  - id: execution
    name: 执行
    progress: 30
tags: [project]
---
```

插件会从项目区的“进行中 / 已完成”目录自动识别直接项目笔记，也支持 `type: project`、`project: true` 或项目标签。“识别预览”会列出识别依据，未识别笔记可手动设为项目主页。项目进度通过工作台中的滑块或阶段编辑器手工维护；保存时会同步更新 `progress` 与 `status`。

任务支持普通 Markdown 任务；在末尾加入日期即可进入排期：

```markdown
- [ ] 完成首页原型 📅 2026-07-25
- [x] 整理需求 due: 2026-07-20 ✅ 2026-07-22
- [ ] 提交测试版 📅 2026-07-28 project:: [[官网改版]]
```

使用“新增计划”时可以选择所属项目，任务卡片也能随时更换归属；带有 `project:: [[项目名]]` 的计划会关联并显示到对应项目，但不会自动修改手工进度。

## 安装

插件通过 Obsidian 社区审核后，可在任意电脑上直接安装：

1. 打开 Obsidian → **设置** → **社区插件**。
2. 关闭受限模式，选择 **浏览**。
3. 搜索 **pixel-blue Workspace**，选择 **安装**，然后选择 **启用**。
4. 点击左侧工作台图标，或从命令面板运行“打开可视化工作台”。

在社区版本正式发布前，开发者可从 GitHub Release 下载 `main.js`、`manifest.json`
和 `styles.css`，放入 Vault 的 `.obsidian/plugins/pixel-blue-workspace/` 目录进行测试。

## 开发

1. 在本目录运行 `npm install`。
2. 运行 `npm run build`，生成 `main.js`。
3. 把 `manifest.json`、`main.js`、`styles.css` 复制到 Vault 的 `.obsidian/plugins/pixel-blue-workspace/`。
4. 在 Obsidian 的“第三方插件”中启用 **pixel-blue Workspace**。
5. 点击左侧的工作台图标，或从命令面板运行“打开可视化工作台”。

如需美化整个 Obsidian，请进入插件设置，开启“全局美化模式”。该模式默认关闭；
关闭开关或卸载插件后，Obsidian 会立即恢复原有主题。

AI 功能需要 Obsidian 1.11.4 或更高版本。打开插件设置中的“AI 与右侧栏”，选择提供商、模型并安全保存密钥后，可使用“测试连接”验证。

仓库中的本机 Codex 桥接只用于 Windows 开发环境，不包含在社区商店发布包中，也不是 Mac 官方安装版的开箱功能。跨设备使用 AI 时请选择 OpenAI、Claude 或自定义安全网关。

## 网络与隐私披露

- 插件不包含遥测、广告或后台数据收集。
- AI 功能默认关闭；只有用户主动启用并发起请求时才访问网络。
- OpenAI、Anthropic 或自定义网关模式会把聊天输入，以及用户明确允许的当前笔记上下文，发送到设置中的接口地址。
- 笔记榨汁机只在用户点击处理时，把所选 Raw 原料发送到当前 AI 提供商。
- API 密钥和桥接令牌保存在 Obsidian SecretStorage，不写入 Markdown、普通插件 `data.json` 或公开发布包。
- 仓库中的开发用本机桥接默认只监听 `127.0.0.1`，并要求设备本地生成的桥接令牌。

## 主题开发

主题已经与功能样式隔离：

```text
src/styles/base.css        固定字号、间距和安全回退
src/styles/components.css  工作台组件与响应式布局
src/themes/obsidian.css    跟随 Obsidian 的原生主题
src/themes/pixel-sky.css   pixel-blue 视觉主题
src/themes/global-pixel-sky.css  可选的 Obsidian 全局 pixel-blue 外观
src/theme-manager.ts       主题与图标包切换
src/global-theme.ts        全局主题挂载与卸载清理
styles.css                 构建时自动生成，请勿直接编辑
```

- 修改视觉主题时只编辑 `src/themes/`，不会改动数据读取和功能代码。
- 修改组件排版时编辑 `src/styles/components.css`。
- 运行 `npm run build:styles` 可单独重新生成 `styles.css`。
- 工作台主题默认只作用于 `.vw-root`；只有用户主动开启“全局美化模式”时，
  才会通过 `body.vw-global-theme` 扩展到 Obsidian，其关闭与卸载流程会清理全部挂载状态。

## 下一步建议

- 属性表分组、关系字段与保存视图
- AI 语义检索、标签关系与关联图谱
- 关键词索引持久化与单文件增量更新
- 项目阶段模板与日历 / 甘特图视图
