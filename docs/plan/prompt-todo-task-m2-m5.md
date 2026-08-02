# Todo/Task 升级 M2-M5 · TDD 执行提示词（自包含手册）

> **状态（2026-08-02 更新）**：**M2/M3 已交付并审批闭环**（`todo-task-m2` 分支 22 提交，e2e 全绿），本文件的 Step 1-5 已成历史记录。**M4 由 [prompt-todo-task-m4.md](prompt-todo-task-m4.md) 接替**（入口位置裁决变更：composer 常显按钮 → dot-grid 下拉 + 弹层，见计划 §5.7；本文件 Step 6 作废）。**M5 部分（Step 7）仍然有效**，执行时参照本文件 + 计划 §5.2/§8。
> **用途**：粘贴到新对话作为初始 prompt，驱动独立 agent 执行 Todo/Task 系统升级里程碑。
> **来源**：[Todo/Task 升级计划](todo-task-system-upgrade.md)（范围真源，§5.1/§5.2/§5.3/§5.5/§5.6/§5.7/§8/§9/§10）、[Work PRD](../prd/work-mode-execution-layer.md)（ProgressLedger 统一裁决）
> **前置状态**：M0+M1 已合入本地 main（`ef454564f`），M2+M3 已在 `todo-task-m2` 交付（审批档案 `docs/review/`）
> **完成标准**：§4 每个 Step 红→绿→重构→验证→重读协议→提交，全部通过后逐里程碑请求审批

---

下面是直接粘贴给新对话的提示词正文（复制 `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` 之间的内容）：

<!-- PROMPT START -->

你是 AigcForge 仓库（/media/keer/办公/aigcfroge）的高级全栈工程师。在 `todo-task-m2` 分支上执行 Todo/Task 系统升级剩余里程碑（M2 UI + M3 定时任务 + M4 AgentHub + M5 跨模式集成）。计划全文见 `docs/plan/todo-task-system-upgrade.md`。

---

## 0. 认知加载（写任何代码前必须精读）

按顺序读完以下文件：

```
CLAUDE.md              （根目录 — 第一性原理、八荣八耻、四大拒绝、门禁、改完即审流程）
AGENTS.md              （根目录 — 分支提交、Effect/Schema/测试规范、代码风格）
ARCHITECTURE.md        （根目录 — 系统全景、包拓扑、Product Mode）
DESIGN.md              （根目录 — UI 设计协议：Token、组件、无障碍；M2/M3/M4 UI Step 必读）
.aigcfroge/skills/effect/SKILL.md            （Effect v4 编码规范）
.aigcfroge/skills/database/SKILL.md          （schema/迁移/自定义列类型规范）
.aigcfroge/skills/frontend-theming/SKILL.md  （主题引擎；UI Step 必读）
docs/plan/todo-task-system-upgrade.md        （本计划全文，范围真源）
docs/prd/work-mode-execution-layer.md        （Work PRD — ProgressLedger 与 Task 统一）
specs/v2/todo.md                             （V2 状态追踪器，每个里程碑同步）
specs/v2/schema-changelog.md                 （契约变更记录，每次改契约同步）
docs/review/AigcForge_DIFFERENTIAL_REVIEW_2026-08-02.md         （第二轮审批报告 — 教训清单）
docs/review/AigcForge_DIFFERENTIAL_REVIEW_ROUND3_2026-08-02.md  （第三轮审批报告 — 教训清单）
```

**同时精读 M0/M1 已交付的实现**（你的工作是长在它们上面，不是另起炉灶）：

```
packages/schema/src/session-task.ts              TaskInfo 契约（M2/M3/M5 字段已声明为 optional）
packages/core/src/session/task.ts                SessionTask Service（update/append/replaceLegacy/patch/delete）
packages/core/src/session/todo.ts                SessionTodo legacy 转发适配器
packages/core/src/tool/task.ts                   task tool（轨 A/B、isChildSession 嵌套防护）
packages/core/src/tool/task-driver.ts            TaskDriver 四模式 + settle 回写
packages/core/src/tool/taskwrite.ts              TaskWrite tool
packages/core/src/session/sql.ts                 TaskTable（当前仅 M0 列）
packages/core/src/database/migration/            迁移管线（两条 task 迁移已注册）
packages/aigcfroge/src/server/routes/instance/httpapi/groups/session.ts    PATCH /session/{id}/task
packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts  GET /todo 的 V1/V2 runtime 分支
```

读完确认 `git branch --show-current` 输出 `todo-task-m2`，才能开始写代码。

---

## 1. 目标与里程碑切片

按计划 §8 里程碑表执行，**严格按 M2 → M3 → M4 → M5 顺序，每个里程碑独立可审批**：

| 里程碑 | 范围 | 退出条件 |
|---|---|---|
| **M2 UI** | ① outputDigest 持久化（task 表加列 + Service patch 落库 + 迁移）；② `GET /session/{id}/task` 读取端点 + SDK gen；③ SessionTodoProgress 脉冲线内嵌节点（§5.3 Layer 4 方案 B）；④ 移除底部 SessionTodoDock（composer dock() 折叠逻辑 / layout `todoCollapsed` / stories 同步清理）；⑤ 可交互 checkbox 折叠浮层；⑥ E2E 测试 | UI 回放 + E2E 全生命周期 + 写 API 联调 + 重载恢复测试（outputDigest 刷新后跳转不丢） |
| **M3 定时任务** | ScheduledJobRunner（**含启动 re-arm**：启动时重扫 TaskTable 按 recurrence 重建 next-run 队列；**含 unattended 权限策略**：预授权 ruleset 或 attended-only 约束，见 §8 G2 + §10）；task_schedule Tool；`agentID`/`scheduledAt`/`recurrence` 落列；定时任务 UI（§5.6：标题左侧 icon + nextRun 时间戳 + dot-grid 更多下拉入口 + 弹层） | 定时端到端（含进程重启后 re-arm）+ 标题时间戳渲染 |
| **M4 AgentHub** | AgentTaskHub 面板（Agent 视角聚合 task/定时任务，对齐计划 §5.3 Layer 4 + §8 M4） | Agent Hub 可用 |
| **M5 跨模式集成** | `spawnedFrom`/`dependsOn` 落列；task_spawn Tool；DAG 依赖；Work Preset → Task 展开；Assistant 定时提醒 → ScheduledJob；电商场景验证（§7）；V1 退役准备（§9.2：V1 Todo 标记 deprecated，不删文件） | 每条电商 use case 通过 |

**字段分期纪律（延续 M0/M1 原则，现在开始落列）**：每个字段跟着它的消费者里程碑落 DB 列——M2 落 `output_digest`，M3 落 `agent_id`/`scheduled_at`/`recurrence`，M5 落 `spawned_from`/`depends_on`。契约层（`packages/schema/src/session-task.ts`）这些字段已声明为 optional，落列时同步 Service 的 `toInfo` 映射与 `WriteInfo`，不得提前、不得遗漏。

---

## 2. 五层代码验证（执行前 grep 确认现状）

```bash
# L1 Schema（M0/M1 已交付）
grep -n "outputDigest\|agentID\|scheduledAt\|recurrence\|spawnedFrom\|dependsOn" packages/schema/src/session-task.ts

# L2 Core Service 改点
grep -n "patch\|outputDigest\|toInfo" packages/core/src/session/task.ts | head -15
grep -n "TaskTable" packages/core/src/session/sql.ts          # 当前仅 M0 列
ls packages/core/src/database/migration/ | tail -5            # 迁移尾部，新迁移往后注册

# L3 Server 改点
grep -n "HttpApiEndpoint.get(\"todo\"\|HttpApiEndpoint.patch(\"task\"" packages/aigcfroge/src/server/routes/instance/httpapi/groups/session.ts
grep -n "AIGCFROGE_V2_RUNTIME" packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts

# L4 App UI 改点（M2 主战场，路径已核实存在）
ls packages/app/src/pages/session/composer/session-todo-dock.tsx       # 待移除
ls packages/app/src/pages/session/timeline/message-timeline.tsx        # 标题行 + session-progress 容器
grep -n "todo" packages/app/src/context/server-sync.tsx | head -5      # SSE todo.updated 缓存
grep -n "todo" packages/app/src/context/directory-sync.ts | head -5    # 拉取（内置 retry）
grep -n "todo" packages/app/src/context/global-sync/event-reducer.ts | head -5
grep -rn "todoCollapsed" packages/app/src/pages/session/               # layout 折叠状态，待清理

# L5 TUI（M5 才动）
ls packages/tui/src/component/todo-item.tsx packages/tui/src/feature-plugins/sidebar/todo.tsx

# E2E 基础设施（playwright）
ls packages/app/e2e/regression/ packages/app/e2e/smoke/
grep -A3 '"test:e2e"' packages/app/package.json                        # bun --cwd packages/app run test:e2e
```

**关键认知（已核实，直接用）**：
- 默认 runtime 是 V1（`AIGCFROGE_V2_RUNTIME=false`）：V1 todo 读写 legacy TodoTable；V2 经 SessionTodo 投影读写 TaskTable。**两条路径都必须保持工作**，UI 改动只消费 `serverSync.todo` 缓存与 `todo.updated` SSE，不感知后端分支。
- App 端 `reconcile(todos, {key:"id"})` 对无 id 三字段投影失效是计划 §2.1 已记录的 pre-existing 问题——M2 消费方应优先用 `task.updated`（带稳定 id）或 `GET /session/{id}/task`，逐步替代对三字段投影的依赖。
- outputDigest 当前只活在 `task.updated` 事件 payload 与 patch 返回值里（`SessionTask.patch`），**未落库**——M2 第一步就是落库，重载恢复（TaskPanel 刷新后子会话跳转链接不丢）依赖它。
- `GET /session/{id}/task` 读取端点尚不存在（§9.1 缺口，M2 补齐）；现有唯一读路径是 `GET /session/{id}/todo`（V1/V2 双分支）。

---

## 3. TDD 强制循环（每个 Step 必走，不打折扣）

```
1. 精读本 Step 的红/绿/重构 + 关联代码文件
2. 红：先写测试，运行确认失败
3. 绿：最小实现使测试通过
4. 重构：清理，测试保持绿
5. 命令验证：bun run lint + 受影响包 typecheck + 受影响包 test
6. 按 CLAUDE.md §改完即审 输出复查结论
7. 重新阅读协议文件：CLAUDE.md 全文 + AGENTS.md 相关节 + 本 Step 涉及层的 skill
   （Effect 层读 .aigcfroge/skills/effect/SKILL.md；DB 层读 database/SKILL.md；
    UI 层读 frontend-theming/SKILL.md + DESIGN.md）+ 计划对应小节
8. 全部通过后 git commit（conventional 提交信息，如 feat(core): ... / feat(app): ...），
   才允许进入下一 Step。
```

**测试规范**（CLAUDE.md 强制）：
- `it.effect` / `it.live` / `it.instance` 三模式按需选（落盘/DB 用 `it.instance`）
- `testEffect(...)` 不手写 runtime；`Layer.mock` 不手写 stub
- 禁 `Effect.sleep(N)` 等 fiber（用 `pollWithTimeout`/`Deferred`/readiness 信号）
- 禁 `as any` / `@ts-ignore`（类型负测试用 `@ts-expect-error` 且注明）
- 命令永不从仓库根跑：`bun --cwd packages/<name> test --timeout 30000`
- E2E：`bun --cwd packages/app run test:e2e`（playwright；只跑你新增/受影响的 spec，不必全量）

**每个里程碑结束时额外做**：
- 同步 `specs/v2/todo.md`（里程碑状态）与 `specs/v2/schema-changelog.md`（凡改契约/表/端点/SDK 必记）
- SDK 再生成 `./packages/sdk/js/script/build.ts`，**把生成的 diff 一并提交**（不是追求"无 diff"）
- 输出里程碑完成报告（改了什么、测试矩阵、已知延后），**停下来等待审批，不要自行进入下一个里程碑**

---

## 4. 实施步骤

### Step 1 — M2a：outputDigest 持久化 + GET /session/{id}/task

**红**：
- `packages/core/test/session-task-service.test.ts`：patch 带 outputDigest → 重读 `tasks.get` 后 outputDigest 仍在（落库）；不带 outputDigest 的 patch 不清空已有 digest
- `packages/core/test/database-migration.test.ts`：新迁移后 task 表有 `output_digest` 列，存量行 digest 为 null
- `packages/aigcfroge/test/server/httpapi-session.test.ts`：`GET /session/{id}/task` 返回带 id 的完整 TaskInfo 数组（含 outputDigest）；空 session 返回 `[]`

**绿**：
- `session/sql.ts` TaskTable 加 `output_digest` 可空列；drizzle-kit generate → 新迁移文件 → `migration.gen.ts` 注册（遵守 §9.3 两条约束：迁移走管线、不手写裸 SQL）
- `SessionTask.patch` 落库 digest；`toInfo` 映射新列
- `groups/session.ts` 加 `HttpApiEndpoint.get("task", ...)`（success = `Schema.Array(SessionTask.Info)`，error 复用既有约定）；handler 走 `SessionTask.Service.get`
- SDK 再生成 + specs 同步（todo.md 把"outputDigest persists in M2"标记落地；schema-changelog 记录新列 + 新端点）

**验证**：`bun --cwd packages/core typecheck && bun --cwd packages/core test --timeout 30000 && bun --cwd packages/aigcfroge test --timeout 30000 test/server/httpapi-session.test.ts && bun run lint`

---

### Step 2 — M2b：SessionTodoProgress 脉冲线内嵌节点 + 移除底部 dock

**红**：App 组件测试（`bun --cwd packages/app run test:unit` 体系）——SessionTodoProgress 渲染：doneRatio clip-path 推进、in_progress 节点高亮、统计 `3/5`、空数组保持 `session-progress-whip infinite` 原样、非法 status 归 pending 不崩、total≤1 除零兜底、>20 节点降采样。

**绿**（严格按计划 §5.3 Layer 4 方案 B + §5.5 边界表）：
- 新增 `SessionTodoProgress` 组件：挂载在 timeline session-progress 容器内（复用现有 progress，不新增面板）；节点 icon 按 `i/total` 绝对定位 + `data-state`；hover tooltip（键盘用 `title`）；有 todo 时 clip-path 按 doneRatio、in_progress 局部 whip；右侧统计 done/total；挂载时 `directorySync.todo(sessionID)` 拉取（重载恢复）；SSE 增量更新
- 数据源优先消费 Step 1 的 `GET /session/{id}/task` + `task.updated`（带稳定 id），保留 `todo.updated` 三字段投影作为 V1 runtime fallback
- 移除 `session-todo-dock.tsx`（composer region 删导入 + 挂载 + `dock()` 折叠逻辑，保留 rolled/lift 给 revert）、layout `todoCollapsed` 状态、失效 stories——**先 grep 确认 §5.5 影响面结论仍成立**（Question/Permission/Revert dock 独立触发，composer `dock()` 纯服务 todo）
- §5.5 全部边界兜底逐项落实（含 aria：`role="progressbar"` + `aria-valuenow`）；CSS 全部走 v2 Token（`--v2-*`），禁硬编码颜色（DESIGN.md + frontend-theming skill）

**验证**：`bun --cwd packages/app typecheck && bun --cwd packages/app run test:unit && bun run lint`

---

### Step 3 — M2c：可交互折叠浮层 + E2E

**红**：E2E spec（`packages/app/e2e/regression/`，仿 `session-timeline-collapse-state.spec.ts` 模式）——委派产生 task → 脉冲线节点出现/推进；hover 节点显示 content；点击统计展开浮层勾选 checkbox → 经 `PATCH /session/{id}/task` 回写 → 刷新页面后状态与子会话跳转链接（outputDigest）仍在（重载恢复）。

**绿**：折叠浮层（hover 节点 or 点击统计展开，可交互 Checkbox 列表），写回走 M1 的 PATCH 端点；E2E 全生命周期。

**验证**：`bun --cwd packages/app run test:e2e`（定向 spec）+ typecheck + lint。**M2 里程碑完成：同步 specs → 输出报告 → 停止，等待审批。**

---

### Step 4 — M3a：ScheduledJobRunner + re-arm + unattended 权限策略

**红**：
- 注册 `scheduledAt` + `recurrence` 的 task → 到点触发创建子会话执行
- **进程重启后 re-arm**：重启 runner → 重扫 TaskTable → 按 recurrence 重建 next-run 队列（§8 G2，缺这个就是计划 §10 的高概率风险）
- **unattended 权限**：定时任务运行于 unattended 会话，`permission.ts` ask→deny 会静默拒读——按 §8 G2 落地预授权 ruleset 或 attended-only 约束，并有测试证明读文件不被静默拒绝

**绿**：Core 自包含分钟级 cron 调度器（单进程内存队列，不依赖 Assistant PRD）；`agent_id`/`scheduled_at`/`recurrence` 三列随本里程碑落库（迁移管线）；ScheduledJob settle 同样回写 task 状态机（成功/失败/取消——**每个触发路径都必须 settle，不允许孤儿 in_progress**）。

**验证**：core typecheck + test + lint。**用 `it.instance` + 可控时钟测调度，禁止真等墙钟。**

---

### Step 5 — M3b：task_schedule Tool + 定时任务 UI

**红**：task_schedule tool 测试（注册/暂停/删除定时 task，agentID 归属）；UI 组件测试（标题左侧 `⚡ nextRun` 条件渲染、dot-grid 下拉出现"定时任务"菜单项、弹层列表/启停）。

**绿**：`packages/core/src/tool/taskschedule.ts`（注册进 builtins，子会话 deny 同 taskwrite）；UI 按 §5.6 双位置分工（标题左侧 icon + 时间戳常显 / 更多下拉管理入口 + 弹层）；显示**当前 session 绑定 Agent** 的 nextRun。

**验证**：core + app typecheck/test + lint + 定向 E2E（标题时间戳渲染）。**M3 完成：同步 specs → 报告 → 停止等审批。**

---

### Step 6 — M4：AgentTaskHub 面板

按计划 §5.3 Layer 4 + §8 M4：Agent 视角聚合视图（我的智能体 + 其 task/定时任务聚合），对齐 Accio agent-panel 的三区结构（我的智能体 + 任务衍生 + 新建入口占位——衍生入口接 M5 的 task_spawn，本期先占位）。TDD 循环同前。**M4 完成：同步 specs → 报告 → 停止等审批。**

---

### Step 7 — M5：跨模式集成 + V1 退役准备

- `spawned_from`/`depends_on` 落列（迁移管线）；task_spawn Tool（委派完成后可选"存为 Agent"）；DAG 依赖（dependsOn 前置完成才允许触发，循环依赖拒绝）
- Work Preset → Task 展开（ProgressLedger = Task 子集，引用 id/content/status/outputDigest，派生值 currentStepIndex/canResume 不落库）
- Assistant 定时提醒 → ScheduledJob 映射
- 电商场景验证（§7 三条 use case 逐条过）
- V1 Todo（`packages/aigcfroge/src/session/todo.ts` + `tool/todo.ts`）标记 deprecated 注释，**不删文件**（物理删除属 Phase 5 独立决策）

**M5 完成：同步 specs → 报告 → 停止等审批。**

---

### Step 8 — 全量验收（每个里程碑审批通过后、最终收尾时各跑一次）

```bash
bun --cwd packages/schema typecheck && bun --cwd packages/core typecheck && bun --cwd packages/aigcfroge typecheck && bun --cwd packages/app typecheck
bun --cwd packages/schema test --timeout 30000 && bun --cwd packages/core test --timeout 30000
bun --cwd packages/aigcfroge test --timeout 30000 test/server/httpapi-session.test.ts test/tool/task.test.ts
bun run lint
```

验收清单：
- [ ] outputDigest 落库 + `GET /session/{id}/task` + 重载恢复（刷新后子会话跳转不丢）
- [ ] SessionTodoProgress 全边界（§5.5 逐条）+ dock 移除无残留（grep `SessionTodoDock`/`todoCollapsed` 无引用）
- [ ] 定时端到端 + 重启 re-arm + unattended 权限策略
- [ ] AgentTaskHub 可用；task_spawn + DAG 依赖；三条电商 use case
- [ ] 字段分期：每列跟里程碑落库，无提前无遗漏
- [ ] specs/v2/todo.md + schema-changelog.md 与实际交付零漂移
- [ ] SDK 再生成 diff 已提交；typecheck/lint/test 全绿

---

## 5. 数据流全貌（M2 主线）

```
LLM 委派（M1 已交付）                M2 新增
─────────────────────              ─────────────────────────────
task / taskwrite → TaskTable  ──→  patch 落 output_digest 列
       ↓                               ↓
task.updated (EventV2) ──────────→  GET /session/{id}/task（重载恢复）
       ↓                               ↓
todo.updated 投影（V1 兼容）        SessionTodoProgress（脉冲线节点）
       ↓                               ↓  hover tooltip / checkbox 浮层
App serverSync.todo 缓存  ───────→   ↓  PATCH 回写 → task.updated → reconcile
TUI todo-item（三字段，不变）         刷新后 directorySync 拉取恢复
```

M3 主线：TaskTable(recurrence) → ScheduledJobRunner 内存队列 →（重启 re-arm 重扫）→ 到点建子会话执行 → settle 回写 task → task.updated → UI。

---

## 6. 强制规则 + 审批红线（三轮差异审批的教训，违反即 REJECT）

### 流程规则
- 每 Step 完成后必须重新阅读协议文件（§3 第 7 条清单），必须跑 lint + typecheck + test
- 测试必须先写（红）再实现（绿）；禁止 `--no-verify`、禁止跳过验证
- 每里程碑结束同步 specs + SDK 再生成提交 + 输出报告，**停下等审批**，不自行进入下一里程碑
- 禁止 as any / @ts-ignore / 改无关文件；工具归 `packages/core/src/tool/`（禁写入 `packages/aigcfroge/src/tool/` V1 退役区）
- 嵌套防护保持现状（task tool `isChildSession` 全禁；M5 如需放开，改 depth limit + deny 继承，必须先提方案获批）
- 阻塞问题：先报告现状和已试方案，请求决策，不绕过

### 审批红线（前两轮 M0/M1 各被 REJECT 过一次的原因，不要重蹈）
1. **V1 runtime 兼容**：默认 `AIGCFROGE_V2_RUNTIME=false` 路径不得有任何回归；M1-M5 不改 V1（§9.2）；`GET /todo` 的 V1/V2 双分支保持。改共享读路径时，两个 runtime 模式都要有测试。
2. **禁 `Effect.die` 处理预期失败**：业务拒绝用 `Schema.TaggedErrorClass`（参照 `SessionTask.TaskWriteError` 的 tagged-union-through-transaction 模式），HTTP 边界 `catchTag` 映射 4xx（参照 PATCH handler），tool 边界 `mapError` 保留具体 message（注意外层 mapError 不得覆盖内层——第三轮修过的 bug）。
3. **Schema.Class 必须实例化**：多字段记录一律 `Schema.Class`（根 AGENTS.md 强制），所有构造点用 `new X({...})`，禁 plain object 伪装 Class（encode 时炸 `SchemaError`，第三轮 MEDIUM-2）。
4. **每条委派/调度路径都必须 settle**：新增任何触发路径（spawn、schedule、extend 类）都要回答"谁来回写 task 状态机"——成功/失败/取消三分支 + 固定分类脱敏 digest。**孤儿 in_progress 是本项目被 REJECT 的最高频原因**（第二轮 HIGH-4、第三轮 HIGH-1）。
5. **Clean Logs**：digest 只允许固定分类短语，禁 `Cause.pretty`/raw error/stack 进 `task.updated` 或 outputDigest（会泄 Authorization/token/prompt）。
6. **事件 payload 与 DB 一致**：任何"落库时回退/保留"的逻辑（如 parentID 省略保留）必须同步反映在 resolved Info 和事件 payload 里（第三轮 MEDIUM-1）。
7. **迁移纪律**：drizzle 管线 + `migration.gen.ts` 注册；新列可空或有默认值；迁移幂等（重跑 no-op、部分失败整体回滚）；ID 走 `Identifier.ascending`，禁 `hex(randomblob)`。
8. ** specs 零漂移**：交付了什么就同步什么，changelog 不写 "pending" 写已交付事实（第三轮 LOW-1）。
9. **UI 纪律**：颜色/间距/圆角全走 CSS 变量（`--v2-*` 优先），禁硬编码；边界只兜底"外部输入 + 计算除零"（§5.5），不为不可能场景加防御（极致减法）。
10. **新增 finding 必须有回归测试**：每个修复/拒绝路径（4xx、拒绝触发、循环依赖等）都要落测试，不接受"手动验证过"。

**已知延后（不在本期范围）**：V1 物理删除（Phase 5 独立决策）；拖拽排序；100+ 虚拟滚动（超限降采样）；集群化调度（单进程内存调度器为本期边界）；多平台消息通道（计划 A6，P3）。

<!-- PROMPT END -->

---

## 使用说明

| 项 | 值 |
|---|---|
| 复制范围 | `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` |
| 新对话 model | 默认（工程执行主力模型） |
| 新对话打开文件 | `docs/plan/todo-task-system-upgrade.md`（范围真源）+ 本文件 |
| 开工顺序 | 通读 §0 清单 → 确认在 `todo-task-m2` 分支 → Step 1 红测试开始 |
| 节奏 | 每 Step：红→绿→验证→重读协议→提交；每里程碑：specs 同步 → 报告 → **等审批** |
| 卡住时 | 回报阶段 + 已过/未过测试 + 具体报错，不绕过（`--no-verify` 禁） |
| 审批 | 每个里程碑由审查 agent 按差异审批流程复核（重点：§6 审批红线 10 条） |
