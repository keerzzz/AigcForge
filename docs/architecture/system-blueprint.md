# AigcForge Desktop Architecture Blueprint

> 状态：草案 v2.0，基于 V2 纯代码重写
> 代码基线：app.tsx, layout.tsx, session.tsx, home-overview.tsx, titlebar.tsx（原 home.tsx 已按 mode-page-unification-v2 Phase 1 拆除为 pages/home-shared.tsx + pages/coding-project-column.tsx）

---

## 1. 架构概览

AigcForge 桌面端采用 **SolidJS + Electron/Tauri 双壳层** 架构，单一 V2 布局系统。

### 1.1 桌面壳层

- **Electron**: window.api.\* — contextBridge 暴露的 IPC 接口
- **Tauri**: window.**TAURI**.\* — Tauri invoke IPC 接口
- 双壳层通过运行时特性检测切换

### 1.2 安全原则

- Renderer 不直接执行任意本地命令
- Preload 不暴露通用 shell 执行能力
- 本地文件写入须经项目根目录约束和路径归一化
- 日志不输出 token、Authorization、完整 prompt 或用户文件全文

---

## 2. Provider 层级

与 app.tsx 严格对齐。共三层：全局 Provider → 服务器级 Provider → Session 级 Provider。

### 2.1 全局 Provider

```
AppBaseProviders
  MetaProvider, Font, ThemeProvider, LanguageProvider
  UiI18nBridge, ErrorBoundary, QueryProvider
  WslServersProvider, DialogProvider, MarkedProvider, FileComponentProvider

ServerProvider, GlobalProvider, SettingsProvider
  ConnectionGate, TabsProvider
    SharedProviders (Command, Highlights, BodyDesignClass)
```

### 2.2 服务器级 Provider

```
SelectedServerProviders
  ServerKey → ServerSDKProvider → ServerSyncProvider

ServerScopedProviders
  PermissionProvider → LayoutProvider → NotificationProvider → ModelsProvider
```

### 2.3 Session 级 Provider (仅在 Session 路由内)

```
SessionProviders
  TerminalProvider → FileProvider → PromptProvider → CommentsProvider
```

DraftProviders (草稿页，无终端)
FileProvider → PromptProvider → CommentsProvider

---

## 3. 路由拓扑

| 路径                           | 组件               | 说明                    |
| ------------------------------ | ------------------ | ----------------------- |
| /                              | Home               | 项目列表 + Session 搜索 |
| /new-session                   | DraftRoute         | 草稿新建                |
| /server/:serverKey/session/:id | TargetSessionRoute | Session 主工作台        |

---

## 4. 布局骨架

Layout 组件 (layout.tsx)：

- Titlebar (36px): Tab 条 + 导航 + 窗口控制
- Main: 当前路由内容 (Home / Draft / Session)
- Session 自身渲染 SessionHeader、工作台、SessionSidePanel 和 TerminalPanel
- ToastRegion: 右上角通知
- DebugBar: 底部开发工具

`pages/layout/sidebar-shell.tsx` 中存在 SidebarContent 组件，但当前 `pages/layout.tsx` 未挂载全局 Sidebar。不要把 SidebarContent 当作当前应用壳层的一部分实现或测试。

---

## 5. Session 工作台

Session 页面核心结构：

- SessionHeader: 当前 Session 顶部操作条
- SessionSidePanel: Review/File tab 容器、上下文 tab、文件树
- MessageTimeline: 虚拟化消息列表 (@tanstack/solid-virtual)
- SessionComposerRegion: 输入框 + InterruptionDock
- TerminalPanel: PTY 终端 (多标签、可拖拽调整高度)
- Review 内容: 由 SessionSidePanel 的 reviewPanel slot 渲染 Diff 评审 + 行内评论

---

## 6. 首页

`HomeOverview` 组件（ADR-16 全局聚合首页）：

- 跨模式会话列表 + 模式/项目筛选 + 「继续上次」置顶 + 会话搜索
- 复用 `home-shared.tsx`（Session 数据管线与展示组件）与 `coding-project-column.tsx`（项目行）
- `/mode/:mode` 各模式首页由共享 ModeWorkspace typed slots 承载（ADR-15）

---

## 7. 数据持久化

- 存储: localStorage + 工作区文件
- Key: ServerScope + SessionRouteKey + SessionStateKey + ScopedKey
- 迁移: migrateLegacySessionStateKeys (V1→V2 已完成，当前为透传)

---

## 8. 设计系统

- UI: @aigcfroge/ui V2 组件 (27 个)
- CSS: --v2-\* Token
- 字体: font-family-text + 13px/440
- 图标: @aigcfroge/ui/icon
- i18n: I18nProvider + 多语言字典

---

## 9. 后续规划 (PLANNED，当前代码未实现)

- Status Bar: 底部度量栏
- CHAT/WORK/Assistant 模式 Viewport 的剩余补全项（见 `docs/roadmap/v2-ux-ui-roadmap.md`）

> 已从本节移出（**已实现**，不再是规划项）：Mode Switcher 第五模式 Custom（`ProductMode.ID` 已是五值联合，ADR-17 M0–M3 已合入 `main`，运行时由 `AIGCFROGE_CUSTOM_MODE` opt-in 门控，默认关）、MetaAgent 调度、`.aigcfroge/` 资产体系。权威状态见 [ARCHITECTURE.md](../../ARCHITECTURE.md) §4.10 与 §7。

---

## 10. 包拓扑

**唯一真源是 workspace manifest**（`package.json` 的 `workspaces`: `packages/*` + `packages/sdk/js`）与 [ARCHITECTURE.md](../../ARCHITECTURE.md) §3 的分层视图。本文件不再维护第二份拓扑副本——历史副本曾漂移到 21 包并列出 `cli` / `function` / `slack` / `web` / `enterprise` 五个已不存在的包。

复核命令：

```bash
ls -d packages/*/package.json packages/sdk/js/package.json | wc -l   # 期望 17
```

`packages/enterprise/` 目录仍有一个被跟踪的遗留文件但**没有** `package.json`，因此不是 workspace 包，也不在任何 `tsconfig` / `turbo` 图内。

### 10.3 共享基础设施

- **Effect**: 全仓 Effect-TS 依赖注入和错误处理
- **Bun**: 开发/测试运行时
- **Drizzle**: core 包中定义数据库 schema，SQLite 持久化
- **SolidJS**: app 包前端框架
- **CSS 变量**: --v2-\* Token 体系，跨包共享主题

---

## 11. Session V2 核心架构

Session V2 是 AigcForge 的业务主干，负责从用户输入到 AI 响应的完整生命周期。

### 11.1 核心概念

| 概念             | 定义                                              | 代码位置                          |
| ---------------- | ------------------------------------------------- | --------------------------------- |
| Session          | 一次对话会话，包含项目目录、Agent、Model 等元数据 | core/src/session.ts               |
| SessionInput     | 用户输入的持久化记录 (Prompt + Delivery mode)     | core/src/session/input.ts         |
| SessionExecution | 进程内调度器，按 Session ID 路由到对应 Runner     | core/src/session/execution.ts     |
| SessionRunner    | Location 级运行器，执行一次 LLM 调用              | core/src/session/runner/index.ts  |
| SessionStore     | Session 持久化存储 (SQLite/Drizzle)               | core/src/session/store.ts         |
| SessionProjector | 事件投影器，从 Event Stream 构建 Session 视图     | core/src/session/projector.ts     |
| EventV2          | 事件源，PubSub + 持久化事件流                     | core/src/event.ts                 |
| SystemContext    | 独立刷新的类型化系统上下文源 (文件树/Git 状态等)  | core/src/system-context/index.ts  |
| ContextEpoch     | 上下文的持久化快照时间点                          | core/src/session/context-epoch.ts |

### 11.2 Prompt 生命周期

```
用户输入
  → SessionInput.admit(db, events, {id, sessionID, prompt, delivery})
    → 写入 session_input 表 (一行)
    → resume !== false 时 SessionExecution.wake(sessionID)
      → SessionRunner.run({sessionID, force})
        → 按 sessionID 读取 Session 并进入对应 Location
        → 初始化缺失的 Context Epoch
          - 首个 provider turn: initial context 必须先完整观察并初始化 epoch
          - initial context 不可用时停止，本次 input 保持 pending/retryable
        → Promote 合格 input
          - steer: 在 safe provider-turn boundary 批量提升
          - queue: Session 即将空闲时 FIFO 提升一个
        → Reconcile SystemContext
          - 普通 provider turn 在 input/tool settlement 后采样上下文变化
          - 上下文变化作为 chronological system message 持久化
        → 加载投影历史 (SessionHistory / SessionProjector)
        → 构建 LLM request (baseline + chronological history + tools)
        → LLM Provider 调用 (唯一一次 llm.stream(request))
        → 事件发布 (EventV2 PubSub)
        → UI 通过 SDK 订阅事件流更新 Timeline
```

**Delivery 模式**:

- `steer`: 引导当前 drain，不新起 drain
- `queue`: 排队等待 Session 空闲时提升

**关键约束** (来自 AGENTS.md):

- 每次 Provider turn 只有一次 `llm.stream(request)` 调用
- 持久化 prompt 先于模型执行
- 复用 Session ID = 复用已有 Session，复用 prompt message ID = 精确重试
- SessionExecution 进程全局，通过 `SessionStore` + `LocationServiceMap` 发现 placement
- SessionRunner、模型解析、工具注册表、权限、文件系统均 Location 限定
- 本地 Session drain 保持进程内，直到集群实现

### 11.3 EventV2 模型

```
EventV2.Definition<Type, DataSchema>
  type: 事件类型字符串
  durable?: { version, aggregate } — 持久化事件
  data: Schema — 事件负载

EventV2.Payload
  id: evt_* (事件 ID)
  type: 事件类型
  data: 事件数据
  durable?: { aggregateID, seq, version } — 持久化元数据
```

- 通过 PubSub 发布/订阅
- 持久化事件写入 event 表，按 aggregate 聚合，version 递增
- SessionProjector 投影事件到 Session 视图

### 11.4 System Context 架构

```
SystemContext.Source<A>
  key: "namespace/source-name" (命名空间)
  codec: Schema.Codec<A> (序列化)
  load: Effect<A | Unavailable> (观察数据源)
  baseline: (A) => string (首次快照)
  update: (prev, curr) => string (增量更新)
  removed?: (A) => string (源移除时的通知)

SystemContext.make(source<A>) → SystemContext (opaque)
  → 与不同值类型的 SystemContext 统一组合
  → 解释器观察一次 → 生成 Snapshot
```

内置源 (builtins.ts): 文件树、Git 状态、工作区信息等。
注册表 (registry.ts): 管理所有已注册的 SystemContext 源。

### 11.5 数据表结构

| 表              | 用途                                                                |
| --------------- | ------------------------------------------------------------------- |
| session         | Session 元数据 (id, directory, agent, model, location, created_at)  |
| session_input   | Prompt 输入队列 (admitted_seq, promoted_seq, delivery, prompt JSON) |
| session_message | 消息记录 (id, session_id, role, parts JSON)                         |
| event           | EventV2 持久化事件                                                  |
| event_sequence  | 事件序列号管理                                                      |

Schema 定义: session_input/session_message/session_context_epoch (core/src/session/sql.ts) + event/event_sequence (core/src/event/sql.ts)。

### 11.6 Meta-Agent 委派生命周期（目标态）

当前 Meta-Agent 已支持基本的 child Session/task_id 续接、外部 CLI resume、PermissionV2 bridge 与 AgentTaskHub 投影；这些能力还不是统一的持久委派生命周期。目标态使用 [ADR-22](adr/ADR-22-meta-agent-persistent-delegation.md) 定义的：

```text
Delegation → Participant → Turn → Delivery
  internal Build participant → child Session
  external Codex/Claude participant → external thread
```

EventV2 负责 durable delegation events，Drizzle 表负责查询投影，SessionV2/TaskDriver/CliAdapter 负责实际执行。`task_id`、`external_cli_session` 与 `meta_agent_step` 在迁移期间保留为兼容投影，不能作为新的聚合根。

### 11.7 前端集成 (app 包)

在前端 app.tsx 中，Session 页面通过以下 Provider 链接入 V2 核心：

```
TargetSessionRoute
  → ServerSDKProvider (SDK 客户端)
  → ServerSyncProvider (数据同步)
  → TargetServerScopedProviders
    → PermissionProvider / NotificationProvider / ModelsProvider
    → SDKProvider (directory 绑定)
    → DirectoryDataProvider
    → SessionProviders (Terminal/File/Prompt/Comments)
    → Session 组件
```

SDK 层通过 `@aigcfroge/sdk/v2` 的 WebSocket/HTTP 与 server 通信，server 代理到 core 包的 SessionV2 API。
