# Todo/Task 系统全面升级实施方案

> 状态：**M0-M7 已完成（2026-08-04）**，集成分支 `todo-task-m2`（M6 在 `todo-task-m6` 分支、M7 在 `todo-task-m7` 分支四步审批闭环）；交付明细见 `specs/v2/todo.md`，审批档案 `docs/review/`，其余延后项见 §8 延后总表
> 评审修复：**差分审查 5 HIGH + 3 MEDIUM + GATE + 二轮 2 HIGH + 5 MEDIUM 已逐项闭环**（2026-08-04，报告 `docs/review/AigcForge_DIFFERENTIAL_REVIEW_M2_M7_2026-08-03.md` + `AigcForge_DIFFERENTIAL_REREVIEW_M2_M7_2026-08-04.md`）——六态写回、原子单任务端点、调度中断恢复、scheduled-trigger 不变量、task_spawn 契约、跨 session 环、cron 性能/语义、Hub 快照语义、lint；明细与回归测试见 `specs/v2/todo.md`「评审修复记录」
> 日期：2026-07-31
> Owner：产品 + Core + App
> 范围：`packages/schema` + `packages/core` + `packages/aigcfroge` + `packages/app` + `packages/tui`
> 调研输入：[Accio/Xuanji 竞品反编译分析报告](../Accio竞品反编译分析报告.md) · Upstream OpenCode dev (e4bd9757a) fork 差异审计 · AigcForge 当前代码五层审计
> 交叉裁决：[Work PRD](../prd/work-mode-execution-layer.md)（Progress Ledger 与 Task 统一为同一模型，2026-07-31）

---

## 1. 三行摘要

- **做什么**：将 per-Session 的平面 Todo list 升级为支持子任务、Agent 归属、TaskDriver 联动的 Task 体系。补入 Accio 的任务衍生 (TaskSpawn) 和定时任务 (ScheduledJob) 能力。
- **为谁做**：覆盖五类 Product Mode（Chat / Coding / Work / Assistant / Meta-Agent）及未来自定义 Mode，以电商场景为垂直验证。
- **为什么现在做**：当前 `TodoWrite` 与 `TaskDriver` 完全隔离（task 完成不回写 todo），Accio 在 Agent Hub + 定时调度方面已领先——我们的 TaskDriver 底层能力已经很强，缺的是上层数据模型统一和用户可交互 UI。

---

## 2. 当前状态：五层审计

### 2.1 Schema 层

```
packages/core/src/session/todo.ts (内联，非共享包)
  Todo.Info = { content, status, priority }
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority: "high" | "medium" | "low"
  作用域: per-Session
  操作: UPDATE = DELETE ALL + INSERT ALL (全量替换)
```

**缺口**：

- **无 `id`**：全链路无稳定 identity——`TodoTable` 主键为 `(session_id, position)`（`packages/core/src/session/sql.ts:104-121`），SDK 类型仅三字段（`packages/sdk/js/src/v2/gen/types.gen.ts:665-675`）。**这还带出一个现存 bug**：App 端 `server-sync.tsx:202`、`directory-sync.ts:537,545`、`event-reducer.ts:178` 均以 `key:"id"` 做 solid-js `reconcile`，条目无 id 时 key 全为 `undefined`，reconcile diff 实际失效。
- **status/priority 无字面量约束**：现状是普通 `Schema.String`（`todo.ts:12-15`），合法值仅存在于 description 注解，LLM 可写任意字符串。新 `TaskInfo` 用 `Schema.Literal` 恰是升级点。
- **无 `parentID`**（不支持子任务）、**无 `agentID`**（不支持 Agent 归属）、**无 `scheduledAt`**（不支持定时）。

### 2.2 Core 层

```
packages/core/src/session/todo.ts           SessionTodo Service
packages/core/src/tool/todowrite.ts         TodoWrite Tool (LLM-facing)
packages/core/src/tool/task-driver.ts       TaskDriver (fork 独有, 490行)
packages/core/src/session/task-driver-fill.ts  SessionV2 ↔ TaskDriver 桥接
```

**TaskDriver 四模式**（fork 独有创新，构建流中不存在）：

| 模式       | 方法                   | 行为                           |
| ---------- | ---------------------- | ------------------------------ |
| Foreground | `delegate()`           | 创建子会话→驱动→等待结果→返回  |
| Background | `delegateBackground()` | 创建子会话→后台驱动→注入父会话 |
| Judge      | `delegateJudge()`      | N 子会话并行→Judge LLM 合并    |
| Extend     | `extendBackground()`   | 向运行中后台任务追加 prompt    |

**核心断裂**：TaskDriver 创建的子会话完成后，不回写父会话 Todo。用户看到 "task 跑完了但 todo 还显示 in_progress"。

### 2.3 AigcForge 层（V1 兼容）

```
packages/aigcfroge/src/session/todo.ts      V1 SessionTodo（独立实现，等价逻辑）
packages/aigcfroge/src/tool/todo.ts         V1 TodoWrite Tool
packages/aigcfroge/src/tool/todowrite.txt   LLM Guidance (~50 行)
```

V1/V2 双轨，V1 退役时自然消亡。

### 2.4 App UI 层

```
packages/app/src/pages/session/composer/session-todo-dock.tsx  底部折叠 Dock
packages/app/src/context/server-sync.tsx                       todo 同步缓存
packages/app/src/context/directory-sync.ts                     todo 拉取
```

- 只读 CheckboxV2 列表 + strikethrough + scroll fade
- **用户不可交互**（不能勾选/添加/编辑/删除/排序）
- `sessionID` prop（我们 fork 加的，上游没有）

### 2.5 TUI 层

```
packages/tui/src/component/todo-item.tsx    [✓]/[•]/[ ] 字符渲染
packages/tui/src/feature-plugins/sidebar/todo.tsx  侧栏插件 (>2项可折叠, 全completed自动隐藏)
```

---

## 3. Accio/Xuanji 借鉴摘要

> 完整反编译分析见 [Accio 竞品反编译分析报告](../Accio竞品反编译分析报告.md)，此处仅列与本方案直接相关的核心借鉴项。

### 3.1 值得借鉴的核心能力

| #      | 能力                          | 实现要点                                                                                                                                                                          | 优先级                 |
| ------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **A1** | **任务衍生 (Task Spawn)**     | 对话 → 自动创建新 Agent。"任务衍生" tab                                                                                                                                           | **P0**                 |
| **A2** | **定时任务 (Scheduled Jobs)** | per-Agent cron 调度。~~删除 Agent 时提示 "将同时删除 N 个会话 + N 个定时任务"~~（2026-08-03 裁决：**删除 Agent 整体移出 M4**，留待独立 agent 管理立项，删除语义见 §5.7 保留裁决） | **P0**                 |
| **A3** | **Agent Hub**                 | 三区：我的智能体 + 任务衍生 + 新建                                                                                                                                                | **P1**                 |
| **A4** | **Board Home 任务入口**       | "描述你的任务，开始在隔离环境中会话"                                                                                                                                              | **P1**                 |
| **A5** | **Skill per-Agent 安装**      | `agent-skill-manager`，官方 + 个人 Skills                                                                                                                                         | **P2**                 |
| **A6** | **多平台消息通道**            | WeChat/WeCom/Telegram/Lark 四通道                                                                                                                                                 | **P3**（非本方案范围） |

### 3.2 关键对标

| Accio 概念                              | AigcForge 映射                             | 行动                         |
| --------------------------------------- | ------------------------------------------ | ---------------------------- |
| Agent = 对话 + 定时任务 + Skills 的容器 | Session 是对话容器，Agent 是轻量角色       | 让 Agent 拥有 Task 所有权    |
| Task Spawn（群聊→新 Agent）             | TaskDriver 创建子会话但不注册 Agent        | 完成后可选 "存为 Agent"      |
| Scheduled Jobs per Agent                | 不存在                                     | Core 自包含 cron scheduler   |
| Agent Hub 聚合视图                      | Chat 模式主区（资产工作台）+ 分散在各 Mode | Chat 模式增加 Agent 聚合 tab |

---

## 4. 上游 OpenCode fork 审计（修正版）

### 4.1 差异来源分解

对 `session-permission-dock.tsx` / `session-todo-dock.tsx` / `todo.ts` / `todowrite.ts` / `permission.tsx` 做了逐文件 diff + git blame，结论：

| 差异来源            | 文件                           | 内容                                                          | 性质                            |
| ------------------- | ------------------------------ | ------------------------------------------------------------- | ------------------------------- |
| **品牌替换**        | 全部                           | `@opencode-ai` → `@aigcfroge`                                 | fork 基础设施，预期内           |
| **`attended` 功能** | `session-permission-dock.tsx`  | `sessionID` prop + `isChildRequest` + subagent badge（15 行） | 元智能体 V2，commit `309b29f7a` |
| **CheckboxV2**      | `session-todo-dock.tsx`        | 上游用 `Checkbox` → 我们用 `CheckboxV2`                       | 品牌重构时期的 UI 升级          |
| **TaskDriver**      | `core/src/tool/task-driver.ts` | 490 行，四种委派模式                                          | fork 独有创新                   |

**上游自 fork 以来在 todo/permission 区域基本没变。** 不存在 "上游演进我们落后" 的情况。上游的 V1 task tool (`packages/opencode/src/tool/task.ts`) 是构建流的独立代码路径，与我们的 V2 TaskDriver 不是同一文件的分叉——二者是并行系统。

### 4.2 上游有而我们没有的（fork 时就存在的差距，非上游后来新增）

| #      | 内容                                                 | 优先级 | 说明                                                      |
| ------ | ---------------------------------------------------- | ------ | --------------------------------------------------------- |
| **U1** | `packages/schema/src/session-todo.ts` 共享 Schema 包 | **P0** | 上游将 Todo Schema 从 Core 分离为独立包，符合契约先行原则 |
| **U2** | `dot()` animated SVG（in_progress 脉冲指示器）       | **P1** | 低成本视觉差异化                                          |
| **U3** | E2E test (`session-todo-dock-navigation.spec.ts`)    | **P1** | 动画生命周期测试，我们完全缺失                            |
| **U4** | 自动隐藏（全 completed 后 dock 消失）                | **P2** | 上游有，我们无此逻辑                                      |
| **U5** | `newLayoutDesigns()` V2 设计开关                     | **P2** | 全应用 feature flag 系统，应整体移植                      |

### 4.3 构建流 V1 task tool（参考价值有限）

上游 `packages/opencode/src/tool/task.ts`（构建流，≈200 行）有以下特性我们的 V2 TaskDriver 未覆盖：

| 特性                                   | 是否移植  | 理由                                                                                                                                                                                           |
| -------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent-specific tool denies             | ✅ P1     | 子 Agent 权限继承 + deny list——V2 `createChild` 只传 `agent`+`attended`，确实缺失（V1 构建流 `aigcfroge/src/tool/task.ts:286-298` 有 `childToolDenies`）                                       |
| `subagent_depth` 嵌套限制              | ❌ 已覆盖 | V2 有更严防护：`core/src/tool/task.ts:131-137` 在子会话中**直接拒绝** task tool，嵌套深度钉死为 1（`isChildSession` 全禁）。**除非** M5 编排需放开嵌套，届时以 depth limit + deny 继承替代全禁 |
| `background` 参数显式切换              | ❌        | 我们的 `delegate`/`delegateBackground` 方法分离更清晰                                                                                                                                          |
| `onAbort` + `Effect.acquireUseRelease` | ❌        | 等价于我们的 `TaskDriver.cancel()`                                                                                                                                                             |

**注意**：该 task tool 属于构建流 V1 (`packages/opencode/`)，不在我们元智能体 V2 代码路径上。移植是指 "从 V1 构建流提取安全门禁逻辑回灌到 V2 TaskDriver"，不是 "合并两个文件"。

---

## 5. 升级架构设计

### 5.1 统一 Task 数据模型

```ts
// packages/schema/src/session-task.ts — 新增 Schema 文件 (共享包已存在)
// 注: @aigcfroge/schema 已存在 (41 文件, 含 product-mode.ts), 是新增文件而非新建包

export const TaskStatus = Schema.Literal("pending", "in_progress", "completed", "cancelled", "scheduled", "failed")

export const TaskPriority = Schema.Literal("high", "medium", "low")

export const TaskInfo = Schema.Struct({
  id: Schema.String, // 稳定 ID (新)
  content: Schema.String,
  status: TaskStatus,
  priority: TaskPriority,
  // ── 扩展字段 ──
  parentID: Schema.optional(Schema.String), // 子任务支持
  agentID: Schema.optional(Schema.String), // Agent 归属 (新)
  sessionID: Schema.String, // 保留 Session 作用域
  outputDigest: Schema.optional(Schema.String), // 步骤增量摘要 (M2 折入, TaskPanel 重载恢复持久化)
  scheduledAt: Schema.optional(Schema.Number), // 定时触发 (M3)
  recurrence: Schema.optional(
    Schema.Struct({
      // 重复规则 (M3)
      cron: Schema.String,
      timezone: Schema.optional(Schema.String),
      enabled: Schema.Boolean,
    }),
  ),
  spawnedFrom: Schema.optional(Schema.String), // 衍生来源消息 ID (M5)
  dependsOn: Schema.optional(
    Schema.Array(
      // 前置依赖 (M5)
      Schema.String,
    ),
  ),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}).annotate({ identifier: "TaskInfo" })
```

> **派生值声明**（不落存储，运行时计算）：`currentStepIndex` = 首个非 `completed` 步骤的索引；`canResume` = 存在 `failed`/`in_progress` 步骤。与 Work PRD §9.1 ProgressLedger 对齐（见 §6.2）。

### 5.2 字段分期策略

| 阶段                    | 引入字段                                                       | 理由                                                                                                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0**                  | `id`, `content`, `status`, `priority`, `parentID`, `sessionID` | 最小可行——`parentID` 低复杂度高价值，`id` 消除 API 不一致                                                                                                                                                                                   |
| **M2**（原 M1.5，折入） | `outputDigest`                                                 | 与 Work PRD §9.1 ProgressLedger 联动（步骤增量摘要）。M1 双轨回写已把 childSessionID 承载于 outputDigest（事件/返回值）；M2 TaskPanel 的重载恢复是其首个**持久化 UI 消费者**（刷新后跳转子会话链接不丢），故折入 M2 一并落列 + Service 落库 |
| **M3**                  | `agentID`, `scheduledAt`, `recurrence`                         | 与 ScheduledJobRunner 同时上线——不在 M0 引入未实现功能的字段                                                                                                                                                                                |
| **M5**                  | `dependsOn`, `spawnedFrom`                                     | DAG 依赖和衍生链路——跨模式集成阶段                                                                                                                                                                                                          |

**原则**（CLAUDE.md 极致减法）：每个字段跟着其消费者一起上线，不预留。`currentStepIndex`/`canResume` 不落存储，为派生值。

### 5.3 五层改造清单

```
Layer 1: Schema (packages/schema/src/session-task.ts)
  ✅ 新建 TaskInfo Schema (共享包, 借鉴 U1)
  ✅ 新建 TaskEvent (task.updated)
  ✅ 保留旧 Todo Schema (向后兼容, deprecated)

Layer 2: Core (packages/core/src/session/task.ts)
  ✅ 新建 SessionTask Service (替代 SessionTodo)
  ✅ 增量 CRUD (不再全量 DELETE+INSERT)
  ✅ TaskDriver ↔ Task 联动 (双轨 §5.4):
      ├─ 轨 A: task tool 新增 parent_task_id (显式关联)
      ├─ 轨 B: 委派自动建 in_progress todo (content=description), 子会话 settle 自动回写
      └─ 回写状态机: completed/failed(摘要入 outputDigest)/cancelled + childSessionID 可跳转
  ✅ Agent-specific tool denies 回灌 (子 Agent 权限继承 + deny list, 借鉴 V1 构建流 childToolDenies)
  ✅ 嵌套防护保持现状 (core/src/tool/task.ts:131-137 已全禁嵌套; 仅当 M5 编排需放开时改为 depth limit + deny 继承)
  ✅ 保留旧 TodoWrite (内部转发到 Task)
  ✅ 新增写 API: PATCH /session/:id/task (M1) + SDK gen + task.updated 事件 ← G1 补齐
      (现状仅 GET /session/{id}/todo, 无任何写 endpoint; 可交互 TaskPanel 必须的服务端路径)

Layer 3: Core 工具 (packages/core/src/tool/)
  ✅ 新建 TaskWrite Tool (LLM-facing, 注册进 builtins.ts 与 TodoWriteTool.layer 并列)
  ✅ task tool (core/src/tool/task.ts) 新增可选 parent_task_id 参数 + 轨 B 自动建 todo 逻辑 (M1 双轨 §5.4)
  ✅ 新建 task_schedule Tool (定时注册, M3)
  ✅ 新建 task_spawn Tool (Agent 衍生, M5)
  ✅ 保留旧 V1 TodoWrite (packages/aigcfroge/src/tool/, 兼容, 退役区)
  ⚠️ 工具不得写入 packages/aigcfroge/src/tool/ — 那是 V1 退役区注册表

Layer 4: App (M2 修订 — 方案 B：脉冲线内嵌节点，移除底部 dock)
  ✅ 移除 SessionTodoDock (composer region 删导入+挂载+dock() 折叠逻辑, 保留 rolled/lift 给 revert)
  ✅ layout.tsx 删 todoCollapsed 状态 (:66, :811-819)
  ✅ stories: todo-panel-motion.stories.tsx 更新/删除 (引用 SessionTodoDock 失效)
  ✅ 新增 SessionTodoProgress (timeline session-progress 容器内, 复用现有 progress 不新增面板):
      ├─ 节点 icon 按 i/total 绝对定位, data-state={todo.status}
      ├─ hover tooltip 显示 todo.content (键盘用 title 属性)
      ├─ 完成度推进: 有 todo 时 clip-path inset 按 doneRatio, in_progress 节点局部 whip
      │               无 todo 时保持现有 session-progress-whip infinite (零改动)
      ├─ 右侧统计 done/total (如 3/5)
      ├─ timeline 挂载时 directorySync.todo(sessionID) 拉取 (中途退出/重载恢复)
      └─ SSE todo.updated → reconcile 更新节点 (全量替换模型, 中途添加节点自动出现)
  ✅ 边界兜底 (详见 §5.5): undefined/空数组/非法 status/除零/单节点/过多节点降采样/aria
  ✅ 可交互 Checkbox → 折叠浮层列表 (hover 节点 or 点击统计展开, M2 交互范围)
  ✅ E2E tests (借鉴 U3)
  ✅ AgentTaskHub 面板 (M4 已交付：dot-grid 下拉 + 弹层入口 §5.7 + 跨 session 聚合 + 定时任务管理 + M5 衍生区接线)

Layer 5: TUI (packages/tui/src/component/task-item.tsx)
  ✅ TodoItem → TaskItem 已完成（M6：sync 读 task store + todo-item.tsx → task-item.tsx 六状态映射 + ⚡ 定时标记 + 侧栏 todo.tsx → task.tsx 读 task store；plugin 面 `state.session.todo()` deprecated 投影 + `state.session.task()` 新增；执行提示词 [prompt-todo-task-m6.md](prompt-todo-task-m6.md)）
```

### 5.4 核心断裂修复：TaskDriver ↔ Task 联动（双轨）

> 现状调研（2026-08-02）：我们代码与上游 dev V2 **均无 task↔todo 联动**——task tool 参数无 `parent_task_id`，上游 V2 甚至没有 task tool（委派在 V1 构建流）。本设计为**全球空白区的差异化创新**，不照搬任何上游。
>
> **元智能体场景**：meta-agent 编排层委派多子任务（跨模式），联动后 todo list 成为编排进度仪表盘——用户看到编排树每个子任务状态，而非"后台在跑看不到"。

**双轨设计**（两种触发方式，互为补充）：

```
轨 A — 显式关联（LLM 先规划再执行）:
  LLM: task_write([{content:"安全审查", status:"in_progress"}])   → 建 todo 拿 id t-1
  LLM: task("审查 src/auth", parent_task_id:"t-1")
       ├─ TaskDriver.delegate() → 子会话完成
       └─ 自动回写: task_update({id:"t-1", status:"completed", childSessionID:"ses-xxx"})
  适用: 需要先规划 todo 清单、按清单逐项执行的场景

轨 B — 委派自动建 todo（LLM 直接委派，todo 是副产品）:
  LLM: task("审查 src/auth 的安全性")
       ├─ TaskDriver.delegate() → 子会话
       └─ [系统] 自动在父会话 todo 创建 in_progress 条目
              (content = description "审查 src/auth", 关联 childSessionID)
           → 子会话完成自动回写 completed
  适用: 元智能体编排（LLM 只关心委派，todo 被动生成）、直接委派场景
```

**关键点**：
| 维度 | 轨 A（显式） | 轨 B（自动） |
|---|---|---|
| LLM 调用次数 | 2 次（task_write + task） | 1 次（task） |
| 顺序约束 | 先建 todo 再委派（鸡生蛋） | 无 |
| todo 规划性 | 用户可预见 todo 清单 | todo 是副产品（委派后出现） |
| 元智能体编排 | 可选 | **主要路径**（编排进度自动映射 todo） |
| task tool 参数 | 需新增 `parent_task_id` | 无需新参数 |

**实现要点**：

- task tool（`core/src/tool/task.ts`）新增可选 `parent_task_id`（轨 A）；同时委派入口检测——未提供 parent_task_id 时走轨 B 自动建 todo（`content=description`，`status=in_progress`，`childSessionID` 存 `outputDigest`）
- 回写时机：子会话 settle（成功/失败/取消）时经 `SessionTask.update` 自动回写对应 todo 条目
- 回写状态机：成功→`completed`、失败→`failed`（错误摘要入 outputDigest）、取消→`cancelled`
- 子会话跳转：`childSessionID` 使 todo 条目可点击跳转子会话（hover/详情）
- 与现有 todowrite 兼容：轨 B 自动建的条目 LLM 后续 task_write 仍可覆盖（全量替换模型天然支持）

### 5.5 SessionTodoProgress 边界与兜底（M2）

> CLAUDE.md 边界原则：只兜底"外部输入 + 计算除零"真实边界，不为不可能场景加防御。

**数据源边界（todo 来自 LLM = 外部输入，必须验）**：
| 边界 | 兜底 |
|---|---|
| `serverSync.todo[sessionID]` undefined（未同步/会话刚开） | 视为 `[]`，走"无 todo 原样"分支 |
| 空数组 | 保持 `session-progress-whip infinite`（现状原样） |
| 全 completed | 推进 100%，显示 `5/5` |
| 全 pending | 推进 0%，显示 `0/5` |

**状态异常（现状 `Schema.String` 无字面量约束，LLM 可写任意字符串）**：
| 边界 | 兜底 |
|---|---|
| 非法 status（非 4 合法值） | 归入 `pending` 显示不崩（M0 `TaskStatus Literal` 根治） |
| 多个 in_progress | 取第一个做推进锚点，高亮首个 |
| cancelled 节点 | 不计完成度，灰色/划掉 |

**计算边界**：
| 边界 | 兜底 |
|---|---|
| `total = 0` 除零 | `doneRatio = total === 0 ? 0 : done/total` |
| 单节点（`i/(total-1)` 除零） | `total <= 1 ? 50% : i/(total-1)*100%` |
| 节点过多（>20） | 降采样：只渲染首尾 + 中间省略点，hover 仍可看完整列表 |
| content 为空 | hover 不弹 tooltip |

**交互/无障碍**：
| 边界 | 兜底 |
|---|---|
| tooltip 溢出视口 | 左右翻转定位（复用现有 tooltip 组件） |
| 键盘不可达（hover 仅鼠标） | 节点加 `title` 原生气泡 + 语义正确 |
| 读屏器 | 加 todo 后 `aria-hidden` 移除，`role="progressbar"` + `aria-valuenow={done}` |

**恢复（中途退出/重载）**：数据持久化在 SQLite `TodoTable`（服务端），UI 重载后 timeline 挂载时调用 `directorySync.todo(sessionID)` 拉取一次（[directory-sync.ts:524](packages/app/src/context/directory-sync.ts#L524)，内置 retry），后续靠 SSE `todo.updated` 增量更新。

**明确不做**：连续动画插值（LLM 离散全量更新）、100+ 虚拟滚动（常态 <20，超限降采样）、拖拽排序（M5 未纳入，未排期另行立项）、todo 拉取重试（`retry()` 已内置）。

**影响面确认（底部 dock 移除安全）**：Question/Permission/Revert dock 均 `request`/`rolled()` 独立触发，不受影响；composer `dock()` 折叠逻辑已确认**纯服务 todo**（`session-composer-state.ts:62` `dock: todos().length > 0 && live()`），移走 todo 后可删（保留 `rolled/lift` 给 revert）；`todoCollapsed` 仅 composer 使用可删；stories 需同步。

### 5.6 定时任务 (ScheduledJob) UI 位置（M3 决策）

> 概念区分：**定时任务**（ScheduledJob，cron 周期执行，带 nextRun 时间戳）≠ **目标任务**（TaskSpawn，一次性委派）。Accio 报告的 ScheduledJobs 是**定时功能**（§4.2：cron + lastRun/nextRun + status），不是目标任务。本小节只定定时任务的 UI 位置。

**Accio 位置**：per-Agent 视角，管理入口在 Agent 详情/面板（`agent-detail-modal` / `agent-panel` / `agent-hub-page`），无 session 级定时 UI。定时任务运行状态可能进 `agent-activity-island`（活动岛 running）。

**AigcForge 决策（2026-08-02，双位置分工）**：

```
标题行 (message-timeline.tsx:1373 sticky)
┌────────────────────────────────────────────────────────┐
│ (spinner) [⚡ 周一 9:00] 会话标题      SessionContextUsage [dot-grid] │
│            ↑定时icon+nextRun时间戳(常显)   ↑更多下拉含"定时任务"
└────────────────────────────────────────────────────────┘
```

| 位置                                                                                                                              | 内容                                                     | 角色                                           |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| **标题左侧**（spinner 之后/标题前）                                                                                               | 定时 icon + nextRun 时间戳（`⚡ 9:00` / `⚡ 周一 9:00`） | **状态常显**——周期性任务的下次触发时间持续可见 |
| **标题右侧更多下拉**（[dot-grid, message-timeline.tsx:1478](packages/app/src/pages/session/timeline/message-timeline.tsx#L1478)） | "定时任务"菜单项                                         | **管理入口**——弹层列表/新建/启停               |
| 上下文按钮区（SessionContextUsage）                                                                                               | 不动                                                     | 保持纯净，不混入任务状态                       |

**不采纳**：上下文按钮左侧加常显 icon 开关——上下文区是紧凑操作区，常显状态会拥挤；定时任务的时间戳应常显在标题（类日历提醒），管理入口走已存在的更多下拉（零新 UI）。

**归属**：`agentID` 字段（M3）——定时任务 per-Agent；标题左侧时间戳显示**当前 session 绑定 Agent** 的 nextRun。

**影响面**：
| 组件 | 影响 |
|---|---|
| 标题行左侧 | 加条件渲染的定时 icon + 时间戳 |
| dot-grid 下拉 | 加"定时任务"菜单项（[message-timeline.tsx:1501](packages/app/src/pages/session/timeline/message-timeline.tsx#L1501) DropdownMenu.Content） |
| 定时任务弹层 | 新弹层（列表/新建/启停，M3） |
| 上下文按钮区 | 零影响 |

---

### 5.7 Agent Hub 入口位置（M4 决策，2026-08-02）

> M4 评审预备阶段发现：wip 实现把 AgentTaskHub 入口做成了 composer 区**常显**"My agents"按钮，该位置无任何计划决策背书（评审列为 MAJOR）。三个候选位置经用户裁决：

| 候选               | 形态                                                         | 裁决                                                                 |
| ------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| Chat 模式聚合 tab  | Chat 主区完整 Agent Hub 页（对齐 Accio agent-hub-page 三区） | ❌ 本期不做——Chat 主区改造超出 M4 估时（3d），**留作 M4 后独立立项** |
| **时间线下拉入口** | dot-grid 更多下拉加"智能体"菜单项 + 弹层（复用 §5.6 模式）   | ✅ **采纳**——与 M3 定时任务同构、零常显 UI、评审面最小               |
| composer 常显按钮  | wip 已实现形态                                               | ❌ 否决——无设计依据的常显 UI，new-session 页也会渲染                 |

**决策细则**：

- 入口复用 §5.6 双位置分工的右半：`DropdownMenu.Content` 加"智能体"菜单项 + `pendingScheduled` 式延迟打开 + 弹层锚定 more 按钮；上下文按钮区零改动
- 弹层三区结构（对齐 Accio A3）：我的智能体 + 任务衍生（占位，接 M5 task_spawn）+ 新建入口
- 弹层容量上限用"浮层管常用聚合，完整管理跳独立页"分层缓解——独立页即未来的 Chat 聚合 tab 立项
- wip 分支 `todo-task-m4m5` 的 AgentTaskHub 实现（commit `1b8c426ac`）**model/面板/i18n/CSS 可回收**，composer 挂载 hunk 一律不回收
- 执行提示词：[prompt-todo-task-m4.md](prompt-todo-task-m4.md)

**删除语义裁决（2026-08-02 拍板，2026-08-03 收缩移出 M4，留作未来 agent 管理立项的既定语义）**：

- **M4 不含删除 Agent**：AgentTaskHub 只做定时任务的启停/删除/新建；任何 agent 行不得出现删除入口
- 未来立项时的既定语义：**自定义智能体可删**（chat 模式创建的 agent-asset）——删除 = 调既有 `DELETE /session/{id}/agent-asset/delete` 删资产 + 级联清除其定时任务；**内置智能体永不进入可删列表**（build/general/explore/plan 等代码定义角色，判别：是否被 `GET /agent-asset` 列表支撑，契约层 `Agent.Info` 无来源标记，app 侧判别即可）
- 会话引用已删 agent 的兜底行为（resolve 失败/回退）届时需核实并在确认文案中如实说明

---

### 5.8 SessionTodoProgress 统一轨道 UX 重构（M7 决策，2026-08-03）

> **状态：已落地（2026-08-04，`todo-task-m7` 分支四步审批闭环）**。交付：统一轨道下移标题行下方 + 四态状态机（含 idle 静态留存）+ 几何修复 + 双脉冲 + 面板外部关闭 + ⑦ freshness + ④ 白块指认；`specs/v2/todo.md` M7 行 ✅ 化、M2 限制①正式解决。执行偏差注记见决策 3/5/9 后。

> 起源：M2 脉冲线上线后用户实测反馈 7 项缺陷（首尾节点裁切不可见、填充终点与节点完成位置错位、统计数值不更新、顶部不明白块、节点/线比例失调、节点 icon 不合理、面板遮挡标题右侧图标）。审批通道（代码根因定位）与外部设计方案（`sse_progress_ux_proposal`）独立诊断后交叉收敛：三个功能 bug（裁切/错位/静态锁定）双方一致确诊。DESIGN.md「quiet, dense, operational」裁决：**不采纳**方案中的节点下文字标签、节点旁百分比徽标、独立大卡片布局、宽度变化统计 pill、节点内数字。

**决策**：

1. **统一轨道**：无 TODO 环境脉冲与 TODO 交互条合并为同一条轨道，位置从 sticky 标题栏顶部移到**标题行下方**（同一 sticky 容器内，absolute 零占位，不触发布局位移——DESIGN.md 硬约束）。否决「顶部 whip + 下方 TODO 条」双轨夹标题方案（语义相近却位置分离，视觉噪音翻倍）。
2. **状态机**：

   | 状态               | 轨道                   | 左侧文本             | 节点         | 右侧统计                   |
   | ------------------ | ---------------------- | -------------------- | ------------ | -------------------------- |
   | 无 TODO（working） | 2px 环境脉冲           | 隐藏                 | 无           | 隐藏                       |
   | TODO 激活          | 2px 轨道 + 填充        | 「任务列表」（i18n） | 10px 圆点/勾 | `done/total`               |
   | 全部完成           | 填充贯通               | 同左                 | 全勾         | 成功色（只变色，宽度不变） |
   | idle 且有任务      | **静态留存**（无动画） | 同左                 | 静态         | 静态                       |

   第三行「成功色」走 `--v2-state-*` 族 token（执行时 grep 确认确切名称）；第四行**修订 M2 已声明限制①**（原「会话 idle 后节点与统计隐藏」作废，`specs/v2/todo.md` 同步修订）；下次 working 恢复脉冲动画。

3. **几何**：轨道两端内缩 **8px**（首末节点不再裁切、不被统计遮挡；16px 方案否决——20 节点时间距仅 ~4.7%，两端 32px 太奢侈）；节点 **10px** 圆心压线（线心与圆心垂直对齐，修线贴上缘走的错位）；完成节点 accent 实心 + **小勾**；anchor 节点呼吸光晕；统计文本为轨道右端内侧邻居，不压末节点。
4. **填充终点索引语义**：废除 `doneRatio` 比率裁剪（比率语义与节点索引语义永不对齐的根因），改为节点位置语义——填充止于 anchor（当前 in_progress）节点 pct；无 anchor 止于最后完成节点 pct；全完成贯通 100%。
5. **脉冲动画**：
   - **无 TODO 环境脉冲**：复用现有 clip-path 扫描机制（零新动画代码），周期 640ms → **~1.4s 起、随宽度放缓（既有 `pace` 机制按 header 宽度调速）且含停留段**（keyframes 34%-50% 静止区间），颜色降为 `color-mix(var(--v2-icon-icon-accent) 50%, transparent)` 柔光——位置下移后离内容更近，原速原色会抢注意。
   - **TODO 任务脉冲**：高亮段在 `[--pulse-from, --pulse-to]` 区间往返（`--pulse-from` = 最后完成节点 pct，无完成则 0%；`--pulse-to` = anchor 节点 pct），CSS 自定义属性 + keyframes `translateX` 驱动，**无 JS 帧循环**。百分比完全可控，距离天然等于节点几何。无 anchor（无 in_progress）不跑。
6. **交互**：保持**默认收起**（否决「触发自动展开、点击收起」——长会话多次重建任务列表会反复打断，且节点出现本身已是启动信号）；折叠面板从轨道下缘展开 + **点击外部关闭**（修当前无 dismiss layer、面板常驻遮挡标题右侧 more-options 图标的缺陷）。「首次 TODO 统计短暂脉冲高亮」affordance 评审后放弃（极致减法）。
7. **⑦ session_task 静态锁定修复**（双通道独立确诊）：`session_todo`/`session_task` 双数据源从「task 非空即锁定」（`session-todo-progress.tsx:44-49` 偏好逻辑 + `:58-78` 播种逻辑）改为**按新鲜度选择**；V1 runtime 下一次性播种的数据不得锁死 `todo.updated` 通道驱动的实时更新。
8. **④ 顶部白块**：执行时先用 playwright 对 mock 环境截图 + 元素检查指认真凶再处理；若证实为既有 titlebar 边框等非本组件元素，如实记录「非本组件」不动，不为了交差乱改。
9. **轨道可读性遮蔽（2026-08-03 补充裁决）**：不给轨道加「模块背景/pill 底」（DESIGN.md 否决装饰性卡片与 framed 工具面，且 pill 内边距会与 8px 内缩、节点定位几何纠缠）。改为**扩展 sticky 标题栏既有渐变遮蔽**：`bg-[linear-gradient(to_bottom,var(--background-stronger)_48px,transparent)]` 的实色段从 48px 延伸到覆盖轨道区（~64-70px，执行时按轨道实际落点校准），底部保持渐隐——轨道下移后即移出 48px 实色区，节点/统计文本会直接叠印滚动消息内容，遮蔽是可读性必需而非装饰。token 保持 `--background-stronger` 不换（DESIGN.md：v1 token 可用于匹配既有组件，同一标题栏表面换 v2 会造成上下两截色差）；折叠面板不受影响（自有 `--v2-background-bg-layer-01` 浮层背景，语义正确）。absolute 零占位与布局稳定约束不变。

**影响面**：只动 `packages/app`（session-todo-progress 组件/model、`index.css` 相关段、message-timeline 挂载点与显隐条件、server-sync/event-reducer freshness、i18n en/zh/zht、e2e 与 mock-server）+ 文档（本计划、`specs/v2/todo.md`、PRD 交叉注记）。L1-L4（schema/core/server/SDK）与 tui/plugin **零 diff**。

**执行偏差注记（2026-08-04 落地时记录）**：

- **header 72px 预占**：22px 双行轨道（label/统计顶行 + 2px 线/10px 节点底行）放不进 `pb-4` 的 16px 底部区，执行时 header `pb-4`→`pb-6`（48+24=72px）腾出轨道区，决策 9 的"~64-70px"校准为实色段 68px / 头部总高 72px，`scrollMargin`/item top/`--sticky-accordion-top` 常量 64/48→72 同步。**布局决策**：label/统计在轨道顶行、节点/线在底行（同行的 8px 内缩不足以避开 ~36px label 与 ~20px 统计，两行分离是唯一干净解）。
- **环境脉冲 agent tint 取舍**：颜色保留 `tint() ?? var(--icon-interactive-base)`（v1 token）加 `opacity: 0.5` 柔光，而非决策 5 字面的 `color-mix(var(--v2-icon-icon-accent) 50%, transparent)`——保留 agent tint 语义（prompt §2 "保持 agent tint 语义或如实记录取舍"），代价是环境脉冲仍用 v1 token 而非 v2 accent。
- **决策 3 反转（2026-08-05）**：内缩 8px → **16px 统一留白**。原"16px 方案否决"以节点裁切为唯一考量；用户按视觉统一裁定：标题模块与 todo UI 视为同一复合模块，四边留白统一 = 标题行 `pl-4` 左内边距 16px。实现：轨道线/fill/label/统计 `left/right: 0`→`16px`、模型 inset 8→16px、band `height 22`→`34px`、header `pb-6`→`pb-[34px]`（72→82px）、渐变实色段 68→78px、scrollMargin/`--sticky-accordion-top`/行 top 常量 72→82px。审批修复补充（初版）：节点用完整容器坐标、fill 用内缩轨道坐标、模型新增 `fillEndTrackPct` 显式换算避免二次内缩。**P0/P1 修订（2026-08-05，TDD）**：统一为单一轨道局部坐标--track-area 容器由 CSS `left/right: var(--session-progress-inset)` 内缩 16px，节点/fill/pulse 全部用 `left: 0..100%`/`width: 0..100%` 局部坐标，消除两套坐标系与 `fillEndTrackPct` 换算；Playwright 断言可见填充终点与节点圆心误差 <1px。20 节点间距仍 ~4.7%，两端 32px 占整体比例小，视觉统一优先。
- **决策 5 脉冲逻辑修订（2026-08-05，用户裁定，两态统一；P0/P1 修订：删除连续推进、改 indeterminate 活动区间）**：脉冲机制统一为 **一个 14px 位移段**（`session-progress-segment-sweep`，translateX from→to，无 JS 帧循环），删除无 todo 的 clip-path whip。**运行态始终渲染轨道骨架**：半透明轨道线（`session-progress-track`，opacity .5）+ 初始/结尾两个端点节点（`session-progress-endpoint`，10px 圆点，落在 16px 内缩处）；有 todo 时任务节点 icon 替换端点。脉冲语义（模型 `pulse`）：**P0/P1 修订（2026-08-05，TDD）后为不确定性活动区间**--`pulse = { fromPct: 完成前沿 pct, toPct: 首个 in_progress 锚点 pct }`，仅当锚点前存在已完成节点时存在（`firstInProgress > 0 && pulseFromPct < pulseToPct`）。**初版的 `outputFraction`/`TASK_OUTPUT_BUDGET` 输出量插值已删除**--assistant 消息数是伪精度（一条消息可能很长或无有效输出、子会话输出不推父会话、tool/思考不一定产生新 assistant 消息），视觉上的“连续进度”实为离散跳变。脉冲表达“此区间有工作在进行”而非“LLM 完成 N%”。脉冲渲染门收紧为 `working && pulse`（反转初版“全部 pending 也显示脉冲”）--全部 pending 无活动任务故无脉冲；单/首锚点无区间故无脉冲，靠节点 `data-anchor` 呼吸光晕（`session-todo-progress-node-pulse`）表达活动。无 todo 环境脉冲仍扫整条线（0%->100%，2.4s），有 todo 任务脉冲 1.4s。共享常量 `TRACK_INSET=16`/`PULSE_WIDTH=14` 由父组件注入 CSS 变量 `--session-progress-inset`/`--session-progress-pulse-width` 收敛三处手写重复。实测（P0/P1 后）：无 todo 环境脉冲扫整条线；有 todo 且锚点前有完成节点时脉冲在完成前沿↔锚点间扫动；全部 pending / 单锚点 / 首锚点无脉冲（节点呼吸光晕表达活动）；idle 静态留存轨道与节点。`de6bcc15f` 的 `pct(0)` 钳制、"from=lastCompleted→anchor"前沿抖动、"无完成则 0%"回退均被取代。

---

## 6. 跨模式适用矩阵

| 能力                 | Chat            | Coding           | Work               | Assistant   | Meta-Agent    | 电商                |
| -------------------- | --------------- | ---------------- | ------------------ | ----------- | ------------- | ------------------- |
| **TaskWrite**        | ✅ 资产管理     | ✅ 代码审查      | ✅ Preset 展开     | ✅ 提醒任务 | ✅ 编排子任务 | ✅ 商品上架流程     |
| **TaskDriver 联动**  | ✅ 资产校验     | ✅ 多文件重构    | ✅ 长文档分段      | ❌          | ✅ 跨模式委派 | ✅ 多店铺批量       |
| **定时任务**         | ✅ 资产定期校验 | ✅ 每日代码扫描  | ✅ 周报生成        | ✅ 周期提醒 | ✅ 定时巡检   | ✅ 大促监控         |
| **任务衍生 (Spawn)** | ✅ 资产→Agent   | ✅ Bug→修复Agent | ✅ 成功Preset→模板 | ❌          | ✅ 委派→Agent | ✅ 商品→上下架Agent |
| **可交互 TaskPanel** | ✅              | ✅               | ✅ (核心)          | ✅          | ❌            | ✅                  |
| **子任务**           | ✅ 复杂资产     | ✅ 重构链        | ✅ 文档分章节      | ❌          | ✅ 编排 DAG   | ✅ 审核链           |

### Work 模式特别说明

Work 模式是 **Task 升级的最大受益方**——ProgressLedger 本质上就是结构化 Task List，统一后不需要两套系统：

```
Work Preset "撰写 PRD"
  └─ 自动展开为 Task List:
       ├─ [ ] 需求澄清 (询问目标/受众/约束)
       ├─ [ ] 竞品分析 (搜索对比)
       ├─ [ ] 撰写草稿
       ├─ [ ] 自我校验
       └─ [ ] 落盘到 Location
```

**裁决**：Work PRD §9.1 ProgressLedger 与 Task List **统一为同一模型**：

- ProgressLedger 的 `step` = TaskInfo 的子集（引用 `id`/`content`/`status`/`outputDigest`）
- `outputDigest` 已补入 TaskInfo（§5.1）与分期表 M2（原 M1.5 折入，§5.2）
- `currentStepIndex` = 首个非 `completed` 步骤索引（派生值）；`canResume` = 存在 `failed`/`in_progress` 步骤（派生值），均不落存储
- 状态字面量统一用 `in_progress`（仓内惯例），Work PRD 原文的 `running` 需在 Work PRD v4.1 修订为 `in_progress`
- **对齐动作提前到现在，不等 M5**：Work PRD 出 v4.1 小修订，两文档互加关联链接——两边都没写代码，改契约零成本

---

## 7. 电商场景垂直验证

### 7.1 商品上架

```
Agent: 商品运营 Agent
  ├─ 定时: 每日 9:00 库存预警
  ├─ 衍生: "商品缺货" → 自动创建补货分析子 Agent
  └─ Task List:
       ├─ [✓] 图片审核 (依赖: 设计稿)
       ├─ [•] SEO 标题优化 (依赖: 关键词研究)
       ├─ [ ] 价格策略校验 (依赖: 竞品抓取)
       ├─ [ ] 多平台同步上架 (依赖: 前三项全完成)
       └─ [ ] 24h 数据回检 (定时: 上架后 24h)
```

### 7.2 大促作战室

```
Agent: 大促指挥 Agent (Meta-Agent)
  ├─ 子 Agent: 价格监控 (定时: 每 5min)
  ├─ 子 Agent: 库存监控 (定时: 每 10min)
  ├─ 子 Agent: 客服质检 (定时: 每小时 100 条)
  └─ Task DAG:
       ├─ [✓] 活动页面审核 (9:00)
       ├─ [✓] 优惠券配置校验 (9:30)
       ├─ [•] 预售库存锁定 (10:00 截止)
       ├─ [ ] 物流确认 (依赖: 库存锁定)
       └─ [ ] 风控部署 (依赖: 优惠券校验 + 物流确认)
```

### 7.3 跨境合规

```
Agent: 合规审查 Agent
  ├─ 定时: 每周一 9:00 检查法规更新
  ├─ Task List (每次触发):
  │    ├─ [ ] 抓取法规变更
  │    ├─ [ ] 对比商品合规状态
  │    ├─ [ ] 生成受影响清单
  │    └─ [ ] 输出修改建议 + 风险评级
  └─ 衍生: 高风险商品 → "紧急合规修复 Agent"
```

---

## 8. 里程碑

| 阶段                   | 范围                                                                                                                                                                                                                                                                                                                                                                                                     | 准入                                                                                                                                                                                                                                   | 退出                                                                                                                                                                                                         | 估时 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| **M0 契约**            | Schema 新增 `session-task.ts`（文件，包已存在）、TaskDriver↔Task 联动接口定义                                                                                                                                                                                                                                                                                                                           | **前置①**: rebase `task-driver` 活跃改动区审计快照（`bff51d690` judge、`50599e86e` CLI persistence、`98762aa47` summaries 均为近期 commit）；**前置②**: 先读 `delegation-parser.ts`/`delegation-protocol.ts`，排查与任务追踪的概念重叠 | Task 契约 + 事件定义 + Schema 评审通过                                                                                                                                                                       | 2d   |
| **M1 核心**            | SessionTask Service (替代 SessionTodo)、增量 CRUD、TaskDriver↔Task 双轨联动（轨 A `parent_task_id` + 轨 B 自动建 todo + 回写状态机）、tool denies 回灌、`PATCH /session/{id}/task` 写 API + SDK gen                                                                                                                                                                                                     | M0                                                                                                                                                                                                                                     | ✅ **已完成**（2026-08-02，`session-task.test.ts` + `tool-taskwrite.test.ts` + 写 API + 双轨联动测试通过；specs 已同步）                                                                                     | 5d   |
| **M2 UI**（含原 M1.5） | **outputDigest 持久化**（task 表加列 + Service 落库 + 迁移）+ **补 `GET /session/{id}/task` 读取端点**（§9.1 缺口：todo GET 未增 tasks 字段，重载恢复依赖）+ SessionTodoProgress（脉冲线内嵌节点 + hover tooltip + 完成度推进 + 统计 3/5 + 重载恢复 + 边界兜底）+ 移除底部 SessionTodoDock（composer dock() 折叠逻辑/layout todoCollapsed/stories 同步清理）+ 折叠浮层交互（可交互 checkbox）+ E2E tests | M1                                                                                                                                                                                                                                     | ✅ **已完成**（2026-08-02，`todo-task-m2` 分支：UI 回放 + E2E 5 用例全绿 + 写 API 联调 + 重载恢复测试含 id 稳定性往返；差异审批 blocking 项全修复）                                                          | 5d   |
| **M3 定时任务**        | ScheduledJobRunner（含启动 re-arm + unattended 权限策略）、task_schedule Tool、agentID 归属、**定时任务 UI（标题左侧 icon + nextRun 时间戳 + 更多下拉入口 + 弹层，§5.6）**                                                                                                                                                                                                                               | M1                                                                                                                                                                                                                                     | ✅ **已完成**（2026-08-02，`todo-task-m2` 分支：重启 re-arm 专项测试 + unattended 预授权测试 + B1 防重入抢占 + 标题时间戳渲染 + E2E；限制已声明：单进程内存调度/真实 LLM 端到端无 CI/停机 recurring 不补偿） | 7d   |
| **M4 AgentHub**        | AgentTaskHub 面板（**入口：dot-grid 下拉 + 弹层，§5.7 决策**）、Agent 视角聚合、定时任务完整管理 UI（对齐 Accio agent-panel；**删除 Agent 已移出 M4**，语义见 §5.7 保留裁决）；执行提示词 [prompt-todo-task-m4.md](prompt-todo-task-m4.md)；可复用资产在 wip 分支 `todo-task-m4m5`                                                                                                                       | M2+M3（✅ 已满足）                                                                                                                                                                                                                     | ✅ 已完成（2026-08-03，`todo-task-m4` 五步审批闭环）                                                                                                                                                         | 3d   |
| **M5 跨模式集成**      | task_spawn Tool、DAG 依赖、hub 衍生区接线、电商验证（~~Work Preset→Task 展开、Assistant 定时提醒→ScheduledJob~~——2026-08-03 裁决：无既有基础设施支撑，移出本里程碑另行立项）；执行提示词 [prompt-todo-task-m5.md](prompt-todo-task-m5.md)；资产在 wip commit `3e4f50f46`                                                                                                                                 | M4（✅ 已满足）                                                                                                                                                                                                                        | ✅ 已完成（2026-08-03，`todo-task-m5` 五步审批闭环，1 MAJOR 打回修复 + 1 MAJOR 审批亲修）                                                                                                                    | 3d   |
| **M6 TUI TaskItem**    | TUI 数据源脱离 V1 投影桥（sync 改读 `session.task` GET + `task.updated`）+ TodoItem→TaskItem 改名 + 六状态完整映射 + ⚡ 定时标记；plugin 公开面 `state.session.todo()` 兼容投影 + `@deprecated`；**只动 `packages/tui`**；执行提示词 [prompt-todo-task-m6.md](prompt-todo-task-m6.md)                                                                                                                    | M5（✅ 已满足）                                                                                                                                                                                                                        | ✅ 已完成（2026-08-03，`todo-task-m6` 三步审批闭环；TUI 对 `session.todo`/`todo.updated` 零依赖、侧栏展示任务真身含定时标记、测试全绿）                                                                      | 1-2d |
| **M7 统一轨道 UX**     | SessionTodoProgress 统一轨道重构（§5.8：轨道下移标题行下方 + 四态状态机 + 几何修复（16px 内缩/10px 带勾节点/圆心压线）+ 填充终点索引语义 + 双脉冲动画（环境柔光 1.4s 起随宽度放缓 / 任务段 pulse-from→pulse-to）+ 面板外部点击关闭 + ⑦ session_task freshness 修复 + ④ 白块指认）+ M2 idle 隐藏限制修订为静态留存；**只动 `packages/app`**；执行提示词 [prompt-todo-task-m7.md](prompt-todo-task-m7.md)   | M2（✅ 已满足）                                                                                                                                                                                                                        | ✅ 已完成（2026-08-04，`todo-task-m7` 四步审批闭环；e2e 16 用例全绿；偏差注记见 §5.8）                                                                                                                       | 2d   |

**总估时：25d**

**延后项总表**（2026-08-03 收官盘点——M0-M5 均未纳入，按既定语义或需新立项）：

| 项                                                     | 出处                          | 状态/既定语义                                                                                                                                                                                                                                             |
| ------------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A4 Board Home 任务入口                                 | §3.1 A4（P1）                 | 未排期                                                                                                                                                                                                                                                    |
| A5 Skill per-Agent 安装                                | §3.1 A5（P2）                 | 未排期                                                                                                                                                                                                                                                    |
| Work Preset→Task 展开、Assistant 定时提醒→ScheduledJob | 原 §8 M5 行                   | 2026-08-03 裁决移出，无既有基础设施，需独立立项                                                                                                                                                                                                           |
| 删除 Agent（自定义资产可删/内置永不进列表）            | §5.7 保留裁决                 | 语义已拍板，待独立 agent 管理立项实现                                                                                                                                                                                                                     |
| Chat 模式 Agent Hub 聚合 tab                           | §5.7                          | M4 后独立立项                                                                                                                                                                                                                                             |
| 新建 agent 入口（hub zone-3 占位）                     | §5.7                          | 全项目无可复用创建路径（M4 Step 5 grep 结论），占位待立项                                                                                                                                                                                                 |
| TUI TodoItem → TaskItem                                | §5.3 Layer 5                  | ✅ **M6 已完成**（2026-08-03，`todo-task-m6` 三步审批闭环：sync 数据源迁移 + adapter 兼容投影 + TaskItem 六状态/定时标记 + 侧栏迁移；交付明细见 [specs/v2/todo.md](../../specs/v2/todo.md)，执行提示词 [prompt-todo-task-m6.md](prompt-todo-task-m6.md)） |
| 拖拽排序                                               | §5.5 明确不做                 | 未排期                                                                                                                                                                                                                                                    |
| V1 Todo 物理删除                                       | Phase 5（`specs/v2/todo.md`） | deprecated 注释已落，删除在下个大版本                                                                                                                                                                                                                     |

> **G2 定时任务两个设计缺口**（M3 必须覆盖）：
>
> 1. **重启 re-arm**：内存调度器启动时重扫 TaskTable，按 `recurrence` 重建 next-run 队列（已并入 §9.3）。
> 2. **unattended 权限策略**：后台定时任务运行于 unattended 会话，`permission.ts:168-174` 已自动将 ask 转 deny——读文件会静默被拒。需为定时任务预授权 ruleset（明确允许的 tool/pattern），或显式 `attended-only` 约束（定时任务要求用户在场）。

---

## 9. 兼容与迁移

### 9.1 向后兼容

| 旧接口                   | 策略                                                                                                                                                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionTodo.update/get` | 内部转发到 `SessionTask`，标记 deprecated                                                                                                                                                                                                                                          |
| `TodoWrite` Tool         | 保留，Schema 兼容（Todo.Info ⊂ Task.Info）                                                                                                                                                                                                                                         |
| `todo.updated` Event     | 继续 emit，同时 emit `task.updated`（注意：V1/V2 已在双发 `todo.updated`，双发 `task.updated` 时一并收敛）                                                                                                                                                                         |
| `GET /session/{id}/todo` | 现有唯一 todo endpoint（无 POST，写入全走 tool 路径），Response 保持三字段投影不变。M2 另增独立的 `GET /session/{id}/task` 读取端点（`packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts:144`）返回带稳定 id 的 tasks，重载恢复数据源；旧 endpoint 原样保留 |
| `PATCH /session/{id}/task` | 保留为**全量 reconcile**（M1 原始写 API）。评审修复（2026-08-04）新增**原子单任务端点**：`PATCH/DELETE /session/{id}/task/:taskID`（改/删单行，`SessionTask.patch/removeTask`）+ `POST /session/{id}/task`（append 单条，服务端 mint id，`SessionTask.append`）——UI 交互路径一律走原子端点，reconcile 仅保留给全量替换场景 |
| `TodoTable` (SQLite)     | 保留，新增 `TaskTable`，M1 自动迁移                                                                                                                                                                                                                                                |

### 9.2 V1 退役路径

V1 Todo (`packages/aigcfroge/src/session/todo.ts` + `tool/todo.ts`) 自 M3b-2 起已标记 deprecated（提前标记决策），移除仍在 M5 之后的下个大版本。M1-M5 不做 V1 改动。

### 9.3 数据迁移

**必须遵守两条现有约束**：

1. **ID 约定**：不用 `hex(randomblob(16))`。走 `core/src/id/id.ts` 的 `ascending("task", ...)` 生成 `tsk_` 前缀、时间有序的 26 字符 ID（`schema/src/identifier.ts`）。
2. **迁移管线**：不写裸 SQL。走 drizzle-kit generate → `packages/core/src/database/migration/*.ts` → `migration.gen.ts` 注册 → 启动时 `DatabaseMigration.apply`（`database.ts:33`）。

```ts
// 伪代码: M1 迁移 (TaskTable 新建 + todo 回填)
// 1. drizzle-kit generate 生成 TaskTable migration
// 2. migration 文件内: 逐行读旧 TodoTable → 用 ascending("task") 生成 id → 插入 TaskTable
// 3. 旧 TodoTable 保留 (向后兼容读), 标记 deprecated
```

> **G2 补充**：M3 ScheduledJobRunner 必须设计**启动时重扫 TaskTable 重新武装（re-arm）**——内存调度器跨进程重启后，须按 `recurrence` 字段从 TaskTable 重建 next-run 队列，否则 "每日 9:00" 任务在重启后失效。

---

## 10. 风险与应对

| 风险                            | 概率 | 影响 | 应对                                                                                                 |
| ------------------------------- | ---- | ---- | ---------------------------------------------------------------------------------------------------- |
| TaskDriver 联动引入 SQLite 死锁 | 中   | 高   | 回写在 BackgroundJob fiber 执行（`task-driver.ts` 已论证安全）                                       |
| LLM 不适配新 TaskWrite Schema   | 低   | 中   | `todowrite.txt` 更新 + 旧 TodoWrite 保留 fallback                                                    |
| ScheduledJob 调度精度不足       | 低   | 低   | M3 分钟级 cron，单进程内存调度器                                                                     |
| ScheduledJob 重启后失效         | 高   | 中   | M3 必须实现 TaskTable 重扫 re-arm（§9.3）                                                            |
| 定时任务读文件被静默拒绝        | 中   | 高   | unattended 会话 ask→deny（`permission.ts:168-174`）；需预授权 ruleset 或 attended-only 约束（§8 G2） |
| Task 模型过度设计（字段膨胀）   | 中   | 低   | 按 §5.2 字段分期策略执行，不预留                                                                     |

---

## 11. 依赖与前置

| 依赖                        | 状态        | 阻塞                                                                          |
| --------------------------- | ----------- | ----------------------------------------------------------------------------- |
| ADR-13 (模式边界)           | ✅ Accepted | 无                                                                            |
| ADR-14 (持久化真源)         | ✅ Accepted | 无                                                                            |
| ADR-15 (ModeWorkspace slot) | ✅ Accepted | 无                                                                            |
| Chat M1-M7                  | ✅ Done     | 无                                                                            |
| Meta-Agent V2               | ✅ Running  | 无                                                                            |
| Assistant PRD (调度器)      | ⚠️ Draft    | M3 定时任务可先在 Core 自包含实现，不依赖 Assistant                           |
| Work PRD (ProgressLedger)   | ✅ Approved | 无（v4.1 契约已统一 `in_progress` 字面量并互加关联链接；代码层随 M1-M5 落地） |

---

## 12. 审批 Gate

| Gate           | 内容                                                       | 签字 |
| -------------- | ---------------------------------------------------------- | ---- |
| 1. Schema 架构 | Task 模型字段合理性、共享包路径、分期策略                  |      |
| 2. Core 联动   | TaskDriver↔Task 回写安全性、tool denies 回灌、写 API 落位 |      |
| 3. UI 交互     | SessionTaskPanel 可交互操作路径                            |      |
| 4. 跨模式适用  | 五模式 + 电商场景覆盖完整性                                |      |
| 5. 兼容与迁移  | 旧 API/Tool/数据向后兼容 + V1 退役时间线                   |      |

---

## 13. 附录：关键借鉴来源清单

### Accio/Xuanji (Phoenix) v0.26.1

- 反编译路径: `/tmp/accio_extract/resources/`
- 核心能力: Agent Hub / Task Spawn / Scheduled Jobs / Skill per-Agent / Board Home
- 品牌信息: Accio (外部) / Xuanji (内部代号) / aimode.alibaba.com (web)

### 上游 OpenCode (anomalyco/opencode dev e4bd9757a)

- **自 fork 以来 todo/permission 区域基本未变**
- 值得移植: `packages/schema/src/session-todo.ts` (共享 Schema)、dot() animated SVG、E2E test、newLayoutDesigns()
- 参考回灌: V1 task tool (`packages/opencode/src/tool/task.ts`) 的 `subagent_depth` 和 tool denies——回灌到 V2 TaskDriver
- **注意**: 上游 V1 task tool 是构建流 (`packages/opencode/`)，我们的 V2 TaskDriver 是元智能体 V2 流——二者是独立代码路径，不互相替代

### AigcForge 当前代码

- 五层审计见 §2
- fork 独有创新: TaskDriver (490 行, 4 种委派模式) + subagent badge (attended 功能, 15 行)
