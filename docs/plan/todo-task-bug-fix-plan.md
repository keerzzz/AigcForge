# TODO 子系统 BUG 修复计划

> 背景：TODO 功能 BUG 审查（2026-08-07）后的实施计划。取证报告基于 packages/core、packages/aigcfroge、packages/app 的逐文件核实。

## 范围约定（用户已拍板）

- 不考虑 V1 兼容，数据可丢 → V1 todo **逻辑移除**：读写收敛到 TaskTable 单一数据源。
- CLI（含 `packages/tui`）后期整体移除 → TUI/CLI 相关 bug 一律不修（TUI hydration 竞态、插件桥降级、CLI 渲染归类错误均跳过）。
- fork 复制任务；revert 不动任务状态（接受 spawned_from 悬空，UI 已有降级）。
- 只保桌面端（packages/app + server）。

## 修复项与取证结论的对应

| # | 问题 | 证据 | 处置 |
|---|---|---|---|
| 1 | replaceLegacy 尾部删除误杀其它路径新增 task | core/src/session/task.ts:799-801 | 修（语义见下方选项） |
| 2 | 非调度 in_progress 崩溃后永久滞留 | core/src/session/scheduled-job.ts:77-96 | 修：启动恢复扫描扩到非调度行 |
| 3 | CLI/judge 委派 settle 有洞 | core/src/tool/task.ts:221-246, 266-285 | 修：settle 改 ensuring；judge 接 parent_task_id |
| 4 | V2→V1 切换 GET /todo 读陈旧数据 | handlers/session.ts:119-129 | 修：V1 收敛后分叉自然消失 |
| 5 | fork 不复制任务 | handlers/session.ts:446-471 | 修：fork 后复制任务 |
| 6 | revert 与 task 脱钩 | core/src/session.ts:454-457 | 不修（用户决策） |
| 7 | todowrite 吞错误 + 回显输入 | core/src/tool/todowrite.ts:47-49 | 修：错误透传 + 返回 reconcile 后状态 |
| 8 | replaceLegacy preserve 方向反转 | task.ts:775-784 vs 550-559 | 修：统一为输入优先 |
| 9 | TUI hydration 竞态 | tui/src/context/sync.tsx | 跳过（TUI 将移除） |
| 10 | app reconcile({key:"id"}) 于无 id 列表 | app/.../event-reducer.ts:204, directory-sync.ts:537,552 | 修 |
| 11 | append 不查重 → PK 冲突 500 | task.ts append | 修：duplicate 校验 |
| 12 | status 值域失控（V1 无校验 / V2 静默降级 / failed checkbox） | 多处 | 修：输入侧严格 Literal + app 禁用 failed checkbox |
| 13 | todo.updated 三份定义 + 死定义 | core/session/todo.ts:27-35 | 修：删死定义 |
| 14 | 陈旧注释 / 孤儿 API | session-todo-progress-model.ts:110-111 | 顺带修注释；SessionTask.delete 保留不动 |

---

## Phase 1：core 写路径语义（packages/core）

### 1.1 replaceLegacy 统一 preserve 方向（#8）
- `packages/core/src/session/task.ts:779-784`：`prior?.x ?? task.x` 全部改为 `task.x ?? prior?.x`，与 `update`(:550-559) 及 `hasDeadSchedule`(:377-378) 的输入优先方向一致。
- 对现有唯一调用方（SessionTodo.toTask 只传三字段，其余恒 undefined）行为不变，delegation/scheduler 写入的字段仍被保留。

### 1.2 replaceLegacy 增加乐观锁（#1，已选选项 B）
- `packages/core/src/session/task.ts` 的 `replaceLegacy`：入参增加 `expectedRevision?: number`；事务内计算 existing 的 maxRevision，与 expectedRevision 不一致时返回 `TaskWriteError({ reason: "stale_revision" })`（与 update:465-472 同模式）。尾部删除逻辑（:799-801）本身不变——冲突由守卫拦截而非豁免。
- `packages/core/src/session/todo.ts` 的 `SessionTodo.update` 维护「上次 legacy 全量写基线」（模块级 `Map<sessionID, maxRevision>`，进程内即可，与 writeLock 同生命周期）：
  1. 先 `tasks.get` 计算当前 maxRevision（空表为 0）；
  2. 基线存在且 ≠ 当前 maxRevision → 说明上次 todowrite 之后有其它路径（taskspawn/taskschedule/HTTP/patch）写过 → 失败 `stale_revision`；
  3. 否则以当前 maxRevision 作为 `expectedRevision` 调 `replaceLegacy`（防御读-写间隙的并发）；
  4. 成功后将基线更新为 resolved 列表的新 maxRevision。
- `core/src/tool/todowrite.ts`：捕获 `stale_revision` 时先 `SessionTodo.get` 拉当前服务端列表，ToolFailure message 携带该列表 JSON 与「合并后重试」的明确指示，模型据此自我纠正。其它 TaskWriteError reason 也分别给出可读消息（见 1.4）。
- 进程重启后基线为空 → 该 session 的首次 todowrite 直接放行并重建基线（单进程桌面场景可接受）。

### 1.3 append 增加 duplicate 校验（#11）
- append 事务内：payload id 与 existing 全表及 payload 内部查重，命中返回 `TaskWriteError({ reason: "duplicate" })`（与 update:539 同模式），避免 PK 冲突被 orDie 成 500 defect。

### 1.4 todowrite 错误透传 + 返回 reconcile 后状态（#7）
- `packages/core/src/session/todo.ts`：`SessionTodo.Interface.update` 返回值从 `void` 改为 reconcile 后的 `ReadonlyArray<Info>`（由 replaceLegacy 的 resolved 投影）。
- `packages/core/src/tool/todowrite.ts:47-49`：
  - 返回服务端 reconcile 后的列表，不再回显 `input.todos`。
  - 错误映射细分：`TaskWriteError` → `ToolFailure`（message 含 reason 与人类可读说明，如 invalid_schedule / depends_on_cycle）；权限错误保持原样传播；其余仍兜底 "Unable to update todos"。
- 同步调整 `SessionTodo.layer` 实现与测试。

### 1.5 输入侧 status/priority 严格校验（#12 输入半）
- core 侧：`todowrite.ts` 的 `Input` 不再直接复用 `SessionTodo.Info`（Info 同时是 GET /todo 的响应 schema，需保持宽松 String 以容纳投影直通的 scheduled/failed）。新增内部 `WriteItem` schema：status = `Schema.Literal("pending","in_progress","completed","cancelled")`，priority = `Schema.Literal("high","medium","low")`。模型传非法值会得到 schema 校验错误，可自我纠正。
- `core/src/session/todo.ts`：`Interface.update` 入参改用 WriteItem；`toTask` 中 `STATUS_MAP[..] ?? "pending"` / `?? "medium"` 降级逻辑随之成为死代码，删除（类型保证收敛）。
- 投影侧（`toTodo` 直通 scheduled/failed）保持现状：桌面 app 已六态兼容，SDK 类型为 string。

### 1.6 删除死事件定义（#13）
- 删 `core/src/session/todo.ts:27-35` 的 `SessionTodo.Event.Updated`（无发布方）。
- `core/test/session-todo.test.ts:48` 改为引用 `SessionTask.Event.TodoUpdated.type`（它实际匹配的就是该事件）。

---

## Phase 2：生命周期一致性（packages/core）

### 2.1 启动恢复扫描扩到非调度 in_progress（#2）
- `core/src/session/scheduled-job.ts`：daemon 启动处（:228 `arm(now, { recover: true })`）之前，新增一次 sweep：查出 `status = "in_progress"` 且 `scheduled_at IS NULL AND recurrence IS NULL` 的行，逐条 `tasks.patch({ status: "pending" })`（走 patch 以发事件 + bump revision）。
- 放在 arm 之前，保证调度行的 recover 逻辑（:93-96）不受影响；单进程假设与 writeLock 注释（task.ts:389-396）一致。

### 2.2 委派 settle 闭环（#3）
- `core/src/tool/task.ts:221-246`（CLI 委派）：把 track-B task 的 settle patch 从「成功返回后顺序执行」改为 `Effect.ensuring`/`Effect.exit` 驱动的 finalizer（复用 track-B :320-335 的分类逻辑：成功→completed、中断→cancelled、错误→failed），覆盖 CliUnavailableError 与父 session abort 路径。
- judge 委派（:266-285）：当 `input.parent_task_id` 存在时，执行前后对父 task 做 in_progress → 终态 patch（复用同一 settle helper）；不存在时行为不变。

### 2.3 fork 复制任务（#5）
- `aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts` 的 `fork` handler（:446-471）：两条分支（V2 :450-463 / V1 :465-470）拿到 child 后，统一执行：
  - `SessionTask.get(源 sessionID)`；
  - 对 child 调 `SessionTask.update`，tasks 映射为 `{ content, status: status === "in_progress" ? "pending" : status, priority }`——**丢弃** id、spawned_from、depends_on、parent_id、scheduled_at、recurrence、agent_id（避免悬空引用与 fork 副本重复触发调度）。
  - update 会为 child 发 task.updated/todo.updated，前端自动刷新。

---

## Phase 3：V1 逻辑移除（packages/aigcfroge）

### 3.1 V1 Todo.Service 收敛到 TaskTable
- `aigcfroge/src/session/todo.ts`：删除 DB 直连（:47-71 的 delete-all+insert、:73-86 的 select），改为委托 `SessionTask.Service`：
  - `update` → `SessionTask.replaceLegacy`（复用 core SessionTodo 的映射逻辑；入参校验见 3.2）；**不再自行 publish**（SessionTask.publishBoth 已发 task.updated + todo.updated，进程内 EventV2 总线与运行时无关，SSE 订阅不受影响）。
  - `get` → `SessionTask.get` + 三字段投影。
  - layer 依赖从 `EventV2Bridge + Database` 改为 `SessionTask`（参照 `core/src/session/todo.ts:96-97` 的 defaultLayer/node 写法）。调用点 `tool/registry.ts:365`、`effect/app-runtime.ts:216` 的 `Todo.defaultLayer` 名字不变、无需改。

### 3.2 V1 工具输入严格化
- `aigcfroge/src/tool/todo.ts:15-25`：TodoItem 的 status/priority 改 Literal（同 1.5）；错误映射细分 TaskWriteError reason。
- `tool/todowrite.txt` 提示词无需改（本就只写这四个状态）。
- 更新 `test/tool/parameters.test.ts` 快照（`bun --cwd packages/aigcfroge test --timeout 30000` 后按快照流程更新）。

### 3.3 GET /todo 单一路径（#4）
- `handlers/session.ts:119-129`：删除 `AIGCFROGE_V2_RUNTIME` 分叉与 V1 注释，统一走 `SessionTodo.Service.get`。
- 若 `todoSvc`（:77 取的 V1 Todo.Service）在该文件无其它用途，一并移除其注入与 :800 附近的注册。

### 3.4 不做的事
- 不 drop `todo` 表、不删 V1 文件外壳（deprecated 标注已在；物理删除留给 M5）。V1 prompt 循环的 todowrite 功能经收敛层保持可用。

### 3.5 测试更新
- `aigcfroge/test/server/httpapi-session.test.ts:1321-1347`（直插 TodoTable 断言 GET /todo）重写为经 SessionTask/工具写入后断言；fork 相关断言（:359）补任务复制断言。

---

## Phase 4：桌面 app 前端（packages/app）

### 4.1 无 id 列表禁用 reconcile({key:"id"})（#10）
- `app/src/context/global-sync/event-reducer.ts:204`：改为直接 `input.setStore("todo", props.sessionID, props.todos)`。
- `app/src/context/directory-sync.ts:537,552`：同样改为直接替换。
- 旧 store 消费者仅存在性检查（pages/session.tsx:579）与 seed（directory-sync.ts:527-531），行为不受影响；与新 store（session-todo.ts:4-13 确立的不变量）对齐。

### 4.2 failed 任务禁用 checkbox（#12 投影半）
- `app/src/pages/session/timeline/session-todo-progress.tsx:298-303`：禁用列表（现有 cancelled/scheduled/无 id）补 `failed`，杜绝 failed → completed 的误跃迁。
- 顺带修正 `session-todo-progress-model.ts:110-111` 与代码矛盾的注释（#14）。

---

## Phase 5：验证

按 AGENTS.md：测试不可从仓库根运行，逐包执行。

1. `bun --cwd packages/core test --timeout 30000`（重点：session-todo / tool-todowrite / session-task-service / scheduled-job / tool-task 相关测试文件）。
2. `bun --cwd packages/aigcfroge test --timeout 30000`（重点：server/httpapi-session、tool/parameters 快照）。
3. app 包对应单测（event-reducer / session-todo-progress 相关）。
4. `bun typecheck`（仓库根，turbo 全量）。
5. 新增测试覆盖：
   - replaceLegacy 尾部删除豁免子系统行（spawned_from/scheduled_at/recurrence/agent_id 非空行保留）；preserve 输入优先。
   - append 重复 id → duplicate 错误。
   - 启动 sweep 将非调度 in_progress 重置为 pending。
   - todowrite：schema 拒绝非法 status；TaskWriteError reason 透传；返回 reconcile 后状态。
   - fork 后 child 任务列表 = 父任务三字段投影（in_progress→pending，无 schedule/spawned_from）。
   - V1 收敛：默认 runtime 下 todowrite 写入后 GET /todo 与 GET /task 一致。

## 风险与注意

- V1 收敛后事件链路从 EventV2Bridge 改为 SessionTask 直发 EventV2：需用 httpapi-session 测试确认默认 runtime 下 SSE 仍能收到 todo.updated。
- 输入 schema 收紧会影响 parameters 快照与任何按自由字符串调用的第三方插件——可接受（开发期、桌面端优先）。
- Phase 3 依赖 Phase 1 的 replaceLegacy 语义（1.1/1.2），按顺序执行。

## replaceLegacy 误杀修复的语义选择（已定：选项 B）

- **选项 A（未选）**：尾部删除豁免子系统拥有的行。模型契约不变、无重试负担；代价是纯三字段的 UI 手建任务仍会被模型全量替换覆盖。
- **选项 B（已选，即 1.2）**：replaceLegacy 增加 expectedRevision 乐观锁 + SessionTodo 维护上次全量写基线，stale 时把当前服务端列表随错误返回让模型合并重试。
