# M5 执行提示词 — 跨模式集成（task_spawn + DAG + 衍生区接线）

> 角色：执行 agent。逐 Step 红→绿推进，每步自验后**停下等审批，不 commit**（审批员复核后统一提交）。
> 上游：计划 `docs/plan/todo-task-system-upgrade.md` §3.1 A1、§7 电商验证、§8 M5 行；specs `specs/v2/todo.md` M5 行。
> 分支：`todo-task-m5`（从 `todo-task-m4` tip 切出；M4 已闭环，hub 任务衍生占位区 `agent-task-hub-spawn` 等待接线）。

## 1. 目标与范围

| 件 | 范围 | 对齐 |
|---|---|---|
| ① spawn 字段 + task_spawn Tool | wip 资产回收：`spawned_from`/`depends_on` 落列（迁移 `20260802140709_add_task_spawn_fields`）+ `SessionTask` 写路径持久化 + `tool/taskspawn.ts` + builtins 注册 + dag.ts 纯逻辑 + 全部回收测试 | 计划 §8 M5；wip commit `3e4f50f46` |
| ② DAG 门控接调度触发 | `blockedBy` 前置终态门控接入 scheduled-job trigger：触发前复查 `dependsOn` 前置任务终态，未完成则本次不触发（不进入执行链）；循环依赖 `findCycle` 在写入侧拒绝 | M2 裁决 A 项遗留（2026-08-02） |
| ③ hub 任务衍生区接线 | zone 2b 占位 → 真实衍生列表：按 `spawnedFrom` 展示衍生链路（占位 i18n `spawnComingSoon` 替换为真实文案），只读展示 + 跳源消息，不做新交互 | 计划 §3.1 A1、§5.7 |
| ④ 电商链路集成验证 | 以测试形式验证 §7 场景机制：spawn → DAG 门控 → 定时触发 的组合链路（不是业务功能，是机制集成测试） | 计划 §7、§8 M5 退出条件 |

**退出条件**：每条电商 use case 的机制链路测试通过 + specs 同步 + 审批通过。

**明确不做**：Work Preset→Task 展开与 Assistant 定时提醒→ScheduledJob（计划 §8 M5 行列了但无既有基础设施支撑，需先立项定义——本里程碑只做 ①②③④；如执行中发现可复用路径，停在审批点提出，不自行扩大）；嵌套 task 放开（`core/src/tool/task.ts` isChildSession 全禁保持现状）；V1 Todo 改动；TUI 改动。

## 2. Step 分解

### Step 1 — wip 资产回收（核心层）

wip commit `3e4f50f46`（分支 `todo-task-m4m5`）逐文件回收：

```
packages/core/src/database/migration/20260802140709_add_task_spawn_fields.ts
packages/core/src/session/dag.ts
packages/core/src/tool/taskspawn.ts
packages/core/test/dag.test.ts / database-migration.test.ts 增量 / session-task-service.test.ts 增量
task.ts / sql.ts / builtins.ts / migration.gen.ts / schema.gen.ts / schema.json 增量
packages/sdk/js/src/v2/gen/types.gen.ts 增量
```

- **逐 hunk 核对漂移**：M4 已改过 `task.ts`（dead-job guard、TaskWriteError.id 可空）和 `builtins.ts`（task_schedule 注册），回收时冲突以 m4 现状为基线融合，不是整文件覆盖
- 迁移序号核对：`20260802140709` 是否仍为下一个未落迁移（m2/m3 已落 `add_task_schedule_fields`）
- SDK：回收后跑一次 `./packages/sdk/js/script/build.ts` 再生成，diff 应只含 AgentTask（m4 已落）+ spawn 字段

**验证**：core typecheck + 回收的测试文件全绿 + schema-changelog 补记（M5 段，注明从 wip 回收）。停下等审批。

### Step 2 — task_spawn Tool 接线复核

- builtins 注册确认（回收已含）；**权限同步核查**：subagent 默认 deny 已含 `task_spawn`（m2 `4baeebe3d` 已落），复核 `subagent-permissions.ts` 与测试断言仍在
- 工具行为核实：`spawnedFrom` = 消息 id、`dependsOn`、`agentID` 三参数语义与计划 §3.1 A1 一致；产物 task 无 `scheduled_at`（本期不触发调度，M2 裁决注明）
- 补 httpapi 层测试：PATCH 写入 spawnedFrom/dependsOn 往返

**验证**：core + aigcfroge typecheck、tool 测试、httpapi-session 定向。停下等审批。

### Step 3 — DAG 门控接 scheduled-job trigger

- `scheduled-job.ts` trigger 路径：执行前用 `dag.ts blockedBy` 复查 `dependsOn` 前置任务是否全部终态（completed/cancelled/failed 按 dag.ts 既有定义），未满足则本次跳过（记日志/状态，不进入 executor）
- 写入侧：`SessionTask.update`/`append` 对 `dependsOn` 跑 `findCycle`，成环拒绝（TaskWriteError 新 reason 或复用 invalid_schedule 模式 → HTTP 400）
- 死锁防御：前置任务被删除/永不完成时，依赖任务不得静默永久阻塞——触发跳过需在 `task.updated` 或下次 arm 时重评（沿用 re-arm 机制）

**验证**：core typecheck + scheduled-job/dag/session-task-service 测试（含新回归：前置未完成不触发、成环 400、前置删除后可重评）。停下等审批。

### Step 4 — hub 任务衍生区接线

- zone 2b `agent-task-hub-spawn` 从占位改真实列表：store 里 `spawnedFrom` 非空的 task 按源消息分组展示（纯只读）；点击跳源消息（复用消息定位既有路径，先 grep）
- i18n：`spawnComingSoon` 替换为真实文案（三语言）；占位 key 删除（删除即资产）
- E2E：`agent-task-hub.spec.ts` 补 1 用例（mock 衍生 task → 衍生区渲染）

**验证**：app typecheck + hub 测试 + oxlint + 定向 e2e。停下等审批。

### Step 5 — 电商链路集成验证 + specs 收官

- 集成测试（core 层，机制非业务）：
  1. §7.1 链路：spawn 补货分析子任务 → dependsOn 门控 → 全前置完成后触发放行
  2. §7.2 链路：多前置 DAG（风控部署 依赖 优惠券校验+物流确认）部分完成不放行、全完成放行
  3. §7.3 链路：定时 recurring + 每轮触发生成 task list 互不干扰
- specs/v2/todo.md M5 行标 ✅；schema-changelog 终态核对；计划文档头部状态行更新

**验证**：core/app/aigcfroge 三包 typecheck + 全量测试 + lint + 定向 e2e。输出 M5 里程碑复查结论，停止等审批。

## 3. 审批红线（沿用 M4 §6，违反即 REJECT）

- composer 区 / SessionContextUsage 零改动（hub 接线只动 `agent-task-hub*` 与 i18n）
- 新 permission action 必须同步 subagent 默认 deny + 测试断言
- CSS token 用前 grep packages/ui 验证；禁止新增硬编码颜色
- 写路径校验下沉（M4 已建立的模式：tool 层 guard 之外，Service 层必须独立拒绝非法输入）
- 文案诚实：UI 文案必须与实际行为一致（M4 教训）
- 自验必须真实运行并在复查结论里列命令与结果；声明风险≠可以隐瞒行为差异
- 每 Step 停在审批点，不 commit、不 push、不做任何 git 历史改写
