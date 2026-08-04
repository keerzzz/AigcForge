# AigcForge Differential Review — `todo-task-m2` M2–M7

> Review date: 2026-08-03  
> Baseline: `main` (`ef454564f`)  
> Head: `todo-task-m2` (`ce4638108`)  
> Scope: 47 commits, 118 files, +8,912 / -1,868 lines

## 1. Executive Summary

| Severity | Count |
|---|---:|
| CRITICAL | 0 |
| HIGH | 5 |
| MEDIUM | 3 |
| LOW / Gate | 2 |

**Overall risk:** HIGH  
**Recommendation:** **REJECT — 不批准合并。**

核心原因不是测试数量不足，而是五层契约之间存在可复现断裂：六态 Task 被 App 四态回写破坏、缓存快照通过全量 reconcile 删除并发新增任务、调度中断留下永久 `in_progress`、领域层允许无触发器的“定时任务”、`task_spawn` 对外宣称执行但实际只写一条不会运行的记录。

## 2. What Changed

五层影响链：

1. **Schema / DB** — Task 六态、schedule/spawn/DAG 字段、3 个迁移。
2. **Core domain** — SessionTask reconcile/append/patch、cron、ScheduledJobRunner、DAG、Permission。
3. **HTTP / SDK** — session task GET/PATCH、跨 session `/agent-task`、SDK 生成物。
4. **App / TUI** — SessionTodoProgress、scheduled popover、Agent Hub、TUI TaskItem/task store。
5. **Tests** — Core、HttpApi、App unit/E2E、TUI、migration tests。

## 3. Blocking Findings

### HIGH-1: App 全量回写会把 `scheduled` / `failed` 静默改成 `pending`

**Files:**
- `packages/app/src/pages/session/timeline/session-todo-progress-model.ts:66-75`
- `packages/app/src/pages/session/timeline/session-todo-progress.tsx:134-155`
- `packages/core/src/session/scheduled-job.ts:79-83`

`TaskStatus` 是六态，但进度面板模型只承认四态，任何未知态都归一为 `pending`。用户勾选任意一项时，组件对**整张列表**再次调用 `normalizeStatus` 后 PATCH，因此未被点击的 `scheduled` 与 `failed` 任务也被改写。

可复现场景：

1. Session 中有普通任务 A，以及一个已失败、仍保留 recurrence 的任务 B。
2. 用户只勾选 A。
3. B 的 `failed` 在 PATCH body 中变为 `pending`。
4. 服务端 preserve-omitted 保留 B 的 recurrence。
5. daemon `arm` 接受 `pending` + recurrence，B 被意外重新调度。

这破坏了 M3 声明的“recurring failed 后停跑、需人工 resume”语义，也会改变无关任务状态。

**Introduced by:** `0b6845062`, `056e00430`  
**Test gap:** unit/E2E 没有覆盖含 `scheduled` 或 `failed` 的 fold-over writeback。

**Required fix:** App 写回必须完整保留非目标任务的六态；目标状态转换也必须对六态显式裁决。不要在持久化写路径使用“非法态 → pending”的显示降级函数。

---

### HIGH-2: 基于缓存的全列表 PATCH 会删除并发新增任务

**Files:**
- `packages/app/src/pages/session/timeline/session-todo-progress.tsx:134-155`
- `packages/app/src/pages/session/timeline/agent-task-hub.tsx:131-195`
- `packages/app/src/pages/session/timeline/session-scheduled-tasks.tsx:79-100`
- `packages/core/src/session/task.ts:231-232,352-355`

三个新 UI 都从客户端缓存构造全量列表，再调用 `SessionTask.update`。服务端把 payload 当作权威快照并删除所有 absent rows。

可复现场景：

1. 客户端缓存只有 A。
2. 后台 subagent / `task_spawn` 已 append B，但 SSE 尚未到达客户端。
3. 用户切换 A；客户端 PATCH `[A]`。
4. `SessionTask.update` 读取 `[A,B]`，因 B 不在 retained set 中而删除 B。

这绕过了 `append` 专门保证的并发安全，并造成静默数据丢失。Agent Hub 的跨 session 缓存更容易陈旧，风险更高。

**Required fix:** 单项状态切换、删除、创建必须使用服务端原子单项 mutation；至少加入版本/updatedAt 条件和冲突返回。不能用客户端快照模拟 patch。

---

### HIGH-3: daemon 中断后任务永久停在 `in_progress`，重启不会恢复

**Files:**
- `packages/core/src/session/scheduled-job.ts:110-165`
- `packages/core/test/scheduled-job.test.ts:244-275`

trigger 先持久化 `in_progress`。interrupt-only cause 被直接传播，不执行 settle；测试明确断言任务保留 `in_progress`。但 startup `arm` 只加载 `scheduled` / `pending`，因此进程关闭或 daemon scope 中断后，该任务永久丢出调度队列。

这与同文件“no orphan `in_progress`”及“restart re-arm”描述冲突。

**Introduced/refined by:** `4f300f3c6`  
**Required fix:** 设计可恢复 claim（lease/attempt identity/heartbeat）或在确认 child 已停止后原子回退到可重试状态。仅把 interrupt 映射为 failed 也不充分，因为会混淆停机与真实执行失败。

---

### HIGH-4: 领域层未维护“scheduled 必须有有效 trigger”的不变量

**Files:**
- `packages/core/src/session/task.ts:284-307,400-408`
- `packages/core/src/tool/taskschedule.ts:73-100`
- `packages/core/src/session/scheduled-job.ts:71-83`

当前写路径只校验“存在 recurrence 时 cron 是否可求 nextRun”，没有校验：

- `status === "scheduled"` 时必须存在 enabled recurrence 或 finite `scheduledAt`；
- disabled recurrence 必须有 one-shot fallback；
- `resume` 的目标必须原本就是有 trigger 的 scheduled task。

因此 HTTP PATCH 可以创建 `scheduled` 但没有 trigger 的永久死任务；`task_schedule resume` 也能把普通 task 改成 `scheduled`，而 `arm` 永远不会把它加入 queue。

**Test gap:** 现有测试只覆盖正常 scheduled task 的 pause/resume，以及 malformed cron；没有覆盖 scheduled-without-trigger、disabled recurrence without fallback 的直接 domain/HTTP 写入。

**Required fix:** 把 schedule invariant 收敛到 `SessionTask.update/append/patch` 的领域边界，tool/UI 仅做前置 UX 校验。

---

### HIGH-5: `task_spawn` 的公开契约宣称会运行 Agent，但实现只创建不会执行的 pending row

**Files:**
- `packages/core/src/tool/taskspawn.ts:13-24,43-70`
- `specs/v2/todo.md:133-137`

Input 描述为“Prompt the spawned agent runs”，工具名和说明也表达 spawn/delegation；实际 execute 只调用 `SessionTask.append`，没有 TaskDriver、没有 child Session、没有 schedule 字段。规范限制又确认“本期不触发调度”。

结果是模型调用成功后得到一个长期 pending 记录，但没有 Agent 会执行 prompt。该行为与计划中的“一次性委派”及工具对模型的描述不一致，违反“声明风险不能替代真实行为说明”。

**Required fix:** 二选一：

1. 复用现有 `TaskDriver` 实现真实一次性委派并结算 task；或
2. 明确重命名/重写 tool contract 为“仅记录 derived task”，不得描述为 Agent 会运行。

## 4. Medium Findings

### MEDIUM-1: 跨 session DAG 在写入检查与运行时解析之间语义不一致，可形成永久环

- cycle check 只读取目标 session：`packages/core/src/session/task.ts:249-271`。
- trigger 却按全局 task id 查询 predecessor：`packages/core/src/session/scheduled-job.ts:97-106`。

因此 session A 的 task 可依赖 session B，B 再依赖 A；两次写入都看不到跨 session 环，运行时双方却互相阻塞。规范声明允许跨 session 引用，但没有覆盖跨 session cycle hole。

**Required fix:** 要么依赖严格 session-scoped，并在写入时验证 ownership；要么把 cycle detection 与运行时解析统一成同一个全局图和原子事务边界。

### MEDIUM-2: cron 计算是同步逐分钟扫描，读取路径可被线性放大

**Files:**
- `packages/core/src/session/schedule.ts:80-99`
- `packages/core/src/session/task.ts:171-193,576-580`

`nextRun` 最多创建 525,600 个 `Date`，并在 `get/listAll/task.updated` 映射中对每个 recurring task 重算。实测本机：

- `0 0 1 1 *`：约 47.6ms/task
- `0 0 29 2 *`：约 111.8ms/task
- `0 9 1 * 1`：约 53.2ms/task

跨 session Agent Hub 的 `listAll` 会线性叠加；unbounded task array 可把一次 HTTP/tool 操作放大到秒级，并阻塞单进程事件循环/数据库事务。

此外 `timezone` 字段未被使用，day-of-month/day-of-week 是 AND 而非标准 cron OR；虽然 specs 已声明限制，但源码仍称“standard 5-field cron”。

**Required fix:** 使用字段跳跃/预编译算法或经验证的现有 cron 实现；限制批量输入；统一文档与公开契约。

### MEDIUM-3: Agent Hub 全量刷新不清理服务端已不存在的 session/task bucket

**File:** `packages/app/src/pages/session/timeline/agent-task-hub.tsx:89-100`

`GET /agent-task` 返回后只 set 本次出现的 session，不删除旧 store key。断线漏事件、task 全删或 session 已删除后，重新打开 Hub 仍可能显示 stale task；后续全量 PATCH 会报 foreign id，或与 HIGH-2 组合造成错误删除。

**Required fix:** 将 `/agent-task` 响应作为原子 snapshot 替换跨 session task store，明确清理 absent session buckets。

## 5. Gate / Process Findings

### GATE-1: `bun run lint` 失败

Incremental lint 报新增违规：

- `packages/app/src/pages/session/timeline/session-todo-progress.tsx:126:22`
- `typescript-eslint(no-unsafe-type-assertion)`

因此工程门禁不是全绿，当前分支不能按 CLAUDE/AGENTS 协议批准。

### GATE-2: 分支存在未来时间戳与未来完成日期

当前日期是 **2026-08-03**，但以下提交记录为 2026-08-04：

- `9dae2d5fb` — 2026-08-04 00:25:57 +08:00
- `3172e0fb9` — 2026-08-04 02:49:01 +08:00
- `ce4638108` — 2026-08-04 02:49:08 +08:00

`docs/plan/todo-task-system-upgrade.md` 与 `specs/v2/todo.md` 也使用 2026-08-04 作为已完成日期。需修正系统时钟/commit metadata/文档日期，否则审批时间线不可审计。

## 6. Test Coverage Analysis

### Passed

- Typecheck: `core`, `aigcfroge`, `app`, `tui`, `plugin`, `schema`, `sdk/js` 全部通过。
- Core: 1,470 pass / 0 fail。
- App unit + virtualizer: 617 pass / 0 fail。
- TUI: 201 pass / 1 skip / 0 fail。
- Schema: 39 pass / 0 fail。
- Targeted Playwright: 16 pass / 0 fail。
- SDK regeneration: success，工作树无生成漂移。
- `git diff --check`: pass。

### Failed / incomplete

- Full `packages/aigcfroge` suite: 3,148 pass / 22 skip / 1 todo / **1 fail**。
- Failing test: `test/mcp/lifecycle.test.ts` — `McpOAuthCallback.cancelPending...`。
- 该失败文件与实现不在本分支 diff，定向重跑仍失败，判断为 baseline/pre-existing gate failure；不是本分支回归证据，但全量门禁仍为红。
- `bun run lint`: **failed**，且包含本分支新增 violation。

### Missing regression tests

1. Progress writeback preserves `scheduled`/`failed` on unrelated tasks。
2. UI stale snapshot vs concurrent append does not delete new task。
3. Interrupted scheduled job is recoverable after restart。
4. scheduled-without-trigger rejected at domain + HTTP + tool boundaries。
5. Cross-session dependency cycle rejected or explicitly isolated。
6. Agent Hub refresh clears absent session buckets。
7. `task_spawn` contract test proves execution, or proves/document record-only semantics。

## 7. Blast Radius

| Area | Blast radius | Risk |
|---|---|---|
| `SessionTask.update` full reconcile | HTTP PATCH、Progress、Scheduled popover、Agent Hub、tool remove | HIGH |
| status normalization | Every interactive task-list write | HIGH |
| ScheduledJob claim/recovery | Every one-shot/recurring job across process restarts | HIGH |
| schedule invariant | HTTP、tool、App create/resume、daemon arm | HIGH |
| DAG scope | Every scheduled task with `dependsOn` | MEDIUM/HIGH |
| `nextRun` | write validation、read endpoints、events、Hub aggregation、daemon arm | MEDIUM/HIGH |

## 8. Required Actions Before Re-review

1. 修复 HIGH-1～HIGH-5，并补对应回归测试。
2. 用原子单项 task mutation 替换 UI 全列表 reconcile；若暂不改 API，至少增加 optimistic concurrency guard，不能静默删行。
3. 统一 schedule claim/restart recovery 设计，证明无永久 `in_progress`。
4. 统一 DAG ownership/cycle boundary。
5. 修复 incremental lint。
6. 修正未来时间戳/文档日期。
7. 对 baseline MCP test 失败给出明确豁免或先修复，确保审批门禁有可复现的绿色基线。

## 9. Methodology

**Strategy:** FOCUSED differential review with deep analysis on high-risk domain paths。

- 逐文件盘点 118 个 changed files；深审 79 个 changed production TS/TSX。
- 按五层追踪 Schema/DB → Core → HTTP/SDK → App/TUI → tests。
- 使用 git blame/commit history 定位引入提交。
- 检查权限、调度、并发、状态机、重启恢复、数据一致性和公开契约。
- 运行类型检查、全包/定向测试、Playwright、lint、SDK regeneration、diff check。

**Confidence:** HIGH for the blocking findings; MEDIUM for performance magnitude across production-scale datasets。
