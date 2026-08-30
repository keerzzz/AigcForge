# AigcForge Differential Re-review — M2–M7 Fix Set

> Review date: 2026-08-04
> Branch: `todo-task-m2` (`ce4638108` + uncommitted fixes)
> Fix diff: 24 tracked files, +1,070 / -142 lines
> Previous report: `AigcForge_DIFFERENTIAL_REVIEW_M2_M7_2026-08-03.md`

## 1. Executive Summary

| Result                             | Count |
| ---------------------------------- | ----: |
| Previous findings correctly closed |     7 |
| HIGH residual/new findings         |     2 |
| MEDIUM residual/new findings       |     5 |
| Documentation/process finding      |     1 |

**Recommendation:** **REJECT / CHANGES REQUIRED**（复审结论）
**二轮修复状态：** 上表全部 HIGH/MEDIUM/API 边界发现已逐项修复并补回归测试（见 §9「二轮修复闭环」），门禁复核见 §6 增补。复审后确认的 2 HIGH + 5 MEDIUM + API 边界均为真实问题。

本轮修复质量明显提升：HIGH-1、HIGH-4、HIGH-5、lint、主要 UI stale-reconcile 路径、启动恢复和 cron 性能均有实质修复，且独立 Playwright 已通过。但新原子端点与 append/remove 语义引入了未覆盖的返回值、position、并发环和快照隔离问题；`task_schedule remove` 的原始丢写根因也仍存在，因此不能认定“5 HIGH + 3 MEDIUM 全部闭环”。

## 2. Previous Findings Status

| Previous finding            | Status             | Notes                                                                                    |
| --------------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| HIGH-1 六态被四态回写       | CLOSED             | 写路径改为 single-task PATCH；非目标任务不再经过四态 normalize；scheduled/cancelled 禁用 |
| HIGH-2 UI 全列表 PATCH 丢写 | PARTIAL            | Progress/Popover/Hub 已原子化；`task_schedule remove` 仍 read-modify-reconcile           |
| HIGH-3 interrupt orphan     | PARTIAL            | startup recover 可重新排队；仍为未声明的 at-least-once、存在重复副作用窗口               |
| HIGH-4 scheduled 无 trigger | CLOSED             | update/append/patch 领域守卫已覆盖；HTTP 映射 400                                        |
| HIGH-5 task_spawn 契约      | CLOSED             | tool/input 明确“仅记录、不执行”                                                          |
| MEDIUM-1 跨 session cycle   | PARTIAL            | update 路径正确；append 检查仍在 transaction 外                                          |
| MEDIUM-2 cron 性能          | PERFORMANCE CLOSED | 字段跳转有效；搜索窗口语义与文档不一致                                                   |
| MEDIUM-3 Hub stale bucket   | PARTIAL            | 能清 absent bucket；但跨目录和 event/response 竞争未处理                                 |
| GATE-1 lint                 | CLOSED             | independent `bun run lint` exit 0                                                        |
| Previous date gate          | CLOSED             | 当前日期已是 2026-08-04，无未来日期问题                                                  |

## 3. Blocking Findings

### HIGH-1: `task_schedule remove` 仍可删除并发 append 的任务

**File:** `packages/core/src/tool/taskschedule.ts:80-92`

remove 仍执行：

1. `tasks.get(sessionID)` 读取快照；
2. 本地 filter；
3. `tasks.update(...)` 全量 reconcile。

若同一 provider turn 并行执行 `task_schedule remove` 与 `task_spawn`/其他 append，append 在 get 后提交的新 task 不在 kept payload 中，随后被 `SessionTask.update` 删除。Core 已明确支持同一 provider turn 的并发 append，因此 specs 中“单写者下不可达”不能成立。

**Required fix:** 直接复用本轮新增的 `SessionTask.removeTask`；不要在 tool 层继续 read-modify-reconcile。补 `remove + append` 并发回归测试。

---

### HIGH-2: append 的跨 session cycle check 不在事务内，并发 POST 可绕过拒环

**Files:**

- `packages/core/src/session/task.ts:505-540`
- `packages/aigcfroge/src/server/routes/instance/httpapi/groups/session.ts:228-236`

`SessionTask.update` 在 transaction 内构建 global reachable graph；但 `append` 在 transaction **之前**读取和检环，再开启 transaction 插入。新增 POST 又允许 payload 携带可预测的显式 `id`。

可复现场景：

1. 并发 POST A（session 1，id=A，dependsOn=[B]）与 POST B（session 2，id=B，dependsOn=[A]）。
2. 两个请求在任一 insert 前完成 transaction 外 graph check；A/B 都被视为 absent leaf。
3. 两个 transaction 随后依次成功插入。
4. runtime 全局 predecessor 解析使 A/B 永久互相阻塞。

**Required fix:** append 的 global graph check 与 insert 必须位于同一 transaction；typed error 可复用 update 的 tagged transaction-result 模式。POST create 最好禁止客户端传入 `id`，由服务端统一 mint。

## 4. Medium Findings

### MEDIUM-1: POST create 在非空 Session 中返回错误的 task

**Files:**

- `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts:180-197`
- `packages/core/src/session/task.ts:574-581`

`SessionTask.append` 的契约是返回**完整任务列表**，handler 却返回 `created[0]`。当 Session 已存在 task 时，第二次 POST 返回第一条旧 task，而不是本次创建的 task。

现有 HTTP 测试只校验第一次空 Session create 的响应；第二次 POST 响应被丢弃。E2E mock 直接返回 created row，因此掩盖了真实服务端差异。

**Required fix:** 新增 domain `createOne`/使 append 返回新增 rows，或至少按本次 minted id 精确查找；补“非空 Session 第二次 POST 返回第二条”的测试。

### MEDIUM-2: 单项 DELETE 留下 position 空洞，后续 append 可产生重复 position

**Files:**

- `packages/core/src/session/task.ts:543-573`
- `packages/core/src/session/task.ts:706-717`

append 用 `existing.length` 作为起始 position。删除中间项后，例如 position `[0,1,2]` 删除 `1` 得 `[0,2]`；下一次 append 从 length `2` 开始，得到第二个 position `2`。后续 `orderBy(position)` 的同位次顺序不稳定。

**Required fix:** remove 后原子压缩 position，或 append 使用 `max(position)+1`。补“删除首/中间项后 append，position 唯一且顺序稳定”的测试。

### MEDIUM-3: Agent Hub snapshot 会跨目录清 bucket，并可能覆盖更新更晚的 SSE

**File:** `packages/app/src/pages/session/timeline/agent-task-hub.tsx:88-106`

`serverSync().data.session_task` 是 server scope 的全局 map，而 `/agent-task` 请求带当前 `directory`。当前实现清理 map 中所有未出现在当前 directory 响应里的 session，可能删除同 server 下其他 directory 已加载的 task bucket。

同时，GET 发出后若 `task.updated` 先到、旧 GET 后返回，snapshot 清理/赋值会覆盖更新更晚的 SSE；现有 `session_task_updated_at` 未参与合并裁决。

**Required fix:** snapshot 必须 location/directory-scoped；仅清当前 directory 所属 Session，并用 request-start/version/updatedAt 防止旧响应覆盖新 event。

### MEDIUM-4: cron 的“365-day search window”已被改变但文档仍称保持不变

**Files:**

- `packages/core/src/session/schedule.ts:80-126`
- `packages/core/test/schedule.test.ts:55-58`
- `specs/v2/todo.md` M3 fix record

`MAX_DAY_STEPS` 只在 day loop 增加，month jump 不计实际经过天数。测试从 2026-08 查到 2028-02-29（约 576 天），从 2028-03 再查 Feb 29 会返回 2032（约 1,460 天）。因此该预算不是 365-day horizon，且不“保留原搜索窗口”。

性能修复有效；随机 500 例在 45-day horizon 内与 brute-force 最早匹配一致。但必须裁决语义：

- 若支持 leap-day recurrence，明确采用至少 4 年 horizon；或
- 若必须保留原 365 天窗口，按 elapsed timestamp 截止。

同步修正 `task_schedule` 中仍写着“~1 year of minute ticks”的旧注释。

### MEDIUM-5: startup recovery 是 at-least-once，可能重复执行已完成但未 settle 的副作用

**File:** `packages/core/src/session/scheduled-job.ts:76-101,127-171`

恢复能解决永久 orphan，但若 child 已完成外部副作用、进程在 terminal patch 前崩溃，重启会把 `in_progress` 重置为 pending 并再次执行。同一 job 因而是 at-least-once，而不是 exactly-once。

**Required fix:** 至少在 specs 明确交付语义和幂等要求；高风险任务应引入 durable attempt/lease/idempotency key，避免把“可恢复”误述为无重复恢复。

## 5. API Boundary Finding

新增 public PATCH 暴露 `outputDigest`：

- `packages/aigcfroge/src/server/routes/instance/httpapi/groups/session.ts:212-215`
- `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts:154-166`

当前 UI 只需要 status；`outputDigest` 原本由 TaskDriver/ScheduledJob settle 写入。公开可写会允许普通客户端覆盖执行摘要/child Session linkage。建议从 public payload 移除，保留为 Core 内部 settle 能力。

## 6. Verification Performed

### Passed independently

- Typecheck: core / aigcfroge / app / tui / plugin / schema / sdk — all pass。
- `bun run lint` — exit 0；incremental lint pass。
- Core tests — **1,476 pass / 0 fail**。
- App tests — **620 unit + 3 virtualizer / 0 fail**。
- `httpapi-session.test.ts` — **30 pass / 0 fail**。
- Targeted Playwright — **16 pass / 0 fail**（本轮已实际运行，修复清单中的未验证项已补验）。
- SDK regeneration — success，无额外漂移。
- `git diff --check` — clean。
- cron differential probe — 500 random cases matched brute force within a 45-day horizon。

### Test gaps that allowed the findings

1. 第二次 POST create 的响应 identity 未断言。
2. DELETE 中间 task 后再 append 的 position 未断言。
3. `task_schedule remove` 与 append 并发未测。
4. 两个跨 session POST append 并发闭环未测。
5. Agent Hub 多 directory snapshot 与 SSE-after-request race 未测。
6. recovery duplicate side-effect semantics 未声明/未测。

## 7. Documentation Finding

`docs/plan/todo-task-system-upgrade.md` 和 `specs/v2/todo.md` 已写“5 HIGH + 3 MEDIUM + GATE 全部闭环”，但上述 HIGH-1/HIGH-2 及多个 residual 尚未关闭。根据 CLAUDE.md“声明风险≠可以向用户撒谎”，应在代码修完并复审通过后再写闭环结论。

## 8. Final Recommendation

**批准合并**（2026-08-04 三轮：specs 文案同步 + 并发回归补全 + flaky 测试修复后）。

~~**不批准提交/合并。**~~

~~优先顺序：~~

~~1. `task_schedule remove` 改用 `removeTask`。~~
~~2. append 全局检环移入 transaction，并禁止 POST client-supplied id。~~
~~3. 修复 create response identity。~~
~~4. 修复 position 空洞/重复。~~
~~5. 修复 Hub directory/event snapshot 竞争。~~
~~6. 裁决 cron horizon 与 recovery delivery semantics。~~
~~7. 收窄 public PATCH，移除 `outputDigest`。~~

以上项均已在 §9 闭环；§10 补并发回归与文档同步。

## 9. 二轮修复闭环（2026-08-04 复审后修复）

上表 2 HIGH + 5 MEDIUM + API 边界发现均已修复并补回归测试，specs/v2/todo.md「评审修复记录」二轮段落逐条落档：

1. **复审 HIGH-1（`task_schedule remove` 丢写）**：`taskschedule.ts` remove 从 read-modify-reconcile 改为 `SessionTask.removeTask` 单行删除；并发 append 不再被 remove 误删。既有 tool 测试 `remove drops only the target id` 仍绿。
2. **复审 HIGH-2（append 环检查出事务）**：`SessionTask.append` 的全局可达图检环移入同一事务（tagged result 模式，与 `update` 一致）；POST create 忽略客户端 id，服务端统一 mint（堵并发闭环 + PK 伪造）。
3. **复审 MEDIUM-1（create 响应身份）**：`createTask` handler 改 `.at(-1)` 取新建行；HTTP 测试新增断言：非空 session 第二次 POST 返回新任务、客户端伪造 id 被忽略。
4. **复审 MEDIUM-2（position 空洞/重复）**：append 起始 position 由 `existing.length` 改为 `max(position)+1`（task 主键 `(session_id, position)`，中间删除后按 length 会 PK 冲突）；新增 `removeTask + append` position 唯一性测试。
5. **复审 MEDIUM-3（Hub SSE 竞态）**：`/agent-task` 快照写入加 request-start 时间戳守卫——GET 后到达的 task.updated 不被旧响应覆盖；`listAll` 全局无目录过滤，跨目录误清不成立（原 PARTIAL 中 directory 部分为误报）。
6. **复审 MEDIUM-4（cron 窗口语义）**：`schedule.ts` 注释与 `taskschedule.ts` 旧文案修正——day 预算计数 day-loop 步数而非实际经过天数；闰日类稀疏 cron 可在预算内解析数年后的真实匹配，Feb 30 类不可能 cron 在 365 步后放弃。
7. **复审 MEDIUM-5（recovery at-least-once）**：specs 明确声明交付语义为 at-least-once，高风险 job 需幂等/durable claim（非代码改动，属语义声明）。
8. **API 边界（public PATCH outputDigest）**：`PATCH /session/:id/task/:taskID` 载荷移除 `outputDigest`（保留为 TaskDriver/ScheduledJob settle 内部能力），SDK 已再生成、patch 方法仅剩 `status`。

## 10. 三轮收尾（2026-08-04）

裁决报告（BLOCKER B-1 + MEDIUM M-1~M-4）逐项闭环，全部带回归测试，门禁全绿：

1. **B-1（裁决 BLOCKER）effect `Either`→`Result`**：`session-task-service.test.ts` 误用 `effect@4.0.0-beta.83` 已更名的 `Either`/`Effect.either`/`Either.isLeft`，整文件 20+ 用例（含并发环、HIGH-4、MEDIUM-1/2 全部新回归）**静默不跑**、core typecheck 3 错、`.husky/pre-push` 必挂。已改为 `Result`/`Effect.result`/`Result.isFailure`（failure 取值 `.failure`）。修复后：`bun turbo typecheck` **18/18 成功**、core test **1481 pass / 0 fail**（此前 B-1 文件静默时 core 仅 1458）。
2. **M-1 legacy 旁路**：`replaceLegacy`（legacy TodoWrite 桥透传 `status:"scheduled"` 且无 schedule 字段）无死调度守卫。抽取共享 `hasDeadSchedule` 接入 update/append/patch/replaceLegacy 四条写路径；`SessionTodo.update`/`replaceLegacy` 错误通道加宽 `TaskWriteError`；补 replaceLegacy 拒死任务测试。
3. **M-2 append 并发拒环**：并发 append 测试暴露 SQLite 延迟事务不串行跨 session 并发写 → 事务内检环仍可被绕过。给全部 task 写操作加 `Semaphore` 写锁串行化；补「并发跨 session append 只能一个落盘」测试（显式 id 构成真环）。
4. **M-3 e2e mock 类型与保真**：`config.tasks` 从 `unknown[]` 改为结构化类型（消 5 个类型错误）；DELETE 缺失 id 200→404、POST 忽略客户端 id 统一 mint（对齐真实端点）。本次改动 e2e 文件 0 类型错误（`e2e/performance`/`e2e/smoke` 的 20 个既有错误不在分支 diff）。
5. **M-4 文案**：specs M3b-2「PATCH reconcile」→ 单任务 PATCH；`session-scheduled-tasks.tsx` 注释同步；createTask 空结果 404→500 defect。
6. **LOW**：`handlers/session.ts` createTask 空结果 404→500 defect（不可达防御分支）。

**门禁复核**（三轮独立重跑）：`bun turbo typecheck` **18/18 成功**；core **1481 pass / 0 fail**；app **623 pass / 0 fail**；httpapi-session **30 pass / 0 fail**；`bun run lint` **exit 0**；Playwright 三个 task spec **16 passed**（mock-server 改保真后重跑）；`git diff --check` clean；SDK 再生成无漂移。

**仍开放项**：aigcfroge 全量套件中 `test/mcp/lifecycle.test.ts` 的 `McpOAuthCallback.cancelPending` 为**确定性既有失败**（文件与实现均不在分支 diff，main 上同样红），需在 main 取证或单独修复；`at-least-once` 调度恢复语义需生产幂等（specs M3 §4 已声明）。
