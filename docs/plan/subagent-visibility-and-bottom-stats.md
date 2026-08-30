# 子智能体操作可见性 & 底部统计入口方案

> **状态**: v1 — 草稿，待审批
> **作者**: 高级产品总监
> **日期**: 2026-07-10
> **范围**: app UI 增强 — 子 agent 操作的 timeline 内联可视化 + 全局底部统计入口
> **关联文档**: [meta-agent-v2-production-closure.md](meta-agent-v2-production-closure.md) · [meta-agent-orchestrator.md](meta-agent-orchestrator.md) · [../../CLAUDE.md](../../CLAUDE.md) · [../../AGENTS.md](../../AGENTS.md) · [../../DESIGN.md](../../DESIGN.md) · [../../../packages/app/src/pages/session/timeline/message-timeline.tsx](../../../packages/app/src/pages/session/timeline/message-timeline.tsx) · [../../../packages/session-ui/src/components/message-part.tsx](../../../packages/session-ui/src/components/message-part.tsx) · [../../../packages/app/src/components/session/session-context-tab.tsx](../../../packages/app/src/components/session/session-context-tab.tsx) · [../../../packages/app/src/pages/layout.tsx](../../../packages/app/src/pages/layout.tsx)

---

## 0. 文档定位

本文档是 **子智能体操作可见性 + 底部统计入口** 两个功能的执行方案。

### 设计决策记录

以下方案在讨论中被否决或推迟，记录决策原因供查阅：

| 方案                             | 状态    | 原因                                                                   |
| -------------------------------- | ------- | ---------------------------------------------------------------------- |
| 底部 Panel（多 Tab、可拖拽缩放） | ❌ 否决 | 引入新布局范式，实现成本高；信息量不支撑独立 Panel                     |
| Secondary Sidebar Agent Tab      | ❌ 否决 | 264px 宽度不够展示 agent 工具树；仅在 session 页可见，不满足全局需求   |
| Home 页 Agent Activity 栏目      | ⏸ 推迟 | 跨 session 概览场景确认有真实需求，但当前 session 级内联体验优先级更高 |
| 设置页开关                       | ❌ 否决 | 不是性能敏感型功能；用户通过展开/折叠自然控制信息密度                  |

### 真实需求验证（苏格拉底追问摘要）

**Q**: 用户什么时候需要看子 agent 操作？
**A**: 偶发场景——assistant 回复出错或与预期不符时，需要回溯"build agent 当时到底做了什么"。

**Q**: 统计数字用户会频繁看吗？
**A**: 不会。纯展示性数字（token、工具数）用户看 1-2 次后即习惯化。真正的用户决策不需要这些数字，需要的是**在上下文连贯的位置看到子 agent 的变更内容**。

**→ 核心结论**: 子 agent 操作内联在 timeline 中（不跳转、不切 tab），底部只作为入口跳转到已有的 Context Tab。

---

## 1. 现状基线

### 1.1 已有能力（直接使用）

| 能力                    | 位置                                                                                                          | 状态                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| task tool 卡片渲染      | [message-part.tsx:1797-1879](../../../packages/session-ui/src/components/message-part.tsx#L1797)              | ✅ 已有 `ToolRegistry.register("task")` 渲染器        |
| 子 session 链接导航     | [message-part.tsx:1822-1832](../../../packages/session-ui/src/components/message-part.tsx#L1822)              | ✅ `sessionLink()` → 点击 ↗ 跳转到子 session         |
| 父子 session breadcrumb | [message-timeline.tsx:1326-1342](../../../packages/app/src/pages/session/timeline/message-timeline.tsx#L1326) | ✅ parentID → 父/子路径导航                           |
| 子 session 标题推断     | [message-timeline.tsx:325-339](../../../packages/app/src/pages/session/timeline/message-timeline.tsx#L325)    | ✅ `childTaskDescription` → 从父消息的 task tool 提取 |
| 上下文 Context Tab      | [session-context-tab.tsx](../../../packages/app/src/components/session/session-context-tab.tsx)               | ✅ Token 统计、工具分面、缓存诊断                     |
| 底部 StatusBar          | [layout.tsx:43](../../../packages/app/src/pages/layout.tsx#L43)                                               | ✅ 已有 StatusBar 组件                                |
| Context 入口按钮        | [session-context-usage.tsx](../../../packages/app/src/components/session-context-usage.tsx)                   | ✅ timeline 头部进度圈按钮 → 打开 context Tab         |

### 1.2 缺失（本方案补齐）

| 缺口                                        | 位置                                                                                             | 说明                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| ⚠️ task tool 卡片只显示 agent 名 + 导航箭头 | [message-part.tsx:1844-1865](../../../packages/session-ui/src/components/message-part.tsx#L1844) | 展开后无子 agent 工具操作摘要                       |
| ❌ 子 session 操作摘要不返回父 session      | N/A                                                                                              | `SessionV2` 缺少"返回子 session 的工具调用摘要"接口 |
| ❌ 底部统计入口条                           | N/A                                                                                              | 无轻量全局统计入口                                  |
| ❌ Context Tab 锚点定位                     | N/A                                                                                              | 无法从外部跳转到 context Tab 的具体位置             |

---

## 2. 目标架构

```
session timeline（用户在同一上下文中）
  └─ assistant turn
       └─ task tool part（现为 agent 名卡片 + ↗ 箭头）
            └─ [▼ 展开] → 子 agent 工具操作摘要     ← Phase 1
                 ├─ 📄 read   auth.ts      (120行)
                 ├─ 🔎 grep  "password"    3 matches
                 ├─ ✏️ edit  login.tsx      (+45/-12)
                 └─ ⚡ 34s · completed    [↗ 完整会话]

底部区域
  ├─ [📊 3.4k tok · 🔧 12 tools · 💰 $0.02 —— 查看详情 →]  ← Phase 2 (26px 入口条)
  └─ StatusBar（不变）
                                          ↓ 点击
context Tab（session-context-tab.tsx）
  ├─ Token / 使用率统计（已有）
  ├─ 工具活动分面（已有）
  └─ 缓存诊断（已有）
```

### 数据流

```
parent timeline
  └─ task tool part (已知 childSessionID)
       ├─ ▼ 展开 → 调用 SessionV2.toolSummary(childSessionID)
       │              → SessionV2.messages(childSessionID)
       │              → 提取 AssistantMessage.content 中的 AssistantTool
       │              → 聚合为 ToolSummary.Summary
       │              → 渲染子 agent 工具列表
       └─ ↗ 跳转 → 打开子 session 页面（已有交互）

EventV2 session.next.*
  → 实时 token / 工具 / cost 变化
    → 底部统计条更新
      → 点击 → tabs.open("context")
```

---

## 3. 分阶段实施

### Phase 1 — Task Tool 卡片内联展开子 agent 操作（4-5 天）

**目标**: 在 parent session 的 timeline 中，点击 task tool 卡片展开后直接看到子 agent 执行了什么工具，无需跳转子 session。

#### P1.1 后端：子 session 工具摘要 API（1.5 天）

| 动作                                                  | 文件                                                                                                                                                            | 说明                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 新增 `SessionV2.toolSummary(sessionID)` 接口          | [packages/core/src/session.ts](../../../packages/core/src/session.ts)                                                                                           | 返回**子 session** 的工具调用摘要（`sessionID` 为子 session ID）                    |
| 实现：读子 session 的 assistant 消息 → 提取 tool 调用 | [packages/core/src/session/tool-summary.ts](../../../packages/core/src/session/tool-summary.ts)                                                                 | 遍历 `SessionMessage.Assistant.content` 中的 `AssistantTool`，按工具名+文件路径聚合 |
| 暴露 HTTP API endpoint                                | [packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts](../../../packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts) | 新增 `/api/sessions/{sessionID}/tool-summary`（路径与命名按现有 route 风格）        |
| 重新生成 JS SDK                                       | [packages/sdk/js/script/build.ts](../../../packages/sdk/js/script/build.ts)                                                                                     | 使 `client.session.toolSummary(...)` 可用                                           |
| 返回结构                                              | `ToolSummary.Summary`                                                                                                                                           | 按工具名+文件路径去重聚合                                                           |

**Schema**:

```typescript
export class Entry extends Schema.Class<Entry>("ToolSummary.Entry")({
  tool: Schema.String, // "read" | "edit" | "grep" | "bash" | ...
  file: Schema.String.pipe(Schema.optional), // 操作的文件路径（如果有）
  count: Schema.Int.pipe(Schema.positive()), // 该工具调用次数
  duration: Schema.Int.pipe(Schema.optional), // 总耗时 ms
  status: Schema.Literals("completed", "failed", "running"),
}) {}

export class Summary extends Schema.Class<Summary>("ToolSummary.Summary")({
  agent: Schema.String, // 子 agent 名称 (build/explore/...)
  engine: Schema.Literals("subagent", "external-cli"),
  tools: Schema.Array(Entry),
  totalDuration: Schema.Int,
  totalTokens: Schema.Int.pipe(Schema.optional),
}) {}
```

**协议约束**:

- `Effect.fn("SessionV2.toolSummary")` — Effect 命名 + gen
- `export * as ToolSummary from "./tool-summary"` — 自导出模式
- 禁 `Effect.fork`，用 `Effect.forkIn(scope)`

#### P1.2 前端：task tool 渲染器扩展（2.5-3 天）

| 动作                                         | 文件                                                                                             | 说明                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 扩展 `ToolRegistry.register("task")` 渲染器  | [message-part.tsx:1797-1879](../../../packages/session-ui/src/components/message-part.tsx#L1797) | 在 BasicTool 内新增展开内容区，保留已有 ↗ 跳转导航                                |
| 调用 `SessionV2.toolSummary(childSessionID)` | 在 task tool 渲染器内部                                                                          | 按需拉取子 session 的工具摘要；若子 session 消息已在本地同步，也可降级为客户端计算 |
| 缓存摘要                                     | 组件内 `createMemo` / `createResource`                                                           | 避免重复请求同一子 session                                                         |
| 展开状态管理                                 | 同上                                                                                             | 复用已有的 `controlledOpen` / `defaultOpen` 模式                                   |
| 渲染子 agent 工具操作列表                    | 同上                                                                                             | 每个 tool 一行：icon + 文件名 + 操作 + 耗时                                        |
| 保留子 session 跳转交互                      | 同上                                                                                             | ↗ 图标独立于 ▼ 展开，两者共存不互斥                                               |
| 新图标                                       | [packages/ui/src/v2/components/icon.tsx](../../../packages/ui/src/v2/components/icon.tsx)        | 按需添加 read/edit/grep/bash 等工具图标                                            |

**UI 设计**:

```
  🤖 build    添加登录功能    [▼]    [↗]
  │                               ↑↗ 跳转到子 session 完整对话（保留现有交互）
  ├─ 📄 read         auth.ts                       120行
  ├─ 🔎 grep        "password"                     3 matches
  ├─ ✏️ edit        login.tsx                      +45/-12
  ├─ ⚡ 总计        3 tools · 34s · 1,234 tok
```

**关键交互原则**: 两个手势**共存**，不互斥：

- **▼ 展开/折叠**（箭头图标）→ 在当前 timeline 内联展示子 agent 操作摘要，用户不离开上下文
- **↗ 完整会话**（外链图标）→ 跳转到子 session 页面，查看完整对话——这是已有的交互（当前 `task-tool-card` 的 ↗ 箭头），**保留不变**
- 两者功能解耦：折叠态只展示图标不展开详情；展开态展示摘要但仍保留 ↗ 跳转入口

设计原则（[DESIGN.md](../../../DESIGN.md) §Product Character）:

- 安静、密集、操作性 UI
- 不使用装饰性卡片、渐变/orb 背景
- 通过 `data-component`、`data-variant`、`data-state` 属性选择器控制样式
- 所有颜色引用 `--v2-*` token

**协议约束**:

- 新组件默认使用 v2 token（`--v2-*`）
- 交互文字走 i18n 系统（`useI18n().t()`）
- 无全局开关（用户通过展开/折叠控制）

#### P1.3 测试（1-1.5 天）

> **执行顺序**：先写测试 → 再写实现 → 最后跑通测试。测试文件与实现文件同 PR 提交。

| 测试                           | 包                    | 类型                               | 说明                                                                                             |
| ------------------------------ | --------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `tool-summary.test.ts`         | `packages/core`       | `testEffect()` + 模拟消息          | 纯函数 `summarizeTools(messages)` 的单元测试，覆盖工具归类、聚合、状态、空集                     |
| `session-tool-summary.test.ts` | `packages/core`       | `testEffect()` + `Layer.mock`      | `SessionV2.toolSummary(sessionID)` 的 Effect 集成测试，覆盖命中/缺失 session、子消息解码失败兜底 |
| `message-part-task.test.tsx`   | `packages/session-ui` | `bun test` + happy-dom             | task tool 渲染器扩展测试：有摘要时展示展开区、空摘要不展示、展开/折叠、↗ 跳转按钮独立存在       |
| i18n 类型检查                  | `packages/app`        | `bun --cwd packages/app typecheck` | 所有非 en 字典使用 `type Keys = keyof typeof en`，新增 key 必须同步到所有语言，类型检查即保障    |

**测试细节**

- **后端纯函数优先**：将摘要逻辑拆成不依赖 Effect 的纯函数（例如 `ToolSummary.fromMessages(messages: SessionMessage.Message[])`），优先用普通 `test()` 覆盖；外层 `SessionV2.toolSummary` 只做 IO 编排，用 `testEffect()` 覆盖。
- **Schema 负测试**：用 `@ts-expect-error` 验证 `ToolSummaryEntry` 的必填字段（`tool`、`count`、`status`），确保类型约束。
- **状态覆盖**：至少包含一个子 session 中某个工具处于 `failed` / `running` 的用例，验证状态颜色/图标映射。
- **UI 测试不等待并发**：渲染测试使用 solid-js 同步渲染 + `fireEvent`，禁止 `Effect.sleep` 或 `setTimeout` 等待。
- **测试数据工厂**：在 `packages/core/test/fixture/tool-summary.ts` 新建工厂函数 `assistantWithTools(toolCalls[])`，供后端与前端测试复用。

#### Phase 1 验收清单

- [ ] ▼ 展开后可见子 agent 的工具调用摘要；↗ 跳转独立存在，两者不互斥
- [ ] 每条工具调用展示: icon + 名称 + 文件路径 + 关键参数（如 grep pattern）
- [ ] 汇总行显示：工具总数、耗时、token（若有）
- [ ] ↗ 跳转子 session 页面的交互保留不变（与展开解耦）
- [ ] 子 session 无操作时（空摘要）不显示展开区
- [ ] 折叠态完全不展示子 agent 信息（不影响 timeline 紧凑性）
- [ ] 支持 dark/light 主题
- [ ] `bun run lint` + `bun --cwd packages/app typecheck` + `bun --cwd packages/session-ui typecheck` 零错误
- [ ] `bun --cwd packages/core test --timeout 30000` 通过（含 `session-tool-summary.test.ts`）
- [ ] `bun --cwd packages/session-ui test` 通过（含 `message-part-task.test.tsx`）

---

### Phase 2 — 底部统计入口条（2-3 天）

**目标**: 在 main content 底部、StatusBar 上方添加一条 26px 的轻量统计条，展示全局 Token/工具/成本概览，点击跳转到 Context Tab 详情。

#### P2.1 新建 BottomBar 组件（1.5 天）

| 动作                  | 文件                                                                                     | 说明                                                         |
| --------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 新建 `BottomBar` 组件 | [packages/app/src/components/bottom-bar.tsx](../../../packages/app/src/components/) 新建 | 26px 固定高度                                                |
| 读取 token / cost     | 复用 `getSessionContextMetrics()`                                                        | 现有函数，返回最新 assistant 的 token 与总成本               |
| 读取 tool count       | 新增 `toolCountFromParts(allParts)`                                                      | 统计所有 assistant message 中 `type === "tool"` 的 part 数量 |
| 显示内容              | `📊 {tokens} · 🔧 {tools} · 💰 {cost}`                                                   | 三个主要 KPI                                                 |
| 跳转逻辑              | `tabs.open("context")` + `view().setScroll("context", ...)`                              | 复用 `SessionContextUsage.openContext()` 模式                |
| 动画                  | 统计数字变化时淡入                                                                       | `motion` 动画（与 timeline 一致）                            |

**UI 设计**:

```
├──────────────────────────────────────────────────────────────┤
│ 📊 3.4k tok  ·  🔧 12 tools  ·  💰 $0.02       [查看详情 →] │ ← 26px
├──────────────────────────────────────────────────────────────┤
│ [chat] [coding] [work] [assistant]               v1.0.0    │
```

**交互**:

- 整行可点击 → 跳转到 Context Tab
- 数字变化时缓动动画（非闪烁）
- 无 session 时（home 页）不显示
- 小屏 < 768px 隐藏

#### P2.2 插入布局（0.5 天）

| 动作        | 文件                                                               | 说明                                       |
| ----------- | ------------------------------------------------------------------ | ------------------------------------------ |
| 修改 layout | [layout.tsx:35-47](../../../packages/app/src/pages/layout.tsx#L35) | 在 main 下方、StatusBar 上方插入 BottomBar |
| 显隐控制    | 同上                                                               | `isHome()` 时隐藏                          |

```tsx
// layout.tsx 修改
<Show when={!isHome() && !isNewSession()}>
  <BottomBar />
</Show>
<StatusBar source={statusSource} />
```

#### P2.3 Context Tab 跳转（0.5 天）

> **决策**：锚点定位（按 section scrollIntoView）被推迟。底部 bar 点击只负责打开 Context Tab 并切到 active；用户进入 Tab 后自然看到最上方的 Token/工具统计。如后续有强需求再引入 anchor 定位。

| 动作         | 文件                                                                                        | 说明                                                                                |
| ------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 复用打开逻辑 | [session-context-usage.tsx](../../../packages/app/src/components/session-context-usage.tsx) | 抽出 `openSessionContext(view, layout, tabs)` 为共享纯函数，底部 bar 与头部按钮共用 |
| 无锚点参数   | —                                                                                           | 第一版不做 `data-anchor` 与 `scrollIntoView`，点击后 Context Tab 自然展示顶部统计区 |

#### P2.4 测试（0.5-1 天）

| 测试                           | 包             | 类型                   | 说明                                                                                              |
| ------------------------------ | -------------- | ---------------------- | ------------------------------------------------------------------------------------------------- |
| `bottom-bar.test.tsx`          | `packages/app` | `bun test` + happy-dom | 验证 session 页渲染、home/new-session 页隐藏、点击调用 `openSessionContext`、小屏隐藏、数字格式化 |
| `bottom-bar-metrics.test.ts`   | `packages/app` | 普通单元测试           | 验证 `toolCountFromParts(allParts)` 计数逻辑与 `getSessionContextMetrics` 的指标组合              |
| `session-context-tab.test.tsx` | `packages/app` | `bun test` + happy-dom | 验证从外部打开 Context Tab 后显示正确 section                                                     |

**测试细节**

- 用 `createRoot` + `render` 渲染 `BottomBar`，mock `useLocation`、`useSync`、`useProviders`、`useSessionLayout` 等依赖，或包一层轻量 Provider。
- 小屏隐藏用 `window.matchMedia` mock 或检查 Tailwind 类名 `hidden md:flex`。
- 数字动画不纳入单元测试，通过 Storybook 手动验证；添加 `BottomBar` 的 story 到 `packages/storybook`。

#### Phase 2 验收清单

- [ ] session 页底部可见 26px 统计条
- [ ] home 页 / new-session 页不显示
- [ ] Token / Tool / Cost 三个指标正确读取
- [ ] 点击跳转到 context Tab
- [ ] 小屏 < 768px 隐藏
- [ ] 数字变化有缓动动画（非闪烁）
- [ ] `bun --cwd packages/app typecheck` 通过
- [ ] `bun --cwd packages/app test:unit` 通过（含 `bottom-bar.test.tsx`、`bottom-bar-metrics.test.ts`）
- [ ] CSS 使用 `--v2-*` token，验证 dark/light 主题

---

## 4. 文件变更清单

### 修改文件

| 文件                                                                                                                                | Phase | 改动                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------- |
| [packages/session-ui/src/components/message-part.tsx](../../../packages/session-ui/src/components/message-part.tsx)                 | P1    | `ToolRegistry.register("task")` 扩展：子 agent 工具列表展开 |
| [packages/app/src/pages/layout.tsx](../../../packages/app/src/pages/layout.tsx)                                                     | P2    | 主内容与 StatusBar 间插入 `BottomBar`                       |
| [packages/app/src/components/session/session-context-tab.tsx](../../../packages/app/src/components/session/session-context-tab.tsx) | P2    | 支持从底部 bar 外部打开并显示（无需新增 anchor 定位）       |
| [packages/core/src/session.ts](../../../packages/core/src/session.ts)                                                               | P1    | 新增 `toolSummary(sessionID)` 接口                          |
| [packages/ui/src/v2/components/icon.tsx](../../../packages/ui/src/v2/components/icon.tsx)                                           | P1    | 按需新增工具图标（read/edit/grep/bash）                     |
| [packages/app/src/i18n/en.ts](../../../packages/app/src/i18n/en.ts)                                                                 | P1/P2 | 新增 i18n key（工具名称、统计标签）                         |

### 新建文件

| 文件                                                                                                          | Phase | 用途                             |
| ------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------- |
| [packages/app/src/components/bottom-bar.tsx](../../../packages/app/src/components/)                           | P2    | 底部统计入口条                   |
| [packages/core/src/session/tool-summary.ts](../../../packages/core/src/session/)                              | P1    | 子 session 工具摘要实现          |
| [packages/core/test/session-tool-summary.test.ts](../../../packages/core/test/)                               | P1    | `SessionV2.toolSummary` 集成测试 |
| [packages/core/test/fixture/tool-summary.ts](../../../packages/core/test/fixture/)                            | P1    | 工具摘要测试数据工厂             |
| [packages/session-ui/src/components/message-part-task.test.tsx](../../../packages/session-ui/src/components/) | P1    | task tool 渲染器扩展测试         |
| [packages/app/src/components/bottom-bar.test.tsx](../../../packages/app/src/components/)                      | P2    | 底部统计条渲染/交互测试          |
| [packages/app/src/components/bottom-bar-metrics.test.ts](../../../packages/app/src/components/)               | P2    | 底部条指标计算单元测试           |

---

## 5. 协议合规约束

| 协议            | 约束                                                                                                    | 适用        |
| --------------- | ------------------------------------------------------------------------------------------------------- | ----------- |
| **Effect 编码** | `Effect.fn("SessionV2.toolSummary")` + `Effect.gen` + `Effect.forkIn(scope)`                            | P1.1        |
| **模块组织**    | `export * as ToolSummary from "./tool-summary"`；禁 `export namespace`                                  | P1.1        |
| **Design**      | 新 UI 用 `--v2-*` token，`data-component` 选择器，禁硬编码色值                                          | P1.2/P2.1   |
| **i18n**        | 用户可见文案走 i18n，`useI18n().t("bottomBar.tokens")`                                                  | P1.2/P2.1   |
| **图标**        | 扩展 `packages/ui/src/v2/components/icon.tsx` 字典，不引入 npm 图标库                                   | P1.2        |
| **Schema**      | 多字段记录用 `Schema.Class<T>("Name")({...})`；错误用 `Schema.TaggedErrorClass`；ID 用 `Schema.brand`   | P1.1        |
| **测试**        | 先写测试后写实现；`testEffect()` + `Layer.mock`；UI 用 happy-dom；禁 `Effect.sleep` / `setTimeout` 等待 | P1.3 / P2.4 |
| **安全门禁**    | Catch Everything（工具摘要查无子 session 时兜底）+ No Null Pointer                                      | P1.1/P1.2   |
| **改完即审**    | 每次改动后 `git diff` + `bun run lint` + 受影响包 typecheck + test                                      | 全 Phase    |

---

## 6. 风险与回退

| 风险                                              | 概率 | 影响                 | 缓解                                                                                           |
| ------------------------------------------------- | ---- | -------------------- | ---------------------------------------------------------------------------------------------- |
| 子 session 工具调用过多导致 task 卡片渲染性能问题 | 低   | timeline 卡顿        | 限制展开区显示 top-10 工具，其余折叠为"N more"；列表使用 `<For>` 并避免每条工具创建独立 Effect |
| `toolSummary` 查询在 session 隧道场景下延迟       | 中   | 统计数字不更新       | 卡片展开时按需加载，非全局轮询；必要时用 `Effect.cached` 做 2s 缓存窗口                        |
| 底部统计条在超长 session 中数字溢出               | 低   | 布局偏移             | 数字用缩写（3.4k 而非 3,456），确保 `min-w-0`；token 用 `formatter().number`                   |
| P2 锚点定位实现复杂                               | 低   | context Tab 跳转不准 | 已决策：第一版不做锚点定位，只打开 Context Tab                                                 |
| `getSessionContextMetrics` 不返回 tool count      | 高   | 底部条工具数错误     | 新增 `toolCountFromParts(allParts)` 单独计算，并在 P2.4 测试覆盖                               |

---

## 7. 验收清单

### Phase 1 — 子 agent 操作可见性

- [ ] ▼ 展开后可见子 agent 的工具调用摘要；↗ 跳转独立存在，两者不互斥
- [ ] 每个工具调用显示 icon + 名称 + 文件路径 + 关键参数
- [ ] 汇总行显示：工具总数、总耗时、token（若有）
- [ ] ↗ 跳转子 session 页面的交互保留不变（与展开解耦）
- [ ] 无工具调用时展开区折叠（不展示空状态）
- [ ] 折叠态完全不展示子 agent 信息（不影响 timeline 紧凑性）
- [ ] dark/light 主题正确
- [ ] `bun run lint` + `bun --cwd packages/session-ui typecheck` + `bun --cwd packages/app typecheck` 通过
- [ ] `bun --cwd packages/core test --timeout 30000` 通过（含 `session-tool-summary.test.ts`）
- [ ] `bun --cwd packages/session-ui test` 通过（含 `message-part-task.test.tsx`）

### Phase 2 — 底部统计入口

- [ ] session 页底部可见 26px 统计条
- [ ] home 页 / new-session 页不显示
- [ ] Token / Tool / Cost 三个指标正确读取
- [ ] 点击跳转到 context Tab
- [ ] 小屏 < 768px 隐藏
- [ ] 数字变化有缓动动画（非闪烁）
- [ ] `bun --cwd packages/app typecheck` 通过
- [ ] `bun --cwd packages/app test:unit` 通过（含 `bottom-bar.test.tsx`、`bottom-bar-metrics.test.ts`）

> **审批通过后**: 从 Phase 1 开始执行（先 P1.1 后端接口，再 P1.2 前端渲染器扩展）。
> **分支**: `subagent-visibility`
> **预期工时**: Phase 1（4-5 天）+ Phase 2（2-3 天），总计 6-8 天。
