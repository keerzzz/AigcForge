<p align="center">
  <a href="https://github.com/keerzzz/AigcForge">
    <h1 align="center">AigcForge</h1>
  </a>
</p>

<p align="center">
  <strong>面向下一代软件工程与泛知识创作的开源 AI 智能体工作台（Unified Agentic Workspace）</strong>
</p>

<p align="center">
  <a href="https://github.com/keerzzz/AigcForge/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" /></a>
  <a href="https://effect.website"><img alt="Effect-TS" src="https://img.shields.io/badge/Powered%20by-Effect--TS-orange.svg?style=flat-square" /></a>
  <a href="https://github.com/keerzzz/AigcForge/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/keerzzz/AigcForge/publish.yml?style=flat-square&branch=main" /></a>
  <a href="https://github.com/keerzzz/AigcForge/releases"><img alt="Release" src="https://img.shields.io/github/v/release/keerzzz/AigcForge?style=flat-square" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/keerzzz/AigcForge">
    <img src="screenshot-uk.png" alt="AigcForge Terminal UI & Workspace" width="800" />
  </a>
</p>

---

## 目录

- [1. 什么是 AigcForge？](#1-什么是-aigcforge)
- [2. 五大产品模式矩阵（Product Modes Matrix）](#2-五大产品模式矩阵product-modes-matrix)
  - [Coding 模式（全功能智能编程）](#coding-模式全功能智能编程)
  - [Chat 模式（资产工作室：对话价值沉淀）](#chat-模式资产工作室对话价值沉淀)
  - [Work 模式（非编程结构化执行层）](#work-模式非编程结构化执行层)
  - [Assistant 模式（私人主动事项助手）](#assistant-模式私人主动事项助手)
  - [Custom 模式（资产组合与运行平台 - 规划中）](#custom-模式资产组合与运行平台---规划中)
- [3. 核心技术创新与子系统架构](#3-核心技术创新与子系统架构)
  - [Session V2 & EventV2 事件溯源引擎](#session-v2--eventv2-事件溯源引擎)
  - [Meta-Agent 元智能体统一编排](#meta-agent-元智能体统一编排)
  - [External CLI 跨工具调度体系（ACP / SDK）](#external-cli-跨工具调度体系acp--sdk)
  - [Harness 7 层加固与防幻觉闭环](#harness-7-层加固与防幻觉闭环)
  - [安全分级权限与路径沙箱](#安全分级权限与路径沙箱)
- [4. Monorepo 18 个全量软件包拓扑](#4-monorepo-18-个全量软件包拓扑)
- [5. 安装指南与多端支持](#5-安装指南与多端支持)
- [6. 核心场景上手与工作流](#6-核心场景上手与工作流)
- [7. 产品路线图与演进状态](#7-产品路线图与演进状态)
- [8. 开源治理与贡献](#8-开源治理与贡献)
- [9. 开源协议](#9-开源协议)

---

## 1. 什么是 AigcForge？

**AigcForge** 不仅仅是一个命令行编码工具，它是一个**统一的智能体工作台（Unified Agentic Workspace）**。

传统 AI 编程工具往往局限于单一终端、缺乏过程验证、对话经验无法复用，且难以适配非编程岗位。AigcForge 围绕**“人机协同资产化”**与**“可靠工程交付”**理念，构建了：
- **四+一多维产品模式**：适配专业开发、资产沉淀、泛岗位交付与主动事项管理。
- **对话沉淀资产工作室**：通过引导创建、会话捕获与外部导入，将对话经验直接沉淀为 7 大类项目级可复用受控资产。
- **跨工具智能体调度（External CLI Dispatch）**：内置智能体与 Claude Code、Codex、Gemini、opencode 等外部顶尖 CLI 协同执行。
- **工业级 Effect-TS 架构**：全链路采用 Schema-First 契约、Session V2 事件溯源、SQLite 事务持久化与 Harness 7 层机械化防幻觉闭环。

---

## 2. 五大产品模式矩阵（Product Modes Matrix）

AigcForge 采用持久化的 `Product Mode` 分类体系。切换模式不会丢失项目上下文，会话自动保持同步，且每种模式在安全策略上**只暴露该模式允许的最小工具集**。

```
┌────────────────────────────────────────────────────────────────────────┐
│                        AigcForge Product Workspace                     │
├───────────────────┬───────────────────┬──────────────────┬─────────────┤
│   Coding Mode     │     Chat Mode     │    Work Mode     │  Assistant  │
│  (全功能代码开发)  │   (资产沉淀工作室)  │  (非编程结构交付) │ (主动事项)  │
├───────────────────┴───────────────────┴──────────────────┴─────────────┤
│                     Custom Mode (资产组合运行平台)                       │
├────────────────────────────────────────────────────────────────────────┤
│                      Meta-Agent 统一编排与路由中枢                      │
├────────────────────────────────────────────────────────────────────────┤
│         Session V2 (事件溯源 / 增量状态 / 机械验证 / 权限分级)          │
└────────────────────────────────────────────────────────────────────────┘
```

### Coding 模式（全功能智能编程）
- **核心定位**：专业开发者的全功能智能编程工作台。
- **核心能力**：
  - 代码阅读、检索、精准修改（Patch / AST 级别替换）、Git Worktree 多分支隔离并行开发。
  - 集成终端与子进程管理，可自主执行测试、构建与排错。
  - 内置 `@general`（调研）与 `@explore`（快速全库代码探索）子智能体，支持 `@mention` 语法即时唤起。
  - 拥有机械化验证（Verification Gate）：代码修改后自动触发相关包的 `typecheck`，即时捕获类型缺陷。

### Chat 模式（资产工作室：对话价值沉淀）
- **核心定位**：对话即创造，将对话中的隐性经验提炼为团队显性资产（对话价值 → 项目资产）。
- **核心能力**：
  - **7 类标准受控资产**：提示词（`prompt`）、技能（`skill`）、`mcp` 服务、命令（`command`）、智能体（`agent`）、工作流（`workflow` 定义）、插件（`plugin`）。
  - **三条资产供给路径**：
    1. *引导创建（Guided Creation）*：通过结构化问答推断资产类型与参数并生成草稿。
    2. *会话捕获（Session Capture）*：在任意模式的消息气泡上一键“存为资产”，预填并转换。
    3. *外部导入（External Import）*：支持粘贴外部 AI 对话或导入文件，自动过滤思考过程与对话噪声，提取纯净资产。
  - **Fail-Closed 安全边界**：创建智能体仅有只读与 `propose_*_asset` 提议权限，无 Shell / Edit 权限；资产落盘需用户在右栏 Diff 确认后，通过服务端强类型事务原子写入项目目录（`<project>/.aigcfroge/`）。

### Work 模式（非编程结构化执行层）
- **核心定位**：面向泛岗位人群的高质量结构化交付工作台（预设任务 → 过程可视化 → 安全交付）。
- **覆盖人群（12 大 IT 工种 + 5 类泛办公创作人群）**：
  - **IT 研发角色**：PO 商业需求与 WSJF 评估、BA Gherkin BDD 规约、UI/UX Design Tokens、架构师 ADR 决策记录、FE/BE API 与数据契约、QA 自动化测试用例、SRE 故障 Postmortem 报告、数据分析师 SQL 审计与因果推断等。
  - **泛办公与创作人群**：视频分镜脚本策划、游戏系统设计案（GDD）、科研文献综述与对比矩阵、学生论文提纲与开题报告、零基础小白问卷式公文写作。
- **核心能力**：
  - **Presets Catalog 场景预设库**：开箱即用的专业模板与问卷式参数澄清引导。
  - **Progress Ledger（实时进度账本）**：阶段可视化追踪，支持意外中断后的**增量断点恢复（Resume）**。
  - **同名文件安全检测**：写入时智能感知文件冲突，提供侧边栏 Diff 确认与防覆盖保护。
  - **逆向资产闭环**：任务成功产出物支持一键“存为资产”，回流至 Chat 资产工作室。

### Assistant 模式（私人主动事项助手）
- **核心定位**：个人长效上下文管理与主动事项触达层。
- **核心能力**：
  - **持久化调度器（Persistent Scheduler）**：支持自然语言设定单次或周期提醒；基于租约（Lease）认领与幂等投递机制，**离线关机重启后自动补投逾期事项**，无需常驻后台消耗资源。
  - **个人知识库与记忆（`kb_note`）**：支持 `[[wikilink]]` 双向链接与知识沉淀，基于真实笔记提供带有原文章节角标引用的置信回答。
  - **网络研报与事实检索**：集成 `websearch` 与 `webfetch`，实时抓取外部信息并整理为个人笔记。

### Custom 模式（资产组合与运行平台 - 规划中）
- **核心定位**：用户资产的组合、配置、测试与多智能体运行环境（ADR-17）。
- **核心能力**：
  - 允许用户为固定根编排器 `meta` 绑定自建的特定 Agent、Prompt、Skill 与 MCP 工具集。
  - 运行前生成可解释的 `CompositionPlan`（明确呈现当前上下文中的指令、权限集与可用能力）。
  - 会话启动时冻结不可变的 `CompositionSnapshot`，确保历史回溯与恢复时版本完全一致，不受外部资产修改影响。

---

## 3. 核心技术创新与子系统架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        AigcForge Core Subsystems                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [ 用户接入与终端 ] ──► [ Meta-Agent 编排中枢 ] ──► [ Intent 分类与路由 ] │
│                                │                                        │
│          ┌─────────────────────┼─────────────────────┐                  │
│          ▼                     ▼                     ▼                  │
│    [ 内置智能体 ]        [ 模式专用编排器 ]      [ 外部 CLI 适配器 ]        │
│   (build/plan/explore)   (chat/work-orchestrator) (Claude/Codex/Gemini) │
│          │                     │                     │                  │
│          └─────────────────────┬─────────────────────┘                  │
│                                ▼                                        │
│  [ Session V2 运行时 ] ◄──► [ Harness 7 层加固防幻觉 ] ◄──► [ 权限与沙箱 ]│
│         │                      (DoomLoop/Typecheck/Store) (Propose/Full)│
│         ▼                                                               │
│  [ EventV2 事件源与 SQLite 持久化 (Effect + Drizzle) ]                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Session V2 & EventV2 事件溯源引擎
- **Durable Input 准入分离**：用户指令首先进入持久化收件箱表（`session_input`），随后由受控的 Drain Runner 串行推进，避免网络抖动或崩溃导致指令丢失。
- **EventV2 领域事件流**：全生命周期的状态变更（消息流式生成、工具调用、权限审批、状态沉淀）均作为领域事件持久化存储，支持多端实时 PubSub 广播。
- **确定性回溯与时光机**：
  - **Revert / Unrevert**：精确回退到任意历史 Turn 并重放。
  - **Session Share**：支持会话快照导出与团队共享。
  - **Compaction**：长会话智能摘要压缩，保留关键上下文并重置 Prompt 前缀。

### Meta-Agent 元智能体统一编排
- **单一统一交互入口**：用户无需频繁手动切换模型或底层 Agent，由 `meta` 统一接收指令。
- **三层 System Prompt 架构**：
  - **L1 恒定区**：字节级锁定系统角色与路由框架（最大化激发 LLM Prompt Cache，大幅降低成本与延迟）。
  - **L2 会话区**：固化当前工作区可用 CLI 与智能体列表。
  - **L3 动态区**：动态注入会话即时上下文与委派历史。
- **灵活的调度策略**：支持单任务精准路由、工作流串行流水线（Plan → Build → Review）以及 `@mention` 多智能体并行分发（Fan-out）。

### External CLI 跨工具调度体系（ACP / SDK）
AigcForge 打破了工具孤岛，支持直接将子任务无缝委派给外部顶级编码 CLI：
- **受支持的外部 CLI**：`claude-code`、`codex`、`gemini`、`opencode`。
- **三层弹性通信传输层**：
  1. **ACP（Agent Client Protocol）**：基于 `@agentclientprotocol/sdk` 的现代化双向客户端协议（优先通道）。
  2. **Official SDK**：集成 `@anthropic-ai/claude-agent-sdk` 与 `@openai/codex-sdk`。
  3. **JSONL Subprocess**：底层兼容的标准进程管道生成与解析。
- **统一权限桥接**：外部 CLI 的所有工具调用均被拦截并桥接回 AigcForge 的 `PermissionV2` 系统，确保安全边界不被击穿。

### Harness 7 层加固与防幻觉闭环
针对大模型在软件工程中的“假装修改”、“死循环尝试”、“悬空链接”等幻觉问题，构建了全自动闭环防线：
1. **Doom Loop 检测器**：拦截连续相似参数的无意义重复失败调用。
2. **引用完整性校验（Reference Integrity Checker）**：模型编辑文件后，自动检查 Markdown 链接与 `import` 引用路径，发现悬空引用立即在当前轮次报错纠正。
3. **机械化验证门禁（Verifier Gate）**：代码修改意图触发后，自动对受影响包运行 `typecheck` 或测试，失败信息精准映射条款回传。
4. **CorrectionStore（纠正持久化库）**：将验证失败的纠正结论存为 Session 级“Verified facts”，后续轮次通过 System Context 注入（只存正确事实，不污染历史），并在 Compaction 后持久保留。
5. **多模型仲裁（Judge / PGE 动态路由）**：在复杂分歧或高难度修改场景下，自动拉起多模型投票裁决。

### 安全分级权限与路径沙箱
- **双档位权限信封**：
  - `propose` 档位（Chat 模式默认）：仅允许只读与结构化草稿提议，杜绝私自修改。
  - `full` 档位（Coding 模式）：受控的执行权限，支持细粒度的 `ask`（询问确认）、`allow`（放行）、`deny`（拦截）与无人值守自动拒绝。
- **路径沙箱收敛**：符号链接穿越防护（Symlink-aware Containment），杜绝工作区逃逸。

---

## 4. Monorepo 18 个全量软件包拓扑

AigcForge 代码库基于 Bun + Turbo 构建，严格遵循分层依赖原则（上层依赖下层，禁止反向与跨层环形依赖）。各包职能矩阵如下：

| 分层 (Layer) | 软件包目录 | 真实包名 (`package.json`) | 核心职责与业务定位 |
|---|---|---|---|
| **入口层 (Entry)** | `packages/desktop` | `@aigcfroge/desktop` | **Electron 桌面端壳工程**：封装多窗口、IPC 通信、本地 sidecar 进程生命周期管理与原生通知。 |
| | `packages/aigcfroge` | `aigcfroge` | **核心业务引擎与 CLI**：包含命令行解析、Sidecar 服务端、Meta-Agent 调度、各类 Tool/MCP 具体实现及运行时胶水层。 |
| | `packages/tui` | `@aigcfroge/tui` | **终端交互界面 (TUI)**：基于 OpenTUI + Solid 构建的极速、高密度命令行交互终端。 |
| **应用层 (Application)** | `packages/app` | `@aigcfroge/app` | **SolidJS 核心前端应用**：实现多模式路由（`/mode/:mode`）、ModeWorkspace 插槽、会话状态机与交互界面。 |
| | `packages/server` | `@aigcfroge/server` | **统一 HTTP/SSE API 服务**：基于 Effect `HttpApiBuilder` 构建，自动生成标准 OpenAPI 3.0 契约文档。 |
| | `packages/script` | `@aigcfroge/script` | **工程辅助与发版脚本**：负责版本自动计算、跨包发版与发布流水线。 |
| **领域层 (Domain)** | `packages/core` | `@aigcfroge/core` | **领域核心模型**：Session V2、EventV2、ToolRegistry、PermissionV2、SystemContext、ACP Client、SQLite 事务等纯领域逻辑。 |
| | `packages/llm` | `@aigcfroge/llm` | **LLM 统一抽象层**：基于 Effect-Schema 的多模型统一路由与协议转换（OpenAI, Claude, Gemini, DeepSeek, Ollama 等）。 |
| | `packages/schema` | `@aigcfroge/schema` | **纯 Schema 契约库**：跨包共享的基础数据契约与强类型定义，无外部冗余依赖。 |
| | `packages/sdk/js` | `@aigcfroge/sdk` | **TypeScript/JavaScript SDK**：基于 OpenAPI 自动生成的客户端 SDK，供外部程序与前端集成调用。 |
| **UI 呈现层 (UI)** | `packages/ui` | `@aigcfroge/ui` | **现代化设计系统 (Design System)**：Token V2 样式系统、37 套内置主题引擎、无障碍基础组件库与 i18n 国际化。 |
| | `packages/session-ui` | `@aigcfroge/session-ui` | **会话专业渲染组件**：流式 Markdown 渲染、交互式代码 Diff 查看器、工具调用卡片与审计视图。 |
| | `packages/storybook` | `@aigcfroge/storybook` | **组件画廊与视觉回归测试**：UI 组件隔离开发、预览与 Storybook 文档展示。 |
| **扩展与企业层 (Extension)** | `packages/plugin` | `@aigcfroge/plugin` | **插件扩展 SDK**：支持 V1 稳定插件协议与 V2 现代 Effect-based 扩展生命周期注入机制。 |
| | `packages/enterprise` | `@aigcfroge/enterprise` | **企业级扩展模块**：远程会话分享（Session Share）、多租户隔离与企业安全审计接口。 |
| **基础设施层 (Infra)** | `packages/effect-drizzle-sqlite` | `@aigcfroge/effect-drizzle-sqlite` | **Drizzle + Effect SQLite 适配器**：将 Drizzle ORM 无缝桥接至 Effect 事务与上下文生态。 |
| | `packages/effect-sqlite-node` | `@aigcfroge/effect-sqlite-node` | **Node SQLite 原生驱动绑定**：高性能底层 SQLite 驱动封装。 |
| | `packages/http-recorder` | `@aigcfroge/http-recorder` | **HTTP 磁带录制与回放工具**：用于确定性集成测试，录制外部 API 网络请求并在离线时精准回放。 |

---

## 5. 安装指南与多端支持

### 命令行工具（CLI / TUI）安装
通过各大包管理器可一键全局安装：

```bash
# Node.js / Bun / pnpm
npm install -g aigcfroge@latest
# 或 bun add -g aigcfroge

# macOS & Linux (Homebrew)
brew install anomalyco/tap/aigcfroge

# Windows (Scoop / Chocolatey)
scoop install aigcfroge
# 或 choco install aigcfroge

# Arch Linux (AUR)
paru -S aigcfroge-bin

# 通用环境管理 (mise / nix)
mise use -g aigcfroge
nix run nixpkgs#aigcfroge
```

### 桌面客户端（Desktop App）下载
支持各主流操作系统，可前往 [GitHub Releases](https://github.com/keerzzz/AigcForge/releases) 获取安装包：

| 平台 | 安装包格式 | 安装命令（可选） |
|---|---|---|
| **macOS (Apple Silicon)** | `.dmg` (arm64) | `brew install --cask aigcfroge-desktop` |
| **macOS (Intel)** | `.dmg` (x64) | `brew install --cask aigcfroge-desktop` |
| **Windows** | `.exe` / `.msi` (x64) | `scoop install extras/aigcfroge-desktop` |
| **Linux** | `.AppImage` / `.deb` / `.rpm` | 可直接赋予执行权限运行 |

---

## 6. 核心场景上手与工作流

### 场景 1：全栈极客的日常编程（Coding Mode）
1. 在项目根目录启动：`aigcfroge`（或在桌面端直接打开工程文件夹）。
2. 在默认 **Coding 模式** 下，输入：
   > *"重构 packages/core 中的 session 缓存逻辑，并利用 @explore 检查所有依赖方的调用方式。"*
3. Meta-Agent 自动识别意图，调度 `@explore` 遍历依赖，调用 `edit` 实施重构，并自动触发 `typecheck` 门禁保证零编译错误。

### 场景 2：沉淀业务规范与最佳实践（Chat 模式）
1. 切换至左侧导航栏的 **Chat 模式**（或按快捷键进入 `/mode/chat`）。
2. 输入提示词创建指令，例如：
   > *"帮我制作一个前端 Code Review 的技能，要求重点检查 Effect 错误处理和 Tailwind Token V2 的使用规范。"*
3. 创建 Agent 与你互动确认参数，生成 `propose_skill_asset` 提议。
4. 在右侧面板中实时预览生成的 Markdown，确认后点击 **Apply**，资产被原子写入 `.aigcfroge/skills/`，立即在团队内共享。

### 场景 3：非编程岗位的结构化任务交付（Work Mode）
1. 进入 **Work 模式**，从 **Presets Catalog** 中选择 `BDD Gherkin 规约生成` 或 `视频分镜脚本策划`。
2. 回答引导式澄清问题，系统生成 **Progress Ledger（任务账本）**，分步展现分析与编写过程。
3. 在右栏只读预览生成的交付物，确认无误后点击“安全保存”。若发现优秀的工作流，点击消息气泡下方的 **“存为资产”**，无缝导入 Chat 资产工作室。

### 场景 4：外部顶尖 CLI 异构协同
在对话中直接 `@mention` 外部工具，例如：
> *"@claude-code 请利用官方 SDK 深入排查底层 node-pty 进程挂起的问题并输出解决方案。"*
系统通过 ACP / SDK 协议拉起外部 CLI 执行，结果实时透传至主面板并统一记录在 Session V2 中。

---

## 7. 产品路线图与演进状态

```
里程碑阶段          状态与交付说明
─────────────────────────────────────────────────────────────────────────────
[已全量落地]  Phase 1-6 核心底座
            ├── Session V2 / EventV2 事件溯源运行时与 SQLite 持久化
            ├── Meta-Agent 智能路由与三层 Prompt 缓存前缀优化
            ├── External CLI 跨工具调度（ACP / SDK / JSONL 全协议支持）
            ├── Harness 7 层加固（Doom Loop 检测、类型机械验证、Verified Facts 注入）
            └── Session 权限分级（propose / full 档位与 Location 隔离）

[已全量落地]  Chat Mode M1-M7 资产工作室全闭环
            └── 7 类资产（Prompt/Skill/MCP/Command/Agent/Workflow/Plugin）
                引导创建、会话捕获、外部导入、CAS 事务原子落盘全部就绪

[稳步推进中]  Work Mode M1-M3.5 非编程执行层
            ├── Presets Catalog 场景预设库与问卷式参数澄清
            ├── Progress Ledger 进度账本与增量断点恢复 (Resume)
            └── 同名文件冲突 Diff 校验与 Context Inspector 增强

[规划评审中]  Assistant Mode & Custom Mode
            ├── Assistant M0-M1：持久化定时 Scheduler、离线补投与本地知识库
            └── Custom Mode (ADR-17)：多资产组合 Profile、Plan 预览与不可变 Snapshot 运行
```

---

## 8. 开源治理与贡献

AigcForge 秉持开放、严谨、工程卓越的开源理念，欢迎社区参与贡献！

- **代码规范（Code Style）**：请详细阅读 [AGENTS.md](./AGENTS.md) 与 [ARCHITECTURE.md](./ARCHITECTURE.md)。所有核心领域逻辑均基于 **Effect-TS** 编写，严格遵循类型安全与分层依赖。
- **本地开发与测试**：
  ```bash
  # 安装依赖
  bun install

  # 运行全包类型检查（禁止直接调用 tsc）
  bun typecheck

  # 运行指定包测试
  bun --cwd packages/core test
  ```

---

## 9. 开源协议

AigcForge 是 [opencode](https://github.com/anomalyco/opencode) 的派生项目，基于 [MIT License](./LICENSE) 开源分发。
