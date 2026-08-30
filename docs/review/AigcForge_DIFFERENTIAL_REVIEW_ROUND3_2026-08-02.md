# AigcForge `todo-task` 第三轮审批报告（含未提交变更）

- **审批日期**：2026-08-02（星期日）
- **基线**：`main` (`a041ca617`)
- **目标**：`todo-task` (`3d039b183`) + **未提交工作区变更**（`packages/core/src/session/task.ts`、`tool/task-driver.ts`、`tool/task.ts`，+93/-42）
- **完整范围**：`main..HEAD`，9 commits，39 files，`+2732/-128`；另加工作区第三轮修复
- **结论**：❌ **REJECT / 暂不批准合入**
- **总体风险**：HIGH（全部集中在未提交的第三轮变更；已提交的 9 个 commit 本身达标）

## 1. Executive Summary

| Severity    | Count |
| ----------- | ----: |
| 🔴 CRITICAL |     0 |
| 🟠 HIGH     |     2 |
| 🟡 MEDIUM   |     2 |
| 🟢 LOW      |     6 |

前两轮复审（`5b0a9b241`、`3d039b183`）的修复**核验属实**：HIGH-1（V1 runtime `/todo` 分支）、HIGH-2（`replaceLegacy` 按 position 复用 id 保持 background settle 关联）、MEDIUM-1（digest 固定分类，无 `Cause.pretty` 泄密）、MEDIUM-2（Schema.Class 转换）、MEDIUM-3（resume 注释/specs M1.5→M2）全部关闭，测试与 typecheck 实证通过。

但**未提交的第三轮变更引入 2 个 HIGH + 2 个 MEDIUM 新问题**，且导致 `bun run lint` 红灯（exit 1）：

1. **resume 走轨 B 新建 task 后，`extendBackground` 路径永不 settle** —— 已实证堆积孤儿 `in_progress`（本里程碑要修的核心断裂被重新引入）；
2. **`update` 用 `Effect.die` 拒绝 foreign/重复 id** —— 违反 Effect 协议（die 保留给不可恢复缺陷），HTTP 边界实测 500（应 4xx），LLM 路径穿透 typed-error 兜底使**整个父会话 drain 以 defect 失败**，并触发 lint error；
3. `parentID` 保留只落库不回读，`task.updated` 事件与 DB 不一致；
4. `TodoProjection` 转 Class 后 `publishBoth` 仍构造 plain object，encode 即抛 `SchemaError`（实证），当前仅靠"非 durable 事件 + SSE 裸 JSON.stringify"未引爆。

## 2. 前两轮复审项闭环矩阵

| 上轮 Finding                        | 状态                | 证据                                                                                                                                   |
| ----------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| HIGH-1 默认 V1 `/todo` 读取回归     | ✅ 关闭             | `handlers/session.ts:118-127` runtime 分支；定向测试 "GET /session/:id/todo reads the legacy TodoTable in the default V1 runtime" 通过 |
| HIGH-2 legacy replace 重建 ID       | ✅ 关闭             | `task.ts:277-329` replaceLegacy 单事务按 position 复用 id/parent_id/time_created；回归测试 `session-task-service.test.ts:199-230` 通过 |
| MEDIUM `Cause.pretty` 泄密          | ✅ 关闭             | digest 固定分类 "foreground/background delegation failed"；全链无 raw error/cause 进 `task.updated`                                    |
| MEDIUM Schema.Class 协议            | ⚠️ 关闭但第三轮回潮 | Info/WriteInfo/TodoProjection 均已 Class 化；**但 `task.ts:137` payload 仍构造 plain object**（本轮 MEDIUM-2）                         |
| MEDIUM resume 虚假注释 + specs 漂移 | ⚠️ 部分回潮         | 注释已改但**行为被改成 resume 也建 task**（本轮 HIGH-1）；`schema-changelog.md:22` backfill "still pending" 漂移未清                   |
| LOW-1 测试措辞                      | ✅ 关闭             | 已修正为 "forged fields are ignored"                                                                                                   |

## 3. Blocking Findings

### 🟠 HIGH-1：background resume → extend 路径产生永不 settle 的孤儿 in_progress task（第三轮新回归）

**Evidence**

- `packages/core/src/tool/task.ts:225-234`：未提交变更把条件从 `taskID === undefined && resumeID === undefined` 改为 `taskID === undefined`——resume 现在也走轨 B append 一条 `in_progress` task；
- `packages/core/src/tool/task.ts:283-301`：`resumeID !== undefined` 且 background 时调 `TaskDriver.extendBackground(...)`，**不传 taskID/onSettle**；
- `packages/core/src/tool/task-driver.ts:130-135, 539-560`：`extendBackground` 接口与实现均无 settle 挂钩；排队 work（prompt→resume→readResult→injectSynthetic）链上无任何 settle 调用；
- 实证（临时复现测试，用后已删）：extend 场景跑完后 `tasks.get(parentID)` = `[{completed}, {in_progress}]`——第二条永久卡死。

**Failure Flow**

```text
cycle 1: background=true 委派 → 轨 B 建 task1 (in_progress)
cycle 2: task_id resume → 轨 B 再建 task2 (in_progress) → extend 成功排队
原 work drain settle task1 (completed)
extend 排队 work 跑完 drain + inject → 无人 settle task2 → 永久 in_progress
```

**Impact**

这正是本里程碑存在的意义——"task 跑完了但 todo 还显示 in_progress"（计划 §2.2 核心断裂）。反复 resume 一个 running background job 每次堆积一条孤儿。代码注释（task.ts:221-224）自认 "prior task may stay in_progress"，实际更糟：**新建的 task 自身就永不 settle**。前台 resume 与 background fallback（extend 返回 false → delegateBackground 带 onSettle）都有 settle，唯独 extend 成功路径裸奔。

**Required Fix**（二选一）

- A：`extendBackground` 接口与实现增加 `taskID/onSettle`，在排队 work 的 drain exit 后按 delegateBackground 同款 Exit 分类 settle（completed / cancelled / failed 固定 digest）；或
- B：extend 成功路径不新建 task（回退 `3d039b183` 的已提交行为：resume 无 parent_task_id 时不建），注释如实说明 resume 无持久映射、M2 经 outputDigest 补齐。

另需删除/修正 "so we create a fresh task for the resume" 注释，并加 "background resume + extend → settle" 回归测试。

### 🟠 HIGH-2：`update` 对 foreign/重复 id 用 `Effect.die` —— 协议违规，HTTP 实测 500，LLM 路径杀掉整个父会话 drain，并触发 lint error

**Evidence**

- `packages/core/src/session/task.ts:171-179`：事务 generator 内 `return yield* Effect.die("Foreign task id ... rejected")` / `Effect.die("Duplicate task id ...")`；`Interface.update` 错误通道为 `never`（task.ts:62-65）；
- HTTP 探针实测（临时测试，用后已删）：PATCH 携带不属于该 session 的 `tsk_` id → **HTTP 500** `UnknownError`；重复 id 同样 500。事务正确回滚（seed 行无残留），响应体不泄露内部细节——拒绝逻辑本身是对的，错在失败通道；
- LLM 路径：taskwrite 的 `mapError(() => new ToolFailure(...))`（`taskwrite.ts:52`）只捕获 typed error，defect 直接穿透；registry 只 `catchTag("LLM.ToolFailure")`（`registry.ts:110`）；defect 进入 runner 命中 `llm.ts:368-386` → `failUnsettledTools` + `Effect.failCause` → **整个父会话 turn 以 defect 失败**，模型收不到可纠正的 tool error。可达性不低：WriteInfo 文档明说"entries with an id are reconciled in place"，模型在 compaction/replace 后提交过期 id 是合理行为，非纯对抗输入；
- lint：`bun run lint` exit 1——`task.ts:157:22 consistent-return`（die 提前 return 与末尾落空并存）。

**协议依据**

根 AGENTS.md：失败用 `yield* new MyError(...)`（`Schema.TaggedErrorClass`），defect 用 `Schema.Defect`；die 保留给不可恢复缺陷。客户端提供过期/外来 id 是**预期业务失败**，不是缺陷。

**Required Fix**

新增 `SessionTask.ForeignTaskIdError` / `DuplicateTaskIdError`（`Schema.TaggedErrorClass`，含 id 字段）进 `update` 错误通道；taskwrite 端现有 `mapError` 自动兜底为 ToolFailure；HTTP handler `Effect.catchTag` 映射 `HttpApiError.BadRequest`（需在 `groups/session.ts:179` error 列表声明，并重新生成 SDK + schema.json）。lint error 随重构自然消除。补 HTTP 4xx 与 tool-failure 两条测试。

## 4. Medium Findings

### 🟡 MEDIUM-1：`update` 的 parentID 保留只落库、不回读 —— `task.updated` 事件/返回值与 DB 状态不一致

`task.ts:188` 写列 `parent_id: task.parentID ?? prior?.parent_id ?? null`（保留正确）；但 `task.ts:211-222` 构造 `resolved` 只用 `task.parentID`，无同样回退。PATCH/taskwrite 省略 parentID 更新已有父子链的 task → DB 保留 parent_id，但返回列表与 `task.updated` payload 里 parentID 消失 → App 以事件 reconcile 后 UI 丢失父子关系，直到下次全量拉取。

**Fix**：`resolved` 构造与 columns 用同一回退值，或事务后整表重读再发布（与 append/replaceLegacy 一致）。

### 🟡 MEDIUM-2：`publishBoth` 用 plain object 构造 TodoProjection（Class）—— 与自身事件 schema 不符，encode 即抛

`task.ts:136-138`：`todos: tasks.map((task) => ({ content, status, priority }))`，而第三轮已把 `TodoProjection` 转为 `Schema.Class`（`task.ts:36-40`），`Event.TodoUpdated` schema 为 `Schema.Array(TodoProjection)`。

实证：`Schema.encodeSync(TodoProjection)({content,status,priority})` 抛 `SchemaError(Expected SessionTask.TodoProjection, got {...})`。当前未炸的唯一原因：`todo.updated` 是非 durable 事件，`EventV2.publish` 只在 durable 路径做 `Schema.encodeUnknownSync`（`event.ts:241-243`），SSE 出口是裸 `JSON.stringify`（`handlers/event.ts:15,38`）。一旦该事件转 durable、或任何下游按注册 schema encode payload，即运行时 SchemaError。这是上轮 MEDIUM-2 的同类问题在第三轮被重新引入——Struct→Class 只转了一半。

**Fix**：`task.ts:137` 改为 `new TodoProjection({...})`，并把 plain-object encode 负测试加进 `session-task-service.test.ts`。

## 5. Low Findings

| #     | 问题                                                                                                                                                                                        | 证据                                                           | 处置                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| LOW-1 | `specs/v2/schema-changelog.md:22` "backfill migration still pending (Step 5)" 与已交付的 `20260802220000_backfill_task_table.ts`（`migration.gen.ts:53` 注册）矛盾                          | changelog:22                                                   | 合入前随手修                                                   |
| LOW-2 | 计划 §5.3 五层清单 Layer 4/5 全打 ✅，与 App/TUI 未交付（M2/M5）的事实不符；§9.1 "Response 增 tasks 字段" 与 §8 M2 行"GET /task 读取端点 M2 补齐"自相矛盾；roadmap 依赖矩阵残留 "Todo M1.5" | todo-task-system-upgrade.md §5.3/§8/§9.1；work-mode-roadmap.md | 文档口径统一，不阻塞                                           |
| LOW-3 | replaceLegacy 按 position 复用 id：LLM 重排列表时 linked id 跟位置不跟内容（"串名"），settle 仍按 id patch 不错行                                                                           | task.ts:292-294                                                | 计划 §5.4 已认可全量替换覆盖语义，记录备查                     |
| LOW-4 | `todowrite`/`taskwrite` 双工具描述几乎雷同，均写同一 TaskTable 但 reconcile 语义不同（按位置 vs 按 id），模型无选择指引                                                                     | builtins.ts:52-54；todowrite.ts:34；taskwrite.ts:36            | 建议 taskwrite 标注 preferred / todowrite 标注 legacy，M5 收敛 |
| LOW-5 | GET /todo 的 V2 分支无 HTTP 级测试（`AIGCFROGE_V2_RUNTIME` 为模块加载期常量，同进程无法翻转）；仅 Core 服务级覆盖                                                                           | handlers/session.ts:123-126                                    | V2 转正前补独立进程测试                                        |
| LOW-6 | 前台 delegate 受理腿（prompt/start，exit 捕获区之前）被中断时无 writeback；abort 时 writeback 先于 child cancel 完成——窗口极窄、语义可接受                                                  | task-driver.ts:379-380                                         | 记录备查                                                       |

## 6. 五层上下游影响面（实证）

| 层                           | 结论                        | 证据                                                                                                                                                                                                                                 |
| ---------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L1 Schema（packages/schema） | ✅ 通过                     | TaskInfo 契约与 §5.1 一致；Literals 负测试齐；39/39 pass                                                                                                                                                                             |
| L2 Core Service/Tool         | ❌ 卡 HIGH-1/2 + MEDIUM-1/2 | 见 §3/§4；其余（append 并发事务、双事件 publishBoth、嵌套防护、字段分期、digest 脱敏）实证达标                                                                                                                                       |
| L3 AigcForge Server/权限     | ⚠️ 随 HIGH-2                | runtime 分支、PATCH 校验（400/剥离伪造字段）、taskwrite 双轨 deny、schema.json 生成物同步全部达标；44/44 pass                                                                                                                        |
| L4 SDK                       | ✅ 通过                     | `./packages/sdk/js/script/build.ts` 再生成幂等，无 diff；`SessionTaskWriteInfo`/`SessionTaskInfo`/PATCH client 与 OpenAPI 同步                                                                                                       |
| L5 App/TUI 消费者            | ✅ 兼容                     | 默认 V1 runtime 数据流与 main 一致；V2 runtime 双发 `task.updated` + `todo.updated` 投影形状与 `event-reducer.ts:176-181` 精确匹配；TUI 仅消费三字段。App `reconcile(key:"id")` 失效为 §2.1 已记录的 pre-existing 问题，本分支未改变 |

## 7. 迁移与数据契约（实证）

- `add_task_table`：表结构/索引/FK CASCADE 与 drizzle 声明逐字一致，`bun script/migration.ts --check` 经测试实际运行通过（三方同步）；
- `backfill`：逐行 `Identifier.ascending("task")` 生成 tsk\_ id（无 hex(randomblob)）；created_at/updated_at/position 保留；未知 status/priority 归一 pending/medium；**幂等实证**：journal 跟踪重跑 no-op；`applyOnly` up+journal 同事务，中途失败整体回滚；同批 id 严格递增；
- 观察项（非 finding）：backfill SELECT 无 `ORDER BY`，可加 `ORDER BY session_id, position` 加固 id/position 顺序一致性；
- TodoTable 一次性回填非持续同步，V1 写入不进 TaskTable——这是 runtime 门控双轨设计（计划 §9.2），符合预期。

## 8. Verification（全部实际运行）

| 验证                                                                                                              | 结果                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| schema/core/aigcfroge typecheck（tsgo）                                                                           | ✅ 全过                                                                                                   |
| `bun --cwd packages/schema test`                                                                                  | ✅ 39 pass                                                                                                |
| `bun --cwd packages/core test`（全量）                                                                            | ✅ 1402 pass / 0 fail，185 files                                                                          |
| `bun --cwd packages/aigcfroge test`（httpapi-session + tool/task）                                                | ✅ 44 pass                                                                                                |
| Core 定向（session-task-service/tool-taskwrite/session-todo/session-task）                                        | ✅ 24 pass                                                                                                |
| `bun run lint`                                                                                                    | ❌ **exit 1**：`task.ts:157 consistent-return`（第三轮变更引入；另有 9 个 pre-existing warning、0 error） |
| migration `--check`                                                                                               | ✅（经 database-migration.test.ts 内实际执行）                                                            |
| SDK 再生成幂等                                                                                                    | ✅ 无 diff                                                                                                |
| `git diff --check`（main...HEAD + 工作区）                                                                        | ✅                                                                                                        |
| 临时实证测试（extend 孤儿、PATCH foreign id 500、TodoProjection plain-object encode、backfill 幂等/回滚/id 递增） | ✅ 全部复现，用后已删，工作区无残留                                                                       |

## 9. Required Actions Before Approval

### Blocking（不修不批）

- [ ] HIGH-1：消除 extend 路径孤儿——`extendBackground` 加 `taskID/onSettle` 并在排队 work drain exit 后 settle，或 extend 成功路径不新建 task（回退已提交行为）；加回归测试
- [ ] HIGH-2：`Effect.die` → `Schema.TaggedErrorClass`（ForeignTaskIdError/DuplicateTaskIdError）+ handler `catchTag` 映射 400（声明进 endpoint error 列表并重生成 SDK/schema）；lint 转绿
- [ ] MEDIUM-1：`resolved` 构造使用与写列相同的 parentID 回退
- [ ] MEDIUM-2：`task.ts:137` 改 `new TodoProjection({...})` + encode 负测试

### 随手清理（不阻塞）

- [ ] `specs/v2/schema-changelog.md:22` backfill 状态改已交付
- [ ] 计划 §5.3 Layer 4/5 ✅ 口径、§9.1 tasks 字段行、roadmap "Todo M1.5" 残留、`task.ts:88` 注释 "in M2"→"until M2"
- [ ] backfill SELECT 加 `ORDER BY session_id, position`（可选加固）

## 10. Methodology

- 4 个并行审查代理分域精读：Core（L2/L3）、Server/SDK/权限（L3/L4）、迁移/Schema（L1）、全量验证+文档+L5 消费者；
- 审查依据：根 CLAUDE.md 执行宪法、根 AGENTS.md 执行协议、计划 `docs/plan/todo-task-system-upgrade.md`（范围真源）、TDD 提示词、`specs/v2/todo.md` + `schema-changelog.md`、`.aigcfroge/skills/`（effect/database）；
- 覆盖 39/39 变更文件 + 3 个未提交文件全量 diff；沿 SessionTask→TaskDriver→tool→HTTP→SDK→App/TUI 五层调用链追踪；
- 每条 HIGH/MEDIUM finding 均以临时复现测试实证后删除，源码工作区零修改。

**Confidence：HIGH**
