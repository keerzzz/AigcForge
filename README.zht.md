<p align="center">
  <a href="https://github.com/keerzzz/AigcForge">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Aigcfroge logo">
    </picture>
  </a>
</p>
<p align="center">開源的 AI Coding Agent。</p>
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

## 什麼是 AigcForge？

AigcForge 是一個開源 AI Agent，它的能力遠不止一個程式設計終端。它是一個**統一的智能體工作台**：四種產品模式因應不同工作場景、透過對話沉澱可重用資產的資產工作室、原生的任務系統，以及一個事件溯源、跨終端持久可恢復的會話執行階段。

## 核心特性

### 四種產品模式

切換模式不會丟失專案進度——會話自動保持同步，每種模式只拿到它該有的工具（也只有這些工具）：

| 模式 | 用途 |
|---|---|
| **Coding**（預設） | 完整開發工作台：編輯程式碼、執行終端、使用 git worktree、執行測試。 |
| **Chat** | 透過對話構建可重用資產。對程式碼唯讀——它*提議*資產，你一鍵 Apply 即可。 |
| **Work** | 非程式設計產出。選擇預設模板，回答幾個澄清問題，預覽結果，然後將 Markdown 文件儲存到專案目錄。 |
| **Assistant**（規劃中） | 代你主動行事的個人智能體。 |

### 資產工作室

七類可重用資產——**提示詞（prompt）、技能（skill）、MCP 服務、命令（command）、智能體（agent）、工作流（workflow）、插件（plugin）**——每種都支援建立、匯入、提議、應用、插入與刪除。在 Chat 模式構建一次，即可在所有專案與模式中重用。

### 原生任務系統

一級公民的任務/Todo 模型，支援依賴關係、優先級、排程與斷點恢復。可將任務委派給子智能體——或委派給 Claude Code、Codex、Gemini、opencode 等外部 CLI——並即時觀察進度更新。

### 智能體體系

- **meta** — 預設編排入口：意圖分類、路由與委派。
- **build** — 預設執行體，具備完整工具權限。
- **plan** — 唯讀模式，適合分析與探索。
- **@general / @explore** — 用於研究與快速程式碼庫探索的子智能體。
- 各模式的編排器（`chat-orchestrator`、`work-orchestrator`）嚴格執行每種模式的能力邊界。

### 事件溯源會話

Session V2 執行階段持久化記錄每一個事件，工作跨重啟不丟失，並在 CLI、TUI 與桌面端保持一致。內建**回滾/撤銷回滾（revert/unrevert）**、**分享（share）**與**摘要（summary）**。

### MCP 與插件 SDK

連接任意 MCP 伺服器——stdio、remote 或 OAuth——並透過插件 SDK 擴充套件 AigcForge：v1 保證穩定，v2 提供基於 Effect 的現代 API。

### 安全優先

權限確認（詢問 / 允許 / 拒絕 / 無人值守自動拒絕）、專案沙箱、不可信匯入防護，以及基於模式對 shell 與命令的限制。

### 一套執行階段，多種形態

CLI、終端 TUI 與 Electron 桌面應用——另有 web、Slack 與同步伺服器等部署單元。

## 安裝

```bash
# 套件管理員
npm i -g aigcfroge@latest        # 也可使用 bun/pnpm/yarn
scoop install aigcfroge             # Windows
choco install aigcfroge             # Windows
brew install anomalyco/tap/aigcfroge # macOS 與 Linux（推薦，始終保持最新）
brew install aigcfroge              # macOS 與 Linux（官方 brew formula，更新頻率較低）
sudo pacman -S aigcfroge            # Arch Linux (Stable)
paru -S aigcfroge-bin               # Arch Linux (Latest from AUR)
mise use -g aigcfroge               # 任意系統
nix run nixpkgs#aigcfroge           # 或用 github:keerzzz/AigcForge 取得最新 dev 分支
```

> [!TIP]
> 安裝前請先移除 0.1.x 之前的舊版本。

## 桌面應用程式 (BETA)

Aigcfroge 也提供桌面版應用。可直接從 [發佈頁 (releases page)](https://github.com/keerzzz/AigcForge/releases) 下載。

| 平台                  | 下載檔案                           |
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

#### 安裝目錄

安裝指令碼按照以下優先級決定安裝路徑：

1. `$AIGCFROGE_INSTALL_DIR` - 自訂安裝目錄
2. `$XDG_BIN_DIR` - 符合 XDG 基礎目錄規範的路徑
3. `$HOME/bin` - 如果存在或可建立的使用者二進位目錄
4. `$HOME/.aigcfroge/bin` - 預設備用路徑

## 快速上手

將 AigcForge 指向你選擇的模型提供者，然後在設定檔或 UI 中設定模型、權限與 MCP 伺服器。按需在 **meta**、**build**、**plan** 三個智能體之間切換，也可在訊息中內聯呼叫 **@general** / **@explore** 子智能體進行調研與程式碼庫探索。

## 架構

AigcForge 是一個 22 套件 monorepo，基於 [Effect](https://effect.website) 構建，採用 Schema-first 領域模型與 Drizzle + SQLite 持久化：

- **入口層** — `aigcfroge`（CLI + 編排）、`cli`、`tui`（終端 UI）、`desktop`（Electron 外殼）
- **應用層** — `app`（SolidJS 前端）、`server`（HTTP API）、`script`
- **領域層** — `core`（會話/事件/工具/權限/插件）、`llm`（提供者抽象）、`schema`（契約）、`sdk/js`
- **UI 層** — `ui`（設計系統）、`session-ui`（會話渲染）、`storybook`
- **擴充套件層** — `plugin`（插件 SDK）
- **基礎設施層** — `effect-drizzle-sqlite`、`effect-sqlite-node`、`http-recorder`
- **部署單元** — `enterprise`、`function`（Cloudflare Worker）、`slack`、`web`

## 參與貢獻

如果您有興趣參與 Aigcfroge 的開發，請在提交 Pull Request 前先閱讀我們的 [貢獻指南 (Contributing Docs)](./CONTRIBUTING.md)。

### 基於 opencode 進行開發

如果您正在開發與 opencode 相關的專案，並在名稱中使用了 "opencode"（例如 "opencode-dashboard" 或 "opencode-mobile"），請在您的 README 中加入聲明，說明該專案並非由 Aigcfroge 團隊開發，且與我們沒有任何隸屬關係。

## 許可證

AigcForge 是 [opencode](https://github.com/anomalyco/opencode) 的派生專案，基於 [MIT 許可證](./LICENSE) 分發。
