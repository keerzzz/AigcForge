# Work 模式 M1.5 实施计划：进度账本与断点恢复

> 状态：**Approved**（2026-08-07 审批通过，6 项修改 + TDD 工作流已落地）
> 日期：2026-08-07
> Owner：Core + App
> 范围：`packages/core` + `packages/app` + `packages/schema`（仅视图类型，无新表）
> 关联：[Work PRD v4.1](../prd/work-mode-execution-layer.md) §9.1/§10.2（范围真源）、[Work 路线图](work-mode-roadmap.md) §3.3（本计划上级）、[Work M1 计划](work-mode-execution-layer-m1.md)（已合入，本计划前置）、[Todo/Task 升级计划](todo-task-system-upgrade.md)（M0-M7 已合入 main，本计划依赖）、[M1 TDD 手册](work-mode-m1-tdd-prompt.md)（TDD 范式参考）
> 分支：**work-m1.5**（从最新 main 切出；与 work-m2 分支并行，互不依赖。连字符分隔、无斜杠无类型前缀，符合 AGENTS.md Branch 规范）
> 最后更新：2026-08-07

---

## 0. 审批状态与执行 Gate

| Gate                         | 条件                                                                                                                                                                                                                        | 状态      | 阻塞范围   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| **G0 范围真源**              | Work PRD v4.1 Approved；§9.1 ProgressLedger 契约 + §10.2 Resume 交互已定义                                                                                                                                                  | ✅ 已满足 | 全部 Phase |
| **G1 依赖就绪**              | Todo M0-M7 已合入 main（PR#13 `baf93e36f` + PR#14 `06b51b5f5`）：Task Schema（7 态 + outputDigest + revision + parentID）、SessionTask Service、TaskDriver、增量 task 工具、task.progress 事件、App progress model 全部可用 | ✅ 已满足 | 全部 Phase |
| **G2 工具集边界**            | work-orchestrator 解禁 task CRUD（create/update/delete/reorder）、仍 deny edit/shell/spawn/schedule                                                                                                                         | ✅ 已确认 | Phase B-D  |
| **G3 outputDigest 填充策略** | 扩展 task_update 工具 + updateTask Service 支持 outputDigest 字段                                                                                                                                                           | ✅ 已确认 | Phase A    |
| **G4 Resume 机制**           | 对话级 resume（非 TaskDriver background），用户在场触发                                                                                                                                                                     | ✅ 已确认 | Phase C-D  |

**与 M1 禁区的关系**：M1 禁区是"不实现 ProgressLedger/步骤追踪"。M1.5 正是解禁该禁区，但**继承 M1 的其余边界**：候选稿=消息正文（D1 不变）、无 edit 工具、无 shell、无内嵌编辑器、不新建全局 Work 工作区。

---

## 1. 目标、非目标与本次收敛

### 1.1 M1.5 目标

work-orchestrator 执行文档生成时，把任务拆成可追踪的步骤 Task（澄清 -> 构思 -> 撰写 -> 校验），在会话中栏常驻 **Progress Ledger 进度条**（复用已合入的 `SessionTodoProgress`）展示步骤状态；生成中断/失败时，提供 **"从断点恢复 (Resume)"按钮**，用户点击后 work-orchestrator 读取 task list 的 `outputDigest` 增量摘要，从 `currentStepIndex` 续传，避免丢失已有进度。

### 1.2 非目标

- ❌ 不改 M1 的候选稿载体（D1：候选稿=assistant 消息正文，不变）
- ❌ 不给 work-orchestrator 解禁 edit/shell/command（product-mode-agent-policy 已强制 deny）
- ❌ 不解禁 task spawn / TaskDriver delegate（M1.5 不做子会话委派，保持单会话执行；未来需要再解禁）
- ❌ 不解禁 task schedule（非定时任务场景）
- ❌ 不做 TaskDriver background resume（M1.5 是对话级 resume，用户在场）
- ❌ 不做"存为资产"（M2 范围）
- ❌ 不做 DataAnalysis/图表产出（M3 远期）
- ❌ 不新建数据库 migration（Task 表已含 output_digest 列，M2 已落库）
- ❌ 不新建 ProgressLedger Service / 落库（= Task List 子集，纯派生，见 §3.5 D5）

### 1.3 相对 PRD 的收敛

| PRD 描述                                | M1.5 实施收敛                                                                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ProgressLedger 独立 Schema（§9.1）      | **不新建 Schema/Service**，用 `SessionTask.Info[]` + 纯派生函数（`currentStepIndex`/`canResume`）。PRD 的 `ProgressLedger` class 作为视图投影 type alias（见 §3.5 D5） |
| Context Tab 完全对齐 Code 模式（§10.2） | **M1 已完成**：`WorkSessionPanel` 的 Context Tab 渲染 `<SessionContextTab />`（mode-agnostic，442 行），与 Chat/Coding 同组件。M1.5 仅验证无差异，不改代码             |
| 步骤产出摘要 outputDigest               | work-orchestrator 在步骤完成时通过 `task_update`（扩展 outputDigest 字段）写增量摘要；非 TaskDriver 自动回写（因不解禁 spawn）                                         |
| 断点恢复 Resume 按钮（§10.2）           | 对话级 resume：点按钮 -> 发"从断点继续"消息 -> work-orchestrator 读 task list 续传。不走 TaskDriver background                                                         |
| Progress Ledger 进度条常驻中栏          | **复用 `SessionTodoProgress`**（message-timeline.tsx:1725 已挂载，Work 会话走同路径）。work-orchestrator 创建 task 后进度条自动显示，无需新建组件                      |

---

## 2. 背景与当前状态

### 2.1 已就绪基座（全部复用，不新建）

| 能力                                                                                            | 位置                                                                                                                                        | 状态                                                                                                                                                |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task Schema（7 态 + outputDigest + revision + parentID）                                        | [session-task.ts](packages/schema/src/session-task.ts) :39-75                                                                               | ✅ outputDigest 已定义（:49 注释"M1.5: Work ProgressLedger alignment"）                                                                             |
| SessionTask Service（update/append/patch/get/delete/updateTask/reorder/recordProgress/listAll） | [task.ts](packages/core/src/session/task.ts) :128-247                                                                                       | ✅ patch 支持 outputDigest 写入（:813-870）；recordProgress 发 task.progress 事件（:972-988）                                                       |
| TaskTable 持久化（含 output_digest 列）                                                         | [task.ts](packages/core/src/session/task.ts) :281/:850                                                                                      | ✅ M2 已落库                                                                                                                                        |
| 增量 task 工具（create/update/delete/reorder）                                                  | [builtins.ts](packages/core/src/tool/builtins.ts) :13-18/:58-65                                                                             | ✅ 已注册；permission action = 工具注册名（[tool/AGENTS.md](packages/core/src/tool/AGENTS.md) :45「大多数工具默认用注册名作为 permission action」） |
| SDK SessionTaskInfo（含 outputDigest + revision）                                               | [types.gen.ts](packages/sdk/js/src/v2/gen/types.gen.ts) :3700/:3713                                                                         | ✅ 已生成，server-sync 透传                                                                                                                         |
| TaskDriver（delegate/createChild/resume）                                                       | [task-driver.ts](packages/core/src/tool/task-driver.ts) :46-160                                                                             | ✅ 就绪（M1.5 不使用 delegate，仅 resume 概念参考）                                                                                                 |
| App 进度条组件 SessionTodoProgress                                                              | [session-todo-progress.tsx](packages/app/src/pages/session/timeline/session-todo-progress.tsx) :28                                          | ✅ 挂载于 message-timeline.tsx:1725，Work 会话走同路径                                                                                              |
| App 进度纯模型 computeTodoProgress                                                              | [session-todo-progress-model.ts](packages/app/src/pages/session/timeline/session-todo-progress-model.ts) :147                               | ✅ 含 anchor/pulse/progressPct（determinate 停位）                                                                                                  |
| App task store（session_task + session_task_progress）                                          | [server-sync.tsx](packages/app/src/context/server-sync.tsx) :76-88/:261-279                                                                 | ✅ 已有，reconcile key="id"                                                                                                                         |
| Work 右栏双 Tab（Context + Artifact）                                                           | [work-artifact-panel.tsx](packages/app/src/pages/work-artifact-panel.tsx) :200                                                              | ✅ M1 已实现，Context Tab 渲染 SessionContextTab                                                                                                    |
| WorkArtifact Service（apply + work.artifact_applied 事件）                                      | [artifact.ts](packages/core/src/session/artifact.ts)                                                                                        | ✅ M1 已实现，M1.5 不改                                                                                                                             |
| work-orchestrator agent（SYSTEM_PROMPT + 权限）                                                 | [work-orchestrator.ts](packages/core/src/agent/prompt/work-orchestrator.ts) + [plugin/agent.ts](packages/core/src/plugin/agent.ts) :343-360 | ⚠️ 当前 deny task，M1.5 需解禁（见 §3.1）                                                                                                           |

### 2.2 需新建/修改

| 交付物                                  | 位置                                                                                                                 | 动作                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| task_update 工具扩展 outputDigest       | [task-update.ts](packages/core/src/tool/task-update.ts) :14                                                          | 修改：Input 加 `outputDigest` 可选字段                                                                         |
| updateTask Service 扩展 outputDigest    | [task.ts](packages/core/src/session/task.ts) :886                                                                    | 修改：input 加 `outputDigest`，update set 加 `output_digest`                                                   |
| ProgressLedger 派生函数                 | [session-todo-progress-model.ts](packages/app/src/pages/session/timeline/session-todo-progress-model.ts)             | 新增：`computeProgressLedger(tasks)` 纯函数（currentStepIndex + canResume）+ TodoProgressInput 加 outputDigest |
| TodoProgressInput 映射携带 outputDigest | [session-todo-progress.tsx](packages/app/src/pages/session/timeline/session-todo-progress.tsx) :50-58                | 修改：`pickProgressTodos` map 处补 `outputDigest: task.outputDigest`                                           |
| work-orchestrator SYSTEM_PROMPT 步骤化  | [work-orchestrator.ts](packages/core/src/agent/prompt/work-orchestrator.ts)                                          | 修改：增加"拆分步骤 -> task_create -> 逐步执行 -> 完成写 outputDigest -> 中断后读 task list 续传"指引          |
| work-orchestrator 权限解禁 task CRUD    | [plugin/agent.ts](packages/core/src/plugin/agent.ts) :349-360                                                        | 修改：permissions 加 task_create/task_update/task_delete/task_reorder allow                                    |
| Resume 按钮 + outputDigest 展示         | [session-todo-progress.tsx](packages/app/src/pages/session/timeline/session-todo-progress.tsx)                       | 修改：canResume 时显示 Resume 按钮（**仅 work 模式**）；fold-over panel 展示步骤 outputDigest                  |
| i18n 文案                               | [en.ts](packages/app/src/i18n/en.ts) + [zh.ts](packages/app/src/i18n/zh.ts) + [zht.ts](packages/app/src/i18n/zht.ts) | 修改：`work.resume.*` / `work.step.*` 文案（parity 约束 en/zh/zht 三 locale）                                  |

---

## 3. 范围与设计决策

### 3.1 D1：work-orchestrator 工具集扩展

**现状**（plugin/agent.ts:343-360）：`deny *` + `allow read/glob/grep/question/work-preset` + `ask read *.env`，注释明确"no edit/shell/task"。

**M1.5 决策**：

| 工具                        | M1  | M1.5         | 理由                             |
| --------------------------- | --- | ------------ | -------------------------------- |
| task_create                 | ❌  | ✅ allow     | 步骤创建（澄清/构思/撰写/校验）  |
| task_update                 | ❌  | ✅ allow     | 步骤状态推进 + outputDigest 写入 |
| task_delete                 | ❌  | ✅ allow     | 步骤纠错（可选，低频）           |
| task_reorder                | ❌  | ✅ allow     | 步骤重排（可选，低频）           |
| task（TaskDriver delegate） | ❌  | ❌ 保持 deny | M1.5 不做子会话委派              |
| taskspawn                   | ❌  | ❌ 保持 deny | 不嵌套子会话                     |
| taskschedule                | ❌  | ❌ 保持 deny | 非定时场景                       |
| edit/write                  | ❌  | ❌ 保持 deny | D1 候选稿=消息正文不变           |
| shell/command               | ❌  | ❌ 保持 deny | product-mode-agent-policy 已强制 |

**Permission action 名**：task 工具的 action = 工具注册名（`task_create`/`task_update`/`task_delete`/`task_reorder`）。依据 [tool/AGENTS.md:45](packages/core/src/tool/AGENTS.md)「大多数工具默认用注册名作为 permission action；edit/write/apply_patch 共享 `edit` action」。与现有 `work-preset`/`question` 的 allow 写法一致。

**实施要点**：

- permissions 数组在 `deny *` 之后追加 task_create/task_update/task_delete/task_reorder 的 allow（evaluate 取 findLast，顺序与 read/question 一致）
- product-mode-agent-policy.ts 的 `checkCommandAllowed`（:116-121）已 deny shell/command，task 工具不受此限（非 command），**无需改 policy**；若实施时发现 task 工具被 command deny 误伤（预判不会），则补 allow 兜底

### 3.2 D2：ProgressLedger UI = 复用 SessionTodoProgress + Resume 增强

**现状**：`SessionTodoProgress`（session-todo-progress.tsx:28）已挂载于 message-timeline.tsx:1725，Work 会话走同一条 message-timeline 路径。组件从 `serverSync().data.session_task[id]` 读 task，用 `computeTodoProgress` 计算进度条 + fold-over checkbox 列表。

**M1.5 决策**：不新建 ProgressLedger 组件，复用 SessionTodoProgress，仅增强：

- **Resume 按钮**：`canResume`（存在 failed/in_progress 步骤）时，在进度条 stats 旁或 fold-over panel 顶部显示"从断点恢复"按钮。**仅 work 模式显示**（mode-aware），避免污染 Coding/Chat 会话
- **outputDigest 展示**：fold-over panel 的每个步骤项，若该 task 有 outputDigest，展示为步骤摘要副文案（灰色小字）
- **当前节点高亮**：已有 `data-anchor`（anchor = first in_progress），无需改

**理由**：SessionTodoProgress 已是通用 task 进度条，M7 统一轨道几何已定（16px 留白、pulse determinate 停位）。新建并行组件会破坏 M7 统一性，违背"复用优先"。

**基线要求**（[packages/app/AGENTS.md](packages/app/AGENTS.md)）：改 session-todo-progress.tsx 前需录 timeline 生产基准，改动后对比无回归。

### 3.3 D3：outputDigest 填充策略

**现状缺口**：

- `task_update` 工具 Input（task-update.ts:14）只有 id/content/priority/status/expectedRevision，**无 outputDigest**
- `updateTask` Service（task.ts:886）也不支持 outputDigest
- 只有 `patch` Service（task.ts:813）支持 outputDigest，但 patch 只更 status，不更 content

**M1.5 决策**：扩展 task_update 工具 + updateTask Service，加 `outputDigest` 可选字段。

```ts
// task-update.ts Input 扩展
export const Input = Schema.Struct({
  id: Schema.String.annotate({ description: "The task id to update." }),
  content: Schema.optional(Schema.String),
  priority: Schema.optional(SessionTaskSchema.TaskPriority),
  status: Schema.optional(SessionTaskSchema.TaskStatus),
  outputDigest: Schema.optional(Schema.String).annotate({
    description: "Incremental step output summary (Work ProgressLedger). Written when a step completes.",
  }),
  expectedRevision: Schema.optional(Schema.Number),
})

// task.ts updateTask input 扩展
const updateTask = Effect.fn("SessionTask.updateTask")((input: {
  readonly sessionID: SessionSchema.ID
  readonly id: string
  readonly content?: string
  readonly priority?: SessionTaskSchema.TaskPriority
  readonly outputDigest?: string   // 新增
  readonly expectedRevision?: number
}) => // ... update set 加 ...(input.outputDigest !== undefined ? { output_digest: input.outputDigest } : {})
```

**理由**：

- work-orchestrator 不解禁 task spawn（不做委派），所以 TaskDriver 不会自动回写 outputDigest
- work-orchestrator 需要自己在步骤完成时写摘要 -> 必须通过 task_update（唯一暴露给 LLM 的单任务更新工具）
- 扩展而非新建工具（极致减法：复用 > 新增）
- patch 走 status-only 语义，不适合扩展为通用字段更新（会破坏 patch 的 status-only 不变量）

**outputDigest 内容约定**：work-orchestrator 在步骤完成时写一句话摘要（如"已构思 5 个分镜场景，覆盖开场/转折/结尾"），Resume 时作为前序步骤的增量上下文。不写完整候选稿（候选稿在消息正文）。

**测试缺口**：`packages/core/test/` 下当前**无 tool-task-update.test.ts**（仅有 tool-taskwrite.test.ts）。M1.5 必须新建该测试，TDD 红测试先行（见 §5 Phase A）。

### 3.4 D4：Resume 机制 = 对话级 resume

**M1.5 决策**：不走 TaskDriver background resume，采用对话级 resume：

```
用户进入中断的 work 会话
  -> SessionTodoProgress 显示 ProgressLedger（canResume = true）
  -> 进度条旁显示"从断点恢复"按钮（仅 work 模式）
  -> 用户点击按钮
  -> App 复用 composer 发送通道发一条预设消息到当前 session
  -> work-orchestrator 收到消息
  -> SYSTEM_PROMPT 指引：读 task list -> 找 currentStepIndex -> 读前序步骤 outputDigest -> 从该步骤续传
```

**实施要点**：

- Resume 按钮点击 -> 复用 composer 的发送通道发送消息（**不可新建发送路径**）。发送 API 实施时 grep 确认：composer 发送逻辑在 [session-composer-region.tsx](packages/app/src/pages/session/composer/session-composer-region.tsx) 附近，复用其 session.prompt 调用
- 消息文案走 i18n（`work.resume.prompt`），如"请从上次中断的步骤继续，参考已完成步骤的摘要"
- work-orchestrator 的 SYSTEM_PROMPT 增加 Resume 分支指引（见 §4.2）
- task status 不自动重置：failed/in_progress 步骤保持，由 work-orchestrator 决定是否重新标记为 in_progress

**理由**：

- TaskDriver background resume 适用于无用户在场的后台任务；Work 是用户在场的交互式文档生成
- 对话级 resume 复用现有 session.prompt 通道，零新基础设施
- PRD §11 注记"若 Work Resume 未来支持后台执行（无用户在场）...需预授权 ruleset" -- M1.5 不碰这个边界

### 3.5 D5：ProgressLedger Schema = 视图投影，不新建 Service

**PRD §9.1 定义**了 `ProgressLedger` Schema（steps[] + currentStepIndex + canResume）。但注释明确"= Task List 子集"、"派生值不落存储"。

**M1.5 决策**：

- **不新建** ProgressLedger Service / 落库 / 独立事件
- 在 `session-todo-progress-model.ts` 新增纯派生函数：

```ts
/** ProgressLedger view: derived from SessionTask.Info[], never stored. */
export interface ProgressLedgerView {
  readonly currentStepIndex: number // 首个非 completed 步骤索引，-1 if all done
  readonly canResume: boolean // 存在 failed|in_progress 步骤
  readonly steps: readonly {
    readonly stepID: string
    readonly title: string
    readonly status: TodoProgressStatus
    readonly outputDigest?: string
  }[]
}

export const computeProgressLedger = (tasks: readonly TodoProgressInput[]): ProgressLedgerView => {
  const steps = tasks.map((t) => ({
    stepID: t.id ?? "",
    title: t.content,
    status: normalizeStatus(t.status),
    outputDigest: t.outputDigest,
  }))
  const currentStepIndex = steps.findIndex((s) => s.status !== "completed")
  const canResume = steps.some((s) => s.status === "failed" || s.status === "in_progress")
  return { currentStepIndex, canResume, steps }
}
```

- TodoProgressInput 加 `outputDigest?: string` 字段
- **数据流完整路径**（已验证）：SDK `SessionTaskInfo.outputDigest`（types.gen.ts:3700）-> server-sync reconcile 透传（server-sync.tsx:278，key="id" 保留全字段）-> `session-todo-progress.tsx:50-58` 的 `pickProgressTodos` map 补 `outputDigest: task.outputDigest` -> `computeProgressLedger` 消费
- PRD 的 `ProgressLedger` class 作为文档/类型参考，不落代码（或仅作 type alias）

**理由**：极致减法（复用 > 新增）。Task 模型已是 ProgressLedger 的超集，新建并行 Schema 会造成双源真相。

---

## 4. 关键设计

### 4.1 用户主流程（M1.5 增量）

```
用户进入 /mode/work，选预设 -> 创建 mode=work Draft（agent=work-orchestrator）
work-orchestrator 加载 preset guidance
  -> task_create 创建步骤（澄清/构思/撰写/校验）
  -> SessionTodoProgress 自动显示进度条（message-timeline 已挂载）
  -> 逐步执行：
       步骤1 澄清 -> task_update(status=in_progress) -> 问问卷 -> task_update(status=completed, outputDigest="已确认主题/时长/平台")
       步骤2 构思 -> task_update(status=in_progress) -> 构思内容 -> task_update(status=completed, outputDigest="5 个分镜场景")
       步骤3 撰写 -> task_update(status=in_progress) -> 生成候选稿（消息正文）-> task_update(status=completed, outputDigest="双栏分镜表完成")
       步骤4 校验 -> task_update(status=in_progress) -> 检查 -> task_update(status=completed)
  -> 右栏 Artifact Tab 只读预览候选稿 -> 用户点"应用到当前项目" -> 落盘（M1 不变）

中断场景：
  步骤3 撰写中网络中断 -> task 留在 in_progress
  用户重新进入会话 -> ProgressLedger 显示 canResume=true -> "从断点恢复"按钮可见（work 模式）
  用户点击 -> 发"请从中断步骤继续"消息
  work-orchestrator 读 task list -> currentStepIndex=2（撰写）-> 读步骤1/2 的 outputDigest 恢复上下文 -> 续传
```

### 4.2 work-orchestrator SYSTEM_PROMPT 改造

在现有 SYSTEM_PROMPT（work-orchestrator.ts）基础上增加步骤化执行 + Resume 指引：

```
## Workflow（M1.5 步骤化）

1. **Load the task spec**: （现有，不变）
2. **Plan steps**: Before drafting, call `task_create` to create 3-5 execution steps
   (e.g. 澄清需求 / 构思大纲 / 撰写候选稿 / 校验格式). Mark the first step in_progress.
3. **Execute step-by-step**: For each step:
   - `task_update(id, status="in_progress")` before starting
   - Do the step's work (clarify via `question`, draft as message body, etc.)
   - `task_update(id, status="completed", outputDigest="<one-line summary>")` when done
4. **Produce the candidate**: （现有，候选稿=消息正文，不变）
5. **Revise on request**: （现有，不变）

## Resume（M1.5 断点恢复）

If the user asks to resume from an interrupted step:
1. The task list already holds the step states and outputDigest summaries.
2. Read the task list. Find `currentStepIndex` = first non-completed step.
3. Read prior steps' `outputDigest` to recover context without regenerating.
4. Resume from `currentStepIndex`: mark it in_progress and continue.

## Constraints（不变）
- （现有约束全部保留：无 edit/shell/spawn，候选稿=消息正文）
```

### 4.3 Resume 按钮 UI

在 `session-todo-progress.tsx` 增强：

```tsx
// 在 fold-over panel 顶部或 stats 旁，canResume 且 work 模式时显示
<Show when={ledger().canResume && mode() === "work"}>
  <button
    type="button"
    data-component="session-todo-progress-resume"
    onClick={onResume}
  >
    {language.t("work.resume.button")}
  </button>
</Show>

// fold-over panel 步骤项增加 outputDigest 副文案
<Index each={tasks()}>
  {(task) => (
    <CheckboxV2 ... />
    <Show when={task().outputDigest}>
      <span data-slot="step-digest" class="text-text-weak text-12-regular">
        {task().outputDigest}
      </span>
    </Show>
  )}
</Index>
```

**Resume 回调**：复用 composer 的发送通道发送 `work.resume.prompt` 文案。具体发送 API 实施时 grep [session-composer-region.tsx](packages/app/src/pages/session/composer/session-composer-region.tsx) 确认，**不可新建发送路径**。

**mode 信号来源**：实施时确认 `useModeWorkspace` 或现有 mode 信号（session-side-panel.tsx 已用 `mode.currentMode === "work"`），复用而非新建。

### 4.4 Context Tab 对齐验证（M1.5 仅验证不改）

M1 已在 WorkSessionPanel 的 Context Tab 渲染 `<SessionContextTab />`（work-artifact-panel.tsx:235）。M1.5 验收时确认：

- Work 模式下 Context Tab 展示的文件列表、Token 占比、Permission 状态与 Coding 模式一致
- 无 Work 专属差异（SessionContextTab 是 mode-agnostic）
- 若发现差异，记录为 M1.5 遗留项（非阻塞，因 M1 已验收）

---

## 5. 阶段划分（TDD：红 -> 绿 -> 重构，逐 Phase）

每个 Phase 严格三步骤：**先写失败测试 -> 实现最小代码到测试通过 -> 重构去重**。禁止"写完再补测试"。对齐 [M1 TDD 手册](work-mode-m1-tdd-prompt.md) §5 范式。

### Phase A - 契约扩展（估时 1d）

| 步骤     | 内容                                                                                                                                                                                                                                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **红**   | 新建 `packages/core/test/tool-task-update.test.ts`：`task_update` 传 outputDigest 时持久化到 `output_digest` 列 + 事件 payload 携带；不传时不动现有值（向后兼容）。扩展 `packages/app/src/pages/session/timeline/session-todo-progress-model.test.ts`：`computeProgressLedger` 的 currentStepIndex/canResume 派生（含 failed/in_progress/completed 三态组合 + outputDigest 透传） |
| **绿**   | 扩展 `task-update.ts` Input 加 outputDigest；`task.ts` updateTask input + update set 加 `output_digest`；`session-todo-progress-model.ts` 加 `ProgressLedgerView` + `computeProgressLedger` + TodoProgressInput 加 outputDigest；`session-todo-progress.tsx:50-58` map 携带 outputDigest                                                                                          |
| **重构** | 确认 outputDigest 写入复用 patch 的 `output_digest` set 模式（不重复逻辑）；TodoProgressInput 的 outputDigest 映射点唯一（:50-58）                                                                                                                                                                                                                                                |
| **退出** | `bun --cwd packages/core test --timeout 30000` + `bun --cwd packages/app test`（model 单测）绿；`bun --cwd packages/core typecheck` + `bun --cwd packages/app typecheck`（tsgo -b）绿                                                                                                                                                                                             |

### Phase B - Agent 步骤化（估时 2d）

| 步骤     | 内容                                                                                                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **红**   | 扩展 `packages/core/test/product-mode-agent-policy.test.ts`：work 模式下 task_create/task_update/task_delete/task_reorder allow，spawn/schedule/edit/shell 仍 deny。扩展 `packages/core/test/work-orchestrator.test.ts`：SYSTEM_PROMPT 含"Plan steps"+"Resume"两个分支文本结构 |
| **绿**   | `plugin/agent.ts:349-360` permissions 加 4 个 task allow（action = 工具注册名）；`work-orchestrator.ts` SYSTEM_PROMPT 增加步骤化 + Resume 指引（§4.2）                                                                                                                         |
| **重构** | 确认 permissions 顺序在 `deny *` 之后（findLast 语义）；SYSTEM_PROMPT 与 M1 既有结构一致（无冲突）；product-mode-agent-policy 无需改（验证 task 非 command）                                                                                                                   |
| **退出** | policy + work-orchestrator 测试绿；权限单测证明 task CRUD 可调、spawn/edit/shell 仍拒                                                                                                                                                                                          |

### Phase C - Resume UI（估时 2d）

| 步骤     | 内容                                                                                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **红**   | 扩展 `session-todo-progress-model.test.ts`：canResume 时 `computeProgressLedger` 返回 true。新建/扩展组件测试：Resume 按钮 canResume=true 且 work 模式时渲染、=false 或非 work 模式时隐藏（mode-aware）；outputDigest 副文案渲染 |
| **绿**   | `session-todo-progress.tsx` 加 Resume 按钮（`<Show when={ledger().canResume && mode() === "work"}>`）+ outputDigest 展示 + onResume 回调（复用 composer 发送通道，grep 确认）                                                    |
| **重构** | Resume 按钮 UI 全用 v2 token（`--v2-*`，禁硬编码颜色/间距/圆角）；mode 判断复用现有 mode 信号                                                                                                                                    |
| **退出** | 组件测试绿；Resume 按钮 mode-aware（Coding/Chat 不显示）；改 timeline 前后基准对比无回归                                                                                                                                         |

### Phase D - 端到端（估时 1.5d）

| 步骤     | 内容                                                                                                                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **红**   | 扩展 `packages/app/e2e/regression/session-todo-progress.spec.ts`（已有 481 行）：选预设 -> task_create 步骤 -> 中断（模拟 failed 步骤）-> Resume 按钮可见（work 模式）-> 点击 -> work-orchestrator 读 task list 续传（不重复已完成步骤） |
| **绿**   | 端到端联调；修复合并问题                                                                                                                                                                                                                 |
| **重构** | 确认 E2E 复用现有 spec 的 fixture 与断言模式，不新建 spec                                                                                                                                                                                |
| **退出** | 端到端通过；恢复测试达标（Resume 后不重新生成已完成步骤）                                                                                                                                                                                |

### Phase E - 打磨（估时 1d）

| 步骤      | 内容                                                                                                                                                                                                                                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **红/绿** | i18n：`en.ts` + `zh.ts` + `zht.ts` 补 `work.resume.button`/`work.resume.prompt`/`work.step.digest`（**parity.test.ts 约束 en/zh/zht 三 locale**，非全 locale）；埋点：`work_step_resumed` 事件（参考 PRD §12，对齐 `work.artifact_applied` 的事件定义模式 [artifact.ts:32-40](packages/core/src/session/artifact.ts)）；测试补齐 |
| **退出**  | `tsgo -b`（app/desktop）+ `tsgo --noEmit`（core）+ `bun run lint` + 全包 test 绿；parity 通过；改完即审 7 步全过                                                                                                                                                                                                                 |

---

## 6. 关键文件

| 文件                                                                                                                 | 动作 | 说明                                                                                       |
| -------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| [task-update.ts](packages/core/src/tool/task-update.ts)                                                              | 修改 | Input 加 outputDigest 可选字段（:14）                                                      |
| [task.ts](packages/core/src/session/task.ts)                                                                         | 修改 | updateTask input 加 outputDigest + update set（:886-915）                                  |
| [session-todo-progress-model.ts](packages/app/src/pages/session/timeline/session-todo-progress-model.ts)             | 修改 | TodoProgressInput 加 outputDigest；新增 computeProgressLedger + ProgressLedgerView         |
| [session-todo-progress.tsx](packages/app/src/pages/session/timeline/session-todo-progress.tsx)                       | 修改 | :50-58 map 携带 outputDigest；Resume 按钮（mode-aware）+ outputDigest 展示 + onResume 回调 |
| [work-orchestrator.ts](packages/core/src/agent/prompt/work-orchestrator.ts)                                          | 修改 | SYSTEM_PROMPT 增加步骤化 + Resume 指引                                                     |
| [plugin/agent.ts](packages/core/src/plugin/agent.ts)                                                                 | 修改 | work-orchestrator permissions 加 task CRUD allow（:349-360）                               |
| [en.ts](packages/app/src/i18n/en.ts) + [zh.ts](packages/app/src/i18n/zh.ts) + [zht.ts](packages/app/src/i18n/zht.ts) | 修改 | `work.resume.button` / `work.resume.prompt` / `work.step.digest` 文案                      |
| [product-mode-agent-policy.ts](packages/core/src/product-mode-agent-policy.ts)                                       | 验证 | 确认 task 工具不受 checkCommandAllowed deny 影响（预判无需改；若误伤则补 allow 兜底）      |

**不改的文件**（M1 已就绪，M1.5 复用）：

- [artifact.ts](packages/core/src/session/artifact.ts)（WorkArtifact Service + 事件，M1 不变）
- [work-artifact-panel.tsx](packages/app/src/pages/work-artifact-panel.tsx)（右栏双 Tab，M1 不变）
- [session-context-tab.tsx](packages/app/src/components/session/session-context-tab.tsx)（mode-agnostic，M1 已对齐）
- [mode-workspace-slots.tsx](packages/app/src/pages/mode-workspace-slots.tsx)（首页三区块，M1 不变）
- [session-task.ts](packages/schema/src/session-task.ts)（Schema 已含 outputDigest，不改）

---

## 7. 测试策略

### 7.1 扩展现有测试（不新建并行测试）

| 现有测试文件                                                                                                       | 扩展内容                                          |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| [session-task-service.test.ts](packages/core/test/session-task-service.test.ts)                                    | updateTask outputDigest 写入 + 事件 payload 携带  |
| [product-mode-agent-policy.test.ts](packages/core/test/product-mode-agent-policy.test.ts)                          | work 模式 task CRUD allow / spawn/edit/shell deny |
| [work-orchestrator.test.ts](packages/core/test/work-orchestrator.test.ts)                                          | SYSTEM_PROMPT 步骤化 + Resume 分支结构            |
| [session-todo-progress-model.test.ts](packages/app/src/pages/session/timeline/session-todo-progress-model.test.ts) | computeProgressLedger 派生 + outputDigest 透传    |
| [session-todo-progress.spec.ts](packages/app/e2e/regression/session-todo-progress.spec.ts)                         | Resume 端到端场景（选预设->中断->恢复）           |

### 7.2 新建测试

| 新建测试文件                                  | 覆盖                                                      |
| --------------------------------------------- | --------------------------------------------------------- |
| `packages/core/test/tool-task-update.test.ts` | task_update 工具 outputDigest 写入 + 向后兼容（不传不动） |

### 7.3 命令（CLAUDE.md / AGENTS.md 测试规范，永不从根跑）

```bash
bun --cwd packages/core test --timeout 30000
bun --cwd packages/app test
bun --cwd packages/core typecheck      # tsgo --noEmit
bun --cwd packages/app typecheck       # tsgo -b
bun run lint
```

### 7.4 三模式选择（AGENTS.md Testing）

| 模式          | 用于                                                                           |
| ------------- | ------------------------------------------------------------------------------ |
| `it.effect`   | SessionTask Service updateTask、policy 权限判定、work-orchestrator prompt 结构 |
| `it.live`     | 真实时间/事件发布顺序                                                          |
| `it.instance` | 真实 tmpdir + 实例（若涉及落盘验证）                                           |

### 7.5 硬性规则

- 用 `testEffect(...)`（`packages/aigcfroge/test/lib/effect.ts`）不要手写 runtime；`Layer.mock` 代替手写 stub
- 禁止 `Effect.sleep(N)` 等 fiber--用 readiness 信号（`pollWithTimeout`/`Deferred`/`SessionStatus`）
- 禁止 `as any`、`@ts-ignore`（类型负测试用 `@ts-expect-error` 且注明原因）
- 测试实际实现，不把逻辑复制进测试

---

## 8. 验收清单

- [ ] work-orchestrator 执行时调用 task_create 创建 3-5 步骤，SessionTodoProgress 自动显示进度条
- [ ] 步骤推进时 task_update 写 status + outputDigest，进度条 anchor 高亮当前步骤
- [ ] 步骤完成时 outputDigest 展示在 fold-over panel 步骤项副文案
- [ ] 中断后重新进入会话，ProgressLedger 显示 canResume，"从断点恢复"按钮可见（**仅 work 模式**）
- [ ] 点击 Resume -> 发送续传消息 -> work-orchestrator 读 task list 从 currentStepIndex 续传
- [ ] Resume 后不重新生成已完成步骤（依赖 outputDigest 恢复上下文）
- [ ] Context Tab 与 Coding 模式一致（文件列表/Token/Permission）
- [ ] work-orchestrator 仍无 edit/shell/spawn 权限（权限测试）
- [ ] Coding/Chat 会话不显示 Resume 按钮（mode-aware 验证）
- [ ] 埋点 `work_step_resumed` 上报
- [ ] en/zh/zht i18n parity 通过
- [ ] typecheck + lint + test 全绿

---

## 9. 估算

| Phase          | 估时     |
| -------------- | -------- |
| A 契约扩展     | 1d       |
| B Agent 步骤化 | 2d       |
| C Resume UI    | 2d       |
| D 端到端       | 1.5d     |
| E 打磨         | 1d       |
| **总计**       | **7.5d** |

（M1 为 12.5d；M1.5 复用居多，范围更小）

---

## 10. 风险与应对

| 风险                                                                       | 概率 | 影响 | 应对                                                                               |
| -------------------------------------------------------------------------- | ---- | ---- | ---------------------------------------------------------------------------------- |
| work-orchestrator 步骤拆分质量不稳定（步骤过粗/过细）                      | 高   | 中   | SYSTEM_PROMPT 给明确步骤范式（澄清/构思/撰写/校验）+ outputDigest 摘要约束一句话   |
| Resume 后 LLM 不读 outputDigest 直接重新生成                               | 中   | 中   | SYSTEM_PROMPT 强约束"Resume 必须先读 task list + outputDigest"；E2E 验证不重复生成 |
| task_update 扩展 outputDigest 影响其他模式（Chat/Coding 也用 task_update） | 低   | 中   | outputDigest 是可选字段，现有调用方不传则不写，向后兼容；Core 单测覆盖             |
| **SessionTodoProgress 是通用组件，Resume 按钮污染 Coding/Chat**            | 中   | 中   | Resume 按钮 mode-aware（`mode() === "work"` 守卫）；组件测试覆盖非 work 模式不渲染 |
| Resume 按钮发送消息的 API 与 composer 不一致                               | 中   | 低   | 实施时 grep session-composer-region.tsx 确认发送通道，复用而非新建                 |
| outputDigest 摘要质量差导致 Resume 上下文丢失                              | 中   | 中   | M1.5 接受（LLM 可重新读消息历史补全）；M2 存为资产时转持久化                       |
| Context Tab 实际有 Work 专属差异                                           | 低   | 低   | M1 已验收，M1.5 仅验证；发现差异记遗留项                                           |

---

## 11. 技术债声明

| 负债                                                                 | 风险                                                            | 到期                                                   |
| -------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| outputDigest 由 work-orchestrator 自写摘要（非 TaskDriver 自动回写） | 摘要质量依赖 LLM；未来若解禁 spawn 委派，需改用 TaskDriver 回写 | M2/M3 视需求                                           |
| Resume 是对话级（需用户在场）                                        | 不支持后台无用户恢复                                            | 未来若 PRD 要求后台 resume，再接 TaskDriver background |
| ProgressLedger 不落库（= Task List 子集，Task 落库）                 | 跨刷新 task 保留，但 outputDigest 若 LLM 未写则为空             | M2 存为资产时补                                        |

---

## 12. 关联文档

- [Work PRD v4.1](../prd/work-mode-execution-layer.md) - §9.1 ProgressLedger 契约、§10.2 Resume 交互（范围真源）
- [Work 路线图](work-mode-roadmap.md) - §3.3 M1.5 阶段定义
- [Work M1 计划](work-mode-execution-layer-m1.md) - 前置阶段（已合入 main `a041ca617`）
- [M1 TDD 手册](work-mode-m1-tdd-prompt.md) - TDD 红绿重构范式参考
- [Todo/Task 升级计划](todo-task-system-upgrade.md) - Task 模型地基（已合入 main）
- [ADR-13](../architecture/adr/ADR-13-chat-work-mode-boundary.md) / [ADR-14](../architecture/adr/ADR-14-persistence-and-scope-strategy.md) / [ADR-15](../architecture/adr/ADR-15-mode-workspace-main-area-slot.md) - 架构边界
