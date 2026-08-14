<p align="center">
  <a href="https://github.com/keerzzz/AigcForge">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Aigcfroge logo">
    </picture>
  </a>
</p>
<p align="center">开源的 AI Coding Agent。</p>
<p align="center">
  <a href="https://github.com/keerzzz/AigcForge/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/keerzzz/AigcForge/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a>
</p>

[![Aigcfroge Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://github.com/keerzzz/AigcForge)

---

## 什么是 AigcForge？

AigcForge 是一个开源 AI Agent，它的能力远不止一个编程终端。它是一个**统一的智能体工作台**：四种产品模式适配不同工作场景、通过对话沉淀可复用资产的资产工作室、原生的任务系统，以及一个事件溯源、跨终端持久可恢复的会话运行时。

## 核心特性

### 四种产品模式

切换模式不会丢失项目进度——会话自动保持同步，每种模式只拿到它该有的工具（也只有这些工具）：

| 模式 | 用途 |
|---|---|
| **Coding**（默认） | 完整开发工作台：编辑代码、运行终端、使用 git worktree、执行测试。 |
| **Chat** | 通过对话构建可复用资产。对代码只读——它*提议*资产，你一键 Apply 即可。 |
| **Work** | 非编程产出。选择预设模板，回答几个澄清问题，预览结果，然后将 Markdown 文档保存到项目目录。 |
| **Assistant**（规划中） | 代你主动行事的个人智能体。 |

### 资产工作室

七类可复用资产——**提示词（prompt）、技能（skill）、MCP 服务、命令（command）、智能体（agent）、工作流（workflow）、插件（plugin）**——每种都支持创建、导入、提议、应用、插入与删除。在 Chat 模式构建一次，即可在所有项目与模式中复用。

### 原生任务系统

一等公民的任务/Todo 模型，支持依赖关系、优先级、定时调度与断点恢复。可将任务委派给子智能体——或委派给 Claude Code、Codex、Gemini、opencode 等外部 CLI——并实时观察进度更新。

### 智能体体系

- **meta** — 默认编排入口：意图分类、路由与委派。
- **build** — 默认执行体，具备完整工具权限。
- **plan** — 只读模式，适合分析与探索。
- **@general / @explore** — 用于研究与快速代码库探索的子智能体。
- 各模式的编排器（`chat-orchestrator`、`work-orchestrator`）严格执行每种模式的能力边界。

### 事件溯源会话

Session V2 运行时持久化记录每一个事件，工作跨重启不丢失，并在 CLI、TUI 与桌面端保持一致。内置**回滚/撤销回滚（revert/unrevert）**、**分享（share）**与**摘要（summary）**。

### MCP 与插件 SDK

连接任意 MCP 服务端——stdio、remote 或 OAuth——并通过插件 SDK 扩展 AigcForge：v1 保证稳定，v2 提供基于 Effect 的现代 API。

### 安全优先

权限确认（询问 / 允许 / 拒绝 / 无人值守自动拒绝）、项目沙箱、不可信导入防护，以及基于模式对 shell 与命令的限制。

### 一套运行时，多种形态

CLI、终端 TUI 与 Electron 桌面应用——另有 web、Slack 与同步服务器等部署单元。

## 安装

```bash
# 软件包管理器
npm i -g aigcfroge@latest        # 也可使用 bun/pnpm/yarn
scoop install aigcfroge             # Windows
choco install aigcfroge             # Windows
brew install anomalyco/tap/aigcfroge # macOS 和 Linux（推荐，始终保持最新）
brew install aigcfroge              # macOS 和 Linux（官方 brew formula，更新频率较低）
sudo pacman -S aigcfroge            # Arch Linux (Stable)
paru -S aigcfroge-bin               # Arch Linux (Latest from AUR)
mise use -g aigcfroge               # 任意系统
nix run nixpkgs#aigcfroge           # 或用 github:keerzzz/AigcForge 获取最新 dev 分支
```

> [!TIP]
> 安装前请先移除 0.1.x 之前的旧版本。

## 桌面应用程序 (BETA)

Aigcfroge 也提供桌面版应用。可直接从 [发布页 (releases page)](https://github.com/keerzzz/AigcForge/releases) 下载。

| 平台                  | 下载文件                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `aigcfroge-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `aigcfroge-desktop-mac-x64.dmg`     |
| Windows               | `aigcfroge-desktop-windows-x64.exe` |
| Linux                 | `.deb`、`.rpm` 或 AppImage         |

```bash
# macOS (Homebrew Cask)
brew install --cask aigcfroge-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/aigcfroge-desktop
```

#### 安装目录

安装脚本按照以下优先级决定安装路径：

1. `$AIGCFROGE_INSTALL_DIR` - 自定义安装目录
2. `$XDG_BIN_DIR` - 符合 XDG 基础目录规范的路径
3. `$HOME/bin` - 如果存在或可创建的用户二进制目录
4. `$HOME/.aigcfroge/bin` - 默认备用路径

## 快速上手

将 AigcForge 指向你选择的模型提供商，然后在配置文件或 UI 中配置模型、权限与 MCP 服务端。按需在 **meta**、**build**、**plan** 三个智能体之间切换，也可在消息中内联调用 **@general** / **@explore** 子智能体进行调研与代码库探索。

## 架构

AigcForge 是一个 17 包 monorepo，基于 [Effect](https://effect.website) 构建，采用 Schema-first 领域模型与 Drizzle + SQLite 持久化：

- **入口层** — `desktop`（Electron 外壳）、`aigcfroge`（sidecar 后端 + 编排）、`tui`（终端 UI）
- **应用层** — `app`（SolidJS 前端）、`server`（HTTP API）、`script`
- **领域层** — `core`（会话/事件/工具/权限/插件）、`llm`（提供商抽象）、`schema`（契约）、`sdk/js`
- **UI 层** — `ui`（设计系统）、`session-ui`（会话渲染）、`storybook`
- **扩展层** — `plugin`（插件 SDK）
- **基础设施层** — `effect-drizzle-sqlite`、`effect-sqlite-node`、`http-recorder`

## 参与贡献

如有兴趣贡献代码，请在提交 PR 前阅读 [贡献指南 (Contributing Docs)](./CONTRIBUTING.md)。

### 基于 opencode 进行开发

如果你在项目名中使用了 "opencode"（如 "opencode-dashboard" 或 "opencode-mobile"），请在 README 里注明该项目不是 Aigcfroge 团队官方开发，且不存在隶属关系。

## 许可证

AigcForge 是 [opencode](https://github.com/anomalyco/opencode) 的派生项目，基于 [MIT 许可证](./LICENSE) 分发。
