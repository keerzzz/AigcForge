# Product Mode Module Switching Completion Plan

> 状态：ADR-11/12 COMPLETED（2026-07-13）；ADR-15（ModeWorkspace 主区 typed slot，见末尾章节）Proposed，待 owner 评审后实施
> 决策日期：2026-07-12
> 实施完成：2026-07-13
> Owner：App + Session Platform
> 架构决策：[`ADR-11-product-mode-session-classification.md`](../architecture/adr/ADR-11-product-mode-session-classification.md)、[`ADR-12-product-mode-entry-routing.md`](../architecture/adr/ADR-12-product-mode-entry-routing.md)
> 取代：[`mode-unified-architecture.md`](mode-unified-architecture.md)、[`mode-switcher-implementation.md`](mode-switcher-implementation.md)
> 后续扩展边界：本计划记录已经完成的四模式基线。ADR-17/Custom PRD 提议通过独立 M0 治理增加固定 `custom`；接受前不得把本计划中的封闭四值约束改写为已实现五值，也不得从前端放宽为任意字符串 Mode。

## 实施摘要

### 已完成

| 层面 | 内容 | 状态 |
|------|------|------|
| **Domain** | ProductMode Schema (`chat\|coding\|work\|assistant`) | ✅ |
| **DB** | session 表新增 mode 列 + 2 索引 + migration | ✅ |
| **Schema** | V2 Info `mode` required / V1 SessionInfo decoding default | ✅ |
| **API** | create/list 支持 mode（根/子/Fork 继承）| ✅ |
| **SDK** | 重新生成，ProductMode 类型 + Session.mode | ✅ |
| **ModeContext** | 删除 activeSessionId/ActiveSessionMap/placement | ✅ |
| **DraftTab** | 新增必需 mode 字段，持久化迁移将历史/非法值归一为 Coding | ✅ |
| **Routing** | 新增 `/mode/:mode`，卡片和全局 ModeSwitcher 通过路由进入模块 | ✅ |
| **Secondary Sidebar** | Coding 保持项目树；Chat/Work/Assistant 占位 | ✅ |
| **Right Panel** | Coding 保持 review/file tree；其他模式占位 | ✅ |
| **submit.ts** | draft → session.create 传入 draft.mode | ✅ |
| **Mode authority** | Module/Draft/Session 路由单向同步持久化 currentMode | ✅ |

### ADR-12 落地约束

- `/mode/:mode` 只接受 `chat | coding | work | assistant`。
- Home 卡片和全局 ModeSwitcher 只负责导航，不创建、恢复或重分类 Session。
- Draft 路由以 `DraftTab.mode` 为权威；Session 路由以 durable `Session.mode` 为权威。
- Home 的最近 Mode 仅作为展示默认值。
- ServerSync 按 `(directory, mode)` 发起服务端过滤查询，并合并到统一 Session 实体集。
- Product Mode 是封闭领域，不支持前端任意字符串 Mode。当前封闭集合为四值；ADR-17 若获接受，只能通过 Schema/API/SDK/迁移同步增加固定 `custom`，不能由前端动态注册任意 Mode。

### 后续迭代

- Chat/Work/Assistant 模式的具体业务侧栏与右栏内容（当前使用共享占位 Surface）。
- Mode 专属空状态文案。

## 架构说明

### Mode Surface Registry

每个模式注册自己的`次级侧栏`和`右栏`组件，Layout 通过 `Dynamic` 注入渲染。新增一个模式只需：

1. `packages/schema/src/product-mode.ts` — 加一个字面量
2. 新建一个 Sidebar 组件 + 一个 RightPanel 组件
3. `packages/app/src/components/mode-surfaces.tsx` — 在 `MODE_SURFACES` 注册表中加一条记录

**不需要改**的文件：Layout 骨架、ModeSwitcher 循环、Home 页面过滤、次级侧栏渲染、右栏渲染。

### 注册表结构

```ts
// packages/app/src/components/mode-surfaces.tsx
type ModeSurface = {
  Sidebar: Component     // 次级侧栏内容
  RightPanel: Component  // 右栏内容
}

export const MODE_SURFACES: Record<Mode, ModeSurface>
```

### 布局复用

```
┌────┬──────────────────┬───────────────────────┬─────────────────┐
│  左│  次级侧栏          │  Main 区域              │  右栏             │
│  侧│  ┌─────────────┐  │                        │                  │
│  栏│  │ 新建 + 搜索   │  │  (统一的消息流/会话内容)  │  (上下文面板)     │
│  │  ├─────────────┤  │                        │                  │
│  N │  · Coding      │  │  所有模式共享同一套        │  · Coding:      │
│  a │  → 项目树+会话  │  │  Session 结构             │  review/file    │
│  v │  · Chat        │  │                        │  · Chat:        │
│  │  → 占位(功能列表) │  │                        │  → 占位          │
│  B │  · Work        │  │                        │  · Work:        │
│  a │  → 占位(工作流)  │  │                        │  → 占位          │
│  a │  → 占位        │  │                        │                  │
│  r │  · Assistant   │  │                        │                  │
│    │  → 占位        │  │                        │                  │
│    └──────────────────┘                        │                  │
└────┴──────────────────┴───────────────────────┴─────────────────┘
```

### 数据流

```
ModeSwitcher / HomeModeCards
  -> navigate(`/mode/${target}`)
  -> ModeRoute 校验参数并单向同步 currentMode
  -> Home 会话列表按 mode 发起服务端过滤查询
  -> 有匹配 session → 显示列表
  -> 无匹配 session → 空状态 + 新建按钮

New Session
  -> tabs.newDraft({ ..., mode: currentMode })  ← DraftTab 冻结 mode
  -> submit.ts 读取 DraftTab.mode
  -> POST /session { mode }
  -> session.mode 持久化
```

### 关键文件

| 文件 | 职责 |
|------|------|
| `packages/schema/src/product-mode.ts` | ProductMode 字面量 Schema |
| `packages/schema/src/session.ts` | Session.Info 新增 mode（withDecodingDefaultKey） |
| `packages/core/src/v1/session.ts` | V1 SessionInfo 新增 mode（可选，旧事件兼容） |
| `packages/core/src/session/sql.ts` | SessionTable 新增 mode 列 + 索引 |
| `packages/aigcfroge/src/session/session.ts` | CreateInput/ListInput/Interface/fork 继承 mode |
| `packages/app/src/context/mode.tsx` | ModeContext: 删 activeSessionId，保留 currentMode |
| `packages/app/src/context/tabs.tsx` | DraftTab 新增 mode |
| `packages/app/src/pages/home.tsx` | Mode 卡片导航 + Mode scoped Session 查询 |
| `packages/app/src/components/secondary-sidebar.tsx` | 非 Coding mode 显示占位 |
| `packages/app/src/pages/session/session-side-panel.tsx` | 非 Coding mode 显示占位 |
| `packages/app/src/components/prompt-input/submit.ts` | session.create 传入 DraftTab.mode |

---

## ADR-15 实施：ModeWorkspace 主区 typed slot（C 方案）

> 状态：Proposed（待 owner 评审，见 [ADR-15](../architecture/adr/ADR-15-mode-workspace-main-area-slot.md)）
> 背景：ADR-12 §3 主区="Mode-scoped Session lists"与 ADR-13 Chat 核心对象=资产存在张力；现状 ModeRoute redirect 回 `/` + Home 自绘伪四区 + `<Dynamic>` remount 导致切换闪烁。本章节为 ADR-15 的实施计划，ADR-11/12 既有实现（上文）保留作历史。

### 实施步骤

| # | 改动 | 文件 | 性质 |
|---|---|---|---|
| 1 | ModeRoute 改成渲染共享 ModeWorkspace（不 redirect）；**`setCurrentMode` 迁入 `createEffect`**（现状 app.tsx:541 在组件 body，靠 redirect 重挂才触发；不 redirect 后 body 仅首挂跑，URL 变 mode 不更新 -> slot 错位，功能坏），对齐 app.tsx:201 Draft 路由范式 | `packages/app/src/app.tsx` ModeRoute | 根因修复，治闪烁 + 修 URL/slot 错位 |
| 2 | `/` 重定向到 `/mode/<persistedMode>`，单一渲染入口 | `packages/app/src/app.tsx` Routes | ADR-12 §4 one-way |
| 3 | ModeSwitcher 保持 `navigate(/mode/:mode)` | `packages/app/src/components/mode-switcher.tsx` | 已符合 ADR-12，无需改 |
| 4 | slot 切换不 remount：**禁用** `<Dynamic>`/`<Switch>`-`<Match>`/非 keyed `<Show>`（三者切换均 remount，见 ADR-15 §4 solid-js@1.9.10 实证）；改用 ADR-15 §4 两方案之一--render-all+display:none（CSS toggle）或上提 createResource 到 ModeWorkspace 级 provider（推荐） | `home.tsx`、`secondary-sidebar.tsx`、`session-side-panel.tsx`、`mode-surfaces.tsx` | 治 slot remount 闪烁 |
| 5 | 删 Home 伪四区（HomeModeCards / HomeProjectColumn / Dynamic Sidebar），内容并入 ModeWorkspace；Chat 主区=资产工作台 | `packages/app/src/pages/home.tsx`、`mode-surfaces.tsx` | 消除重复实例 + 落地 Y |
| 6 | secondary-sidebar-route `/mode/*` 返回 true（已是现状 no-op；ModeRoute 不 redirect 后自动生效，确认即可） | `packages/app/src/utils/secondary-sidebar-route.ts` | 首页显示 SecondarySidebar |
| 7 | sessionLoad queryKey 去掉 `mode.currentMode`（home.tsx:186）**且 `loadSessions` 调用去掉 `mode` 入参**（home.tsx:190，服务端拉全量）；客户端 records memo（home.tsx:210-221）按 mode 过滤即可。消除切模式会话列表 skeleton 闪烁（与 remount 独立的第二闪烁源）。注：directory 级 store 跨 mode 累积（server-sync.tsx loadSessions 写入 directory 级 store），去 mode 后不空表 | `packages/app/src/pages/home.tsx` | 治 queryKey skeleton 闪烁 |

### 布局（ADR-15 后）

```
┌────┬──────────────┬─────────────────────────┬─────────────────┐
│ M  │ SecondarySide │ Main = typed slot       │ 右栏 slot        │
│ o  │ bar (共享)    │  Chat: 资产工作台       │  Chat: 资产树/   │
│ d  │  - 项目导航   │  Coding: 会话列表       │   预览（§9.2）   │
│ e  │  - (Chat 功能 │  Work: 工作流(未来)     │  Coding: review │
│ S  │   树降级于此) │  Assistant: 记忆(未来)  │   /file         │
└────┴──────────────┴─────────────────────────┴─────────────────┘
  共享外壳              主区=模式核心对象(slot)    右栏(slot)
  ModeSwitcher/StatusBar 全模式共享；会话↔资产不落库(ADR-14 §4)
```

### 关键变更点（相对 ADR-11/12 既有实现）

- **主区**：ADR-12"共享 Session lists" -> ADR-15"typed slot"（Chat=资产工作台）。Session lists 降为共享能力，Chat 下会话降为次级视图。
- **slot 注入**：**禁用** `Dynamic`/`Switch`-`Match`/非 keyed `Show`（切换均 remount，见 ADR-15 §4）；改用 render-all+display:none（CSS toggle）或上提 createResource 到 ModeWorkspace 级 provider（推荐，避免 4× eager 拉取）。
- **ModeRoute**：redirect `/` -> 渲染 ModeWorkspace（同路由组件参数变不 remount）。
- **会话↔资产**：不落库（ADR-14 §4），资产真源=registry+文件。

### 实施前置项（App owner P1，进代码前补齐）

- **A1 per-slot 重构估算**：Coding 会话列表从 Home 自绘抽为 slot（sessionLoad/records/groups 数据流迁移）；资产工作台 home 版 vs session 右栏版组件复用边界（§9.5 仅说复用资产 tab，tree/edit/new 按钮是否复用需定）。
- **A4 i18n parity 扩 key**：parity.test.ts 当前仅查 2 key，promptAsset/assetWorkbench key 16 locale fallback en（M1 债务）。扩 parity.test.ts 覆盖 `assetWorkbench.*`/`promptAsset.*` 全 18 locale，否则 §15.1 A4 PASS 为虚。
- **A5 窄屏重设计**：chat-right-panel.tsx:65 硬编码 768px（TODO D6），主区移到资产工作台后窄屏行为变化（主区窄屏全宽，非右栏抽屉）；去硬编码，引用 v2 断点 token（DESIGN.md §Tokens 禁硬编码）。

### 验收

- 模式切换无闪烁（ModeWorkspace 不 remount + slot 不 remount + queryKey 去 mode）。
- `/mode/chat` 可分享、刷新保留（URL 自带模式）。
- Chat 首页主区=资产工作台，会话降为次级，外壳与 Coding 一致。
- typecheck/test 受影响包通过（不从仓库根执行）。
