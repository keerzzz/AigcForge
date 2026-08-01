# Todo/Task 升级 M0+M1 · TDD 执行提示词（自包含手册）

> **用途**：粘贴到新对话作为初始 prompt，驱动独立 agent 执行 Todo 计划 M0（契约）+ M1（核心）——数据模型地基 + TaskDriver↔Task 双轨联动 + 写 API。
> **来源**：[Todo/Task 升级计划](todo-task-system-upgrade.md)（范围真源，§5.1/§5.2/§5.3/§5.4）、[Work 路线图](work-mode-roadmap.md)、[Work PRD](../prd/work-mode-execution-layer.md)（交叉裁决）
> **分支**：`todo-task`（从最新 main 切出，M1 已合入）
> **完成标准**：§4 Step 1-6 全过 + typecheck/lint/test 绿 + 提交

---

下面是直接粘贴给新对话的提示词正文（复制 `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` 之间的内容）：

<!-- PROMPT START -->

你是 AigcForge 仓库（/media/keer/办公/aigcfroge）的高级全栈工程师。在 `todo-task` 分支上执行 Todo/Task 系统升级（M0 契约 + M1 核心）实施计划。计划全文见 `docs/plan/todo-task-system-upgrade.md`。

---

## 0. 认知加载（写任何代码前必须精读）

按顺序读完以下文件：

```
CLAUDE.md              （根目录 — 第一性原理、八荣八耻、四大拒绝、门禁、改完即审流程）
AGENTS.md              （根目录 — 分支提交、Effect/Schema/测试规范、代码风格）
ARCHITECTURE.md        （根目录 — 系统全景、包拓扑、Product Mode）
.aigcfroge/skills/effect/SKILL.md            （Effect v4 编码规范）
docs/plan/todo-task-system-upgrade.md        （本计划全文，范围真源）
docs/prd/work-mode-execution-layer.md        （Work PRD v4.1 — ProgressLedger 与 Task 统一，交叉裁决）
docs/architecture/adr/ADR-13-chat-work-mode-boundary.md  （模式边界）
docs/architecture/adr/ADR-14-persistence-and-scope-strategy.md  （数据真源）
specs/v2/todo.md                             （V2 状态追踪器，M1 需同步）
```

读完才能在 `todo-task` 分支上开始写代码。

---

## 1. 目标

将 per-Session 的平面 Todo 升级为 Task 体系：**M0** 建立 `SessionTask` Schema 契约（稳定 `id` + `parentID`），**M1** 实现 `SessionTask` Service（替代 `SessionTodo`）、TaskDriver↔Task **双轨联动**（轨 A `parent_task_id` 显式关联 / 轨 B 委派自动建 todo）、`PATCH /session/{id}/task` 写 API + SDK gen、`TodoTable → TaskTable` 数据迁移。

**范围**：`packages/schema`（session-task.ts）+ `packages/core`（session/task.ts 新建、tool/task.ts 改、tool/taskwrite.ts 新建、groups/session.ts 改、database/migration）+ `packages/sdk/js`（gen）。

**M0 字段分期（严格执行，不越界）**：
| 阶段 | 字段 |
|---|---|
| **M0** | `id`, `content`, `status`, `priority`, `parentID`, `sessionID` |
| M1.5 | `outputDigest`（Work ProgressLedger 联动） |
| M3 | `agentID`, `scheduledAt`, `recurrence` |
| M5 | `spawnedFrom`, `dependsOn` |

⚠️ 只实现 M0 字段的 DB 列 + Service 支持；M1.5/M3/M5 字段在 Schema 契约中定义但**不建列、不支持**（极致减法：每个字段跟着消费者上线）。

---

## 2. 五层代码验证（执行前 grep 确认）

```bash
# L1 Schema
grep -n "SessionTask\|session-task" packages/schema/src/index.ts | head -5    # 应为空，需加
grep -n "export { Session }" packages/schema/src/index.ts | head -3            # 插入位置参照

# L2 Core Service（现状 Todo）
grep -n "export const Info\|export const Event\|class Service\|export const layer" packages/core/src/session/todo.ts | head -8
grep -n "TodoTable" packages/core/src/session/sql.ts | head -3                 # :104
grep -n "SessionTodo" packages/core/src/location-layer.ts | head -5            # :137 layer 装配

# L3 TaskDriver 双轨改点
grep -n "export const Input\|parent_task_id\|subagent_type\|execution_type\|isChildSession" packages/core/src/tool/task.ts | head -10   # Input :22
grep -n "createChild\|delegateBackground\|delegateJudge\|extendBackground\|interrupt" packages/core/src/tool/task-driver.ts | head -10

# L4 写 API（现状仅 GET）
grep -n "todo\|HttpApiEndpoint.get\|SessionPaths" packages/aigcfroge/src/server/routes/instance/httpapi/groups/session.ts | head -8   # 找 :85 todo path / :160 GET

# L5 SDK + 迁移
grep -n "export type Todo" packages/sdk/js/src/v2/gen/types.gen.ts | head -3   # :666
grep -n "DatabaseMigration.apply" packages/core/src/database/database.ts | head -3  # :33
ls packages/core/src/database/migration/ | head -5                            # drizzle 迁移目录
```

**关键发现（已核实，直接用）**：
- `schema/index.ts` **未含** `session-task`（`session-task.ts` 已创建，需加导出）
- `session/todo.ts:10-16`：`Todo.Info` = `{ content, status, priority }`（`Schema.String` 无字面量约束）；`:19-27`：`todo.updated` EventV2 定义
- `session/sql.ts:104`：`TodoTable`，PK=`(session_id, position)`，**无 id 列**
- `tool/task.ts:22`：`Input` 含 `description/prompt/subagent_type/task_id/background/attended/execution_type/cli_target/judge_models`——**无 `parent_task_id`**（轨 A 需加）
- `tool/task.ts:131-137`：`isChildSession` 全禁嵌套（保留现状，不改）
- `tool/task-driver.ts`：四模式方法名（`delegate`/`delegateBackground`/`delegateJudge`/`extendBackground`）
- `groups/session.ts`：todo 仅 `GET /session/{id}/todo`（:85 path, :160 endpoint），**无 POST/PATCH**——M1 新增 `PATCH /session/{id}/task`
- `id/id.ts:16`：`ascending("task", ...)` → `tsk_` 前缀（迁移必须用，不用 `hex(randomblob)`）
- `database/database.ts:33`：`DatabaseMigration.apply`——迁移走 drizzle-kit → `migration/*.ts` → `migration.gen.ts` 注册

---

## 3. TDD 强制循环（每 Step 必走）

```
1. 精读本 Step 的红/绿/重构 + 关联代码文件
2. 红：先写测试，运行确认失败
3. 绿：最小实现使测试通过
4. 重构：清理，测试保持绿
5. 命令验证：bun run lint + 受影响包 typecheck + 受影响包 test
6. 按 CLAUDE.md §改完即审 输出复查结论
7. 重新阅读 CLAUDE.md 全文 + 计划 §5.1/§5.4
全部通过后 git commit，进入下一步。
```

**测试规范**（CLAUDE.md 强制）：
- `it.effect` / `it.live` / `it.instance` 三模式按需选（落盘/DB 用 `it.instance`）
- `testEffect(...)` 不手写 runtime；`Layer.mock` 不手写 stub
- 禁 `Effect.sleep(N)` 等 fiber（用 readiness 信号）
- 禁 `as any` / `@ts-ignore`（类型负测试用 `@ts-expect-error` 且注明）
- 命令永不从仓库根跑：`bun --cwd packages/<name> test --timeout 30000`

---

## 4. 实施步骤

### Step 1 — M0 契约：Schema 导出 + 类型负测试

**红**：`packages/schema/test/session-task.test.ts`（新建）——TaskInfo decode：合法字段通过；非法 status（如 `"foo"`）/非法 priority 应 decode 失败（`Schema.Literals` 负测试）；`parentID`/`outputDigest` 等可选字段省略通过；`sessionID`/`content` 必填缺失失败。

**绿**：
- `packages/schema/src/session-task.ts`（已创建，含 `TaskStatus`/`TaskPriority`/`TaskRecurrence`/`Info` 全契约）——确认 `status: TaskStatus` / `priority: TaskPriority` 用 `Schema.Literals`
- `packages/schema/src/index.ts` — 加 `export { SessionTask } from "./session-task"`（参照 `export { Session }` 插入位置）

**验证**：`bun --cwd packages/schema typecheck && bun --cwd packages/schema test --timeout 30000 && bun run lint`

**复查**：重新阅读 CLAUDE.md + Schema 规范（多字段 `Schema.Class`/`Struct`，单值 `Schema.Literals`）

---

### Step 2 — M1 Core：SessionTask Service（增量 CRUD）

**红**：`packages/core/test/session-task.test.ts`（新建）——仿 `session-todo.test.ts` 模式（`testEffect` + `Database.defaultLayer` + Project/Session 预置）：插入 3 条 → 按 `(session_id, position)` 返回有序；更新某条 status → 位置不变；删除 → 消失；`task.updated` 事件发布（监听 EventV2）。

**绿**：
- `packages/core/src/session/task.ts`（新建）——`SessionTask.Service`（`@aigcfroge/v2/SessionTask`），`update`/`get`/`delete` 增量 CRUD（**非全量 DELETE+INSERT**，用 drizzle 的 `where(eq(id))` + `insert`/`update`）
- 复用 `SessionTodo.Event.Updated` 的 EventV2 bridge 模式（`todo.ts:19-27`），新增 `task.updated` 事件（`sessionID` + `tasks: Array<Info>`）
- `session/sql.ts` — 新增 `TaskTable`（含 `id` 列，PK=`id`，`parent_id` 可空，`session_id` 外键）
- `location-layer.ts` — `SessionTask.layer` 装配（参照 `SessionTodo` :137/:152/:179）

**验证**：`bun --cwd packages/core typecheck && bun --cwd packages/core test --timeout 30000 && bun run lint`

**复查**：重新阅读 CLAUDE.md + Effect 编码（`Effect.fn("SessionTask.xxx")`、`Effect.void`、失败 `yield* new XError`）

---

### Step 3 — M1 双轨联动：task tool 轨 A + 轨 B 自动建 todo

**红**：`packages/core/test/tool-taskwrite.test.ts`（新建）——
- 轨 A：task tool 带 `parent_task_id` → 委派完成后对应 todo 条目回写 `completed`（childSessionID 存 outputDigest）
- 轨 B：task tool 不带 parent_task_id → 委派前自动创建 `in_progress` todo（content=description），完成后回写
- 失败 → 回写 `failed`（错误摘要入 outputDigest）；取消 → `cancelled`
- 双轨回写均在 BackgroundJob fiber（防 SQLite 死锁）

**绿**：
- `tool/task.ts` `Input`（:22）加可选 `parent_task_id: Schema.optional(Schema.String)`
- task tool execute：未提供 `parent_task_id` 时走轨 B——`SessionTask.update` 自动建 `in_progress` 条目；提供时走轨 A 关联现有条目
- 委派 settle（成功/失败/取消）→ 经 `SessionTask.update` 自动回写（回写在 BackgroundJob fiber，`task-driver.ts` 已论证）
- `tool/taskwrite.ts`（新建）——LLM-facing TaskWrite tool，注册进 `builtins.ts`（参照 `TodoWriteTool.layer` :14/:51）

**验证**：`bun --cwd packages/core typecheck && bun --cwd packages/core test --timeout 30000 && bun run lint`

**复查**：重新阅读 CLAUDE.md + 计划 §5.4 双轨设计 + Clean Logs（不输出完整 prompt/错误原文）

---

### Step 4 — M1 写 API：PATCH /session/{id}/task + SDK gen

**红**：`packages/aigcfroge/test/...` — 写 API 测试：PATCH 更新 task 列表 → 回读一致；非法 body（status 非法）→ 400。

**绿**：
- `groups/session.ts` — 新增 `HttpApiEndpoint.patch("task", ...)`（:85/:160 附近），Request = `Array<TaskInfo>`，走 `SessionTask.Service`
- SDK gen：`bun --cwd packages/sdk/js script/build.ts`（或仓库规定 gen 命令）→ `types.gen.ts` 加 `TaskInfo` 类型 + PATCH client
- 同步 `specs/v2/todo.md`（📋 Planned 更新为 M0/M1 done 状态）+ `specs/v2/schema-changelog.md`

**验证**：`bun --cwd packages/core typecheck && bun --cwd packages/aigcfroge typecheck && bun --cwd packages/core test --timeout 30000 && bun run lint`

**复查**：重新阅读 CLAUDE.md + API/Schema 规范

---

### Step 5 — M1 迁移：TodoTable → TaskTable 回填

**红**：迁移测试——旧 TodoTable 数据迁移到 TaskTable，每条生成 `tsk_` 前缀 id，position 保留，`created_at`/`updated_at` 保留。

**绿**（严格遵守两条约束）：
1. **ID**：不用 `hex(randomblob)`。用 `id/id.ts` `ascending("task", ...)` → `tsk_` 前缀（:16）
2. **迁移管线**：drizzle-kit generate → `packages/core/src/database/migration/*.ts` → `migration.gen.ts` 注册 → `DatabaseMigration.apply`（database.ts:33）
- 迁移文件内逐行读旧 TodoTable → 生成 id → 插入 TaskTable；旧 TodoTable 保留（兼容读），标记 deprecated

**验证**：`bun --cwd packages/core test --timeout 30000 && bun --cwd packages/core typecheck && bun run lint`

**复查**：重新阅读 CLAUDE.md + ADR-14（数据真源：文件/表为真源，投影只存身份）

---

### Step 6 — 全量验收

```bash
bun --cwd packages/schema typecheck && bun --cwd packages/core typecheck && bun --cwd packages/aigcfroge typecheck
bun --cwd packages/schema test --timeout 30000 && bun --cwd packages/core test --timeout 30000
bun run lint
```

验收清单：
- [ ] `session-task.ts` 导出到 schema index，类型负测试通过（非法 status 拒绝）
- [ ] `SessionTask.Service` 增量 CRUD，非全量替换；`task.updated` 事件发布
- [ ] 双轨联动：轨 A `parent_task_id` 关联回写；轨 B 自动建 todo + settle 回写
- [ ] 回写状态机：completed/failed(摘要入 outputDigest)/cancelled；BackgroundJob fiber 执行
- [ ] `PATCH /session/{id}/task` + SDK gen + specs 同步
- [ ] 迁移走 `tsk_` id + drizzle 管线，旧 TodoTable 兼容保留
- [ ] 旧 `TodoWrite`/`SessionTodo` 保留兼容（deprecated），未破坏
- [ ] 未做 M1.5/M3/M5 字段的 DB 列（极致减法）
- [ ] typecheck/lint/test 全绿

---

## 5. 数据流全貌

```
LLM 委派（两条路径）
  │
  ├─ 轨 A（显式 parent_task_id）:
  │   task_write([{content:"安全审查", status:"in_progress"}]) → 建 todo id t-1
  │   task("审查 src/auth", parent_task_id:"t-1")
  │        └─ TaskDriver.delegate() → 子会话 settle → SessionTask.update 回写 t-1
  │
  └─ 轨 B（委派自动建 todo，元智能体编排主路径）:
      task("审查 src/auth")
           ├─ [系统] SessionTask.update 自动建 in_progress todo (content=description)
           ├─ TaskDriver.delegate() → 子会话 settle
           └─ 回写: completed / failed(摘要入 outputDigest) / cancelled
                    childSessionID 存 outputDigest → 可点击跳转子会话

回写时机: 子会话 settle 时, 在 BackgroundJob fiber 执行 (防 SQLite 死锁)
事件: task.updated (EventV2, 仿 todo.updated) → App 端 serverSync.todo/task 缓存
```

**设计决策**：双轨互补——轨 A 适用于"先规划后执行"，轨 B 适用于元智能体编排（todo 是副产品，编排进度自动映射为 todo 仪表盘）。上游 dev V2 无 task↔todo 联动（甚至无 V2 task tool），此为全球空白区差异化创新。

---

## 6. 强制规则

- 每 Step 完成后必须重新阅读 CLAUDE.md 全文
- 每 Step 完成后必须跑 typecheck + test + lint
- 测试必须先写（红）再实现（绿）
- 禁止 as any / @ts-ignore / 改无关文件
- 字段分期严格执行：M0 只做 6 字段，不做 M1.5/M3/M5 的 DB 列
- 工具归 `packages/core/src/tool/`（禁写入 `packages/aigcfroge/src/tool/`——V1 退役区）
- 嵌套防护保持现状（`task.ts:131-137` isChildSession 全禁，不改）
- 阻塞问题：先向用户报告现状和已试方案，请求决策

**已知延后**（不在本期范围）：M1.5 `outputDigest` 与 Work ProgressLedger 联动、M2 SessionTodoProgress UI（脉冲线内嵌节点）、M3 定时任务（ScheduledJobRunner + 标题时间戳 UI）、M4 AgentHub、M5 跨模式集成——均后续里程碑。

<!-- PROMPT END -->

---

## 使用说明

| 项 | 值 |
|---|---|
| 复制范围 | `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` |
| 新对话 model | 默认（工程执行主力模型） |
| 新对话打开文件 | `docs/plan/todo-task-system-upgrade.md`（范围真源）+ 本文件 |
| 开工顺序 | 通读 CLAUDE.md/AGENTS.md/skills → git 切 `todo-task` → Step 1 红测试开始 |
| 卡住时 | 回报阶段 + 已过/未过测试 + 具体报错，不绕过（`--no-verify` 禁） |
