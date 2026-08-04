# V2 Implementation Status

## ✅ Done

### Session V2 core

- [x] Durable prompt admission (session_input inbox: steer/queue delivery)
- [x] SessionExecution (process-global, Session-ID based)
- [x] SessionRunner (Location-scoped, one provider turn at a time)
- [x] SessionRunCoordinator (coalesce joins, concurrent Sessions)
- [x] EventV2 PubSub + durable persistence
- [x] SessionProjector (projects V2 events into SessionMessage views)
- [x] V2 SessionMessage projection (user, assistant, tool, shell, synthetic)
- [x] Prompt admission via V2 API (V1→V2 bridge in handlers/session.ts)

### Tool System

- [x] V2 ToolRegistry (scoped materialization, permission checks)
- [x] INTENT_TOOL_FILTERS — intent-based tool filtering via classify()
- [x] PreToolUse/PostToolUse lifecycle hooks (module-level seam)
- [x] V2 task tool (foreground/background/external-cli/task_id-resume/judge)
- [x] Tool.makeRaw (JSON Schema tools for MCP)
- [x] ApplicationTools (location-scoped)

### Meta-Agent

- [x] MetaAgent service layer (create/get/list/attach/detach/stats/remove)
- [x] meta_agent_step wiring
- [x] PreRouter (intent classification, engine selection, @mention routing)
- [x] {{SUBAGENTS_LIST}}/{{CLI_LIST}} placeholder fillers
- [x] PROMPT_META single-sourced to core
- [x] AIGCFROGE_DISABLE_META_AGENT flag

### MCP V2

- [x] Stdio + remote transports
- [x] OAuth support (auth storage, provider, callback server)
- [x] V2 MCP domain model (Service, clients, tools, resources)

### Plugin & Hooks

- [x] MetaHooks SDK (intent, adapter, middleware registration)
- [x] ToolHooks SDK (plugin-registered tool registration)
- [x] PluginContext (agent, aisdk, catalog, command, integration, meta, tool hooks)

### Session Operations

- [x] V2 SessionRevert (revert/unrevert/cleanup)
- [x] V2 SessionSummary (diff: additions/deletions/files)
- [x] V2 SessionShare (internal: reference/output/full scopes)
- [x] Fork endpoint POST /api/session/:sessionID/fork
- [x] Session children + interrupt endpoints

### Phase 6 — Intelligence Enhancements

- [x] Structured Handoffs (LLM summary via catalog.model.small, injected into delegate prompt)
- [x] Judge multi-model arbitration (parallel N delegates + LLM merge)
- [x] External CLI session recovery (parseResumeHint + resumeId + DB persistence)
- [x] Symlink-aware path containment (FSUtil.resolveSecurePath)
- [x] Fork endpoint + session.next.forked event

### Schema & Database

- [x] Drizzle ORM + Effect SQLite integration
- [x] TypeScript migration system (bun script/migration.ts --check)
- [x] ADR-10: Schema versioning policy (backward-compat via migration, incompatible via two-phase)
- [x] ~16 incremental migrations

### Production Hardening

- [x] Catch Everything audit (runner turn boundary, drainShell interrupt fix)
- [x] Observability logging (Judge merge, summary gen, CLI resume, delegateJudge)
- [x] catchDefect on missing LLMClient/Catalog (serviceOption pattern)
- [x] register/unregister pattern for PreToolUse/PostToolUse (plugin lifecycle)

### Task System (Todo/Task 升级 M0/M1)

- [x] SessionTask Schema contract (shared package, stable `tsk_` id + parentID, literal status/priority)
- [x] SessionTask Service (incremental CRUD, `task.updated` EventV2) replacing SessionTodo
- [x] task table (id PK, parent_id, session_id FK, output_digest nullable column) via drizzle migration pipeline
- [x] Dual-track TaskDriver ↔ Task linkage: track A `parent_task_id`, track B auto-create + settle writeback
- [x] Writeback state machine: completed / failed (error digest) / cancelled, childSessionID in outputDigest
- [x] taskwrite LLM tool (registered in builtins) — M0 fields; `outputDigest` persisted via `SessionTask.patch` in M2

## 🔄 In Progress

### V2 Config

- Schema defined in core/src/config.ts (agents, providers, mcp, skills, permissions...)
- spec review in specs/v2/config.md (11 groups)
- Remaining: RuntimeFlags migration, consumer migration — deferred to Phase 5 V1 removal

### TUI Package Extraction

- TUI EventV2 consumer ready
- Pending: full extraction plan

### Legacy Storage Removal

- remove-opencode-db spec exists
- Pending: execution

## 📋 Planned

### Todo/Task 升级（Todo 计划 M0-M5，见 [docs/plan/todo-task-system-upgrade.md](../../docs/plan/todo-task-system-upgrade.md)）

- ✅ M0: SessionTask Schema（`packages/schema/src/session-task.ts`，TaskStatus/TaskPriority Literal）
- ✅ M1: SessionTask Service 替代 SessionTodo + `PATCH /session/{id}/task` 写 API + **TaskDriver↔Task 双轨联动**（轨 A `parent_task_id` 显式关联 / 轨 B 委派自动建 todo，元智能体编排可观测性）
- ✅ M2a: `output_digest` 落库（迁移 `20260802043814_add_task_output_digest`）+ `SessionTask.patch` 持久化 digest（无 digest 的 patch 不清空）+ `GET /session/{id}/task` 读取端点（重载恢复数据源）
- ✅ M2b: SessionTodoProgress 脉冲线内嵌节点（`session-todo-progress-model` 纯逻辑 + 组件挂载 timeline session-progress 容器，无 todo 时零改动）+ **移除底部 SessionTodoDock**（composer dock()/todoCollapsed/stories/ready 全清，保留 revert rolled/lift）+ 重载恢复（挂载时 `sync().session.todo` 拉取）
- ✅ M2c: 可交互折叠浮层（点击统计/节点展开 checkbox 列表，`client.session.task.update` PATCH 回写；新增 `session_task` store 消费 `task.updated` 带稳定 id）+ E2E（nodes/折叠/PATCH/reload 恢复，playwright 2 用例通过）
- ✅ M3a: ScheduledJobRunner（`arm` 重扫 TaskTable 重建 next-run 队列 = 重启 re-arm；`tick` 触发 + 每路径 settle 三分支；recurring 完成后 re-arm 下一 cron 匹配）+ 分钟级 cron 纯函数（`session/schedule.ts`）+ `agent_id`/`scheduled_at`/`recurrence` 落列（迁移 `20260802093236_add_task_schedule_fields`）+ unattended 权限策略（预授权 ruleset：allow 规则不被 ask→deny 转换，测试证明 unattended 子会话可读）+ **生产接线**：daemon（启动 arm + 分钟 tick + `task.updated` re-arm，`ScheduledJob.daemonNode` 挂入 httpapi app 图）+ 生产 executor（`session/scheduled-job-executor.ts`，TaskDriver unattended 子会话 `attended: false` 驱动 prompt，DelegateError 分类 failed/cancelled）
- ✅ M3b-1: task_schedule Tool（注册/暂停/恢复/删除定时 task，agentID 归属；builtins 注册）
- ✅ M3b-2: 定时任务 UI（标题左侧 `⚡ nextRun` chip + dot-grid "定时任务" 菜单项 + 弹层列表/启停走单任务 `PATCH /session/:id/task/:taskID`；数据源 `SessionTask.Info.nextRun` 派生）
- ✅ M4: AgentTaskHub（入口 = 标题 dot-grid"智能体"菜单 + 弹层，计划 §5.7，复用 M3 §5.6 模式；三区：我的智能体（非 subagent 全 agent + 未归属桶）+ agent 详情（跨 session 任务聚合 + **定时任务完整管理**：checkbox 启停走单任务 PATCH、删除 = 原子 `DELETE /session/:id/task/:taskID`、新建 = `POST /session/:id/task` schedule（锚定 hub 所在会话）；省略字段服务端保留式不抹调度）+ 任务衍生 M5 占位（接 task_spawn）+ 新建占位。数据源：`GET /agent-task` 跨 session 聚合端点（新 `agent-task` httpapi group，规避 workspace-routing 对 `/session/<literal>` 的 SessionID.make die）+ SDK 再生成 + 打开时播种 session_task store 后续靠 task.updated SSE；**dead-job cron 校验下沉** SessionTask.update/append（复用 `session/schedule.ts` nextRun，TaskWriteError `invalid_schedule` → HTTP 400，关闭 HTTP PATCH 直通死洞）。**删除 Agent 联动提示已按裁决剔除**（`docs/plan` descope commit `703c5a2ca`）。E2E `agent-task-hub.spec.ts` 3 用例通过（打开→聚合→toggle PATCH 断言 + M5 衍生区分组渲染与跳转行为断言；mock-server 加 `/agent-task` 路由）
- ✅ M5: 跨模式集成（`spawned_from`/`depends_on` 落列（迁移 `20260802140709_add_task_spawn_fields`）+ `SessionTask` 写路径持久化（preserve-omitted）；task_spawn Tool（spawnedFrom=消息 id + dependsOn + agentID，builtins 注册，subagent deny 已有）+ **DAG 门控**：`session/dag.ts` blockedBy（缺失前置→放行防永久阻塞）+ findCycle；写入侧 update/append 拒环（TaskWriteError `depends_on_cycle` → HTTP 400，用有效 dependsOn 与列计算同规则）；scheduled-job trigger 前置 blockedBy 复查（B1 抢占不破坏，阻塞不 claim + task.updated/arm 重评）；hub zone 2b 任务衍生占位 → 真实只读衍生列表（按源消息分组 + 跳源消息——`spawnedFrom` 为 assistant 消息 id，经 `parentID` 解析为父 user 消息锚点 `#message-<userMsgId>`，不可解析/跨 session 降级纯文本不给死链，e2e 含跳转行为断言）；**电商三场景机制链路集成测试**（§7.1 单前置放行 / §7.2 多前置部分不放行全完成放行 / §7.3 recurring 多轮不干扰，走真实 trigger 门控）。注：V1 Todo（`aigcfroge/src/session/todo.ts` + `tool/todo.ts`）deprecated 注释已随本分支 M3b-2 落地（不删文件）
- ✅ M6: TUI 数据源脱离 V1 投影桥（sync `task` store keyed sessionID：SSE `todo.updated` 监听 → `task.updated`、hydrate 拉取 `session.todo` → `session.task.get`、老 todo store/监听/拉取物理删除）+ plugin 公开面（`state.session.todo()` 保留 `@deprecated` 投影老 Todo 形状——scheduled→pending 降级规则测试钉死；新增 `state.session.task()` 访问器，`TuiState.session.task?` 可选成员 type-only 扩 `packages/plugin/tui.ts`，其余包零 diff）+ **TaskItem 组件**（`todo-item.tsx` → `task-item.tsx`，`task-status.ts` 显式六状态 switch：pending/in_progress/completed/cancelled/failed/scheduled，scheduled → ⚡ 标记 + nextRun 文本，未知态返回 undefined 诚实回退不假装支持，颜色全走 theme token）+ 侧栏迁移（`sidebar/todo.tsx` → `sidebar/task.tsx` 读 task store、折叠 >2 逻辑保留、标题 Todo→Task、builtins 注册改名 `internal:sidebar-task`）+ routes/session TodoWrite 仅改组件名（metadata.todos 数据源不动，V1 工具寿命期 Phase 5 随工具退）。投影桥（core `todo.updated`）不拆留 Phase 5
- ✅ M7: SessionTodoProgress **统一轨道 UX 重构**（计划 §5.8 决策全录；执行提示词 `docs/plan/prompt-todo-task-m7.md`，`todo-task-m7` 分支四步审批闭环）——无 TODO 环境脉冲与 TODO 交互条合并为标题行**下方**统一轨道（同一 sticky 容器 absolute 零占位，header pb-4→pb-6 腾 22px 轨道区）+ 四态状态机（无 TODO 纯净轨道零渲染文本/节点/统计 / 激活出「任务列表」文本+10px 节点+统计 / 全完成 `--v2-state-fg-success` 成功色宽度不变 / **idle 静态留存**无动画）+ 几何修复（两端 8px 内缩由 model `trackWidth` 换算、10px 完成勾节点圆心压线、填充终点索引语义 `fillEndPct`：全完成 100→anchor pct→最后完成节点 pct→0）+ 双脉冲（环境 clip-path 扫描 ~1.4s 起随宽度放缓含停留段 + 50% 柔光保留 agent tint；任务段 `--pulse-from`→`--pulse-to` translateX 往返无 JS 帧循环，无 anchor 不跑）+ 折叠面板点击外部关闭 + **⑦ session_task 静态锁定修复**（`pickProgressTodos` 双源按新鲜度选择 + 各源更新时间戳，V1 播种不锁死 todo.updated）+ ④ 顶部白块指认（whip 条行内 animation 覆盖 `:has()` 冻结，环境脉冲与任务条互斥后消除）+ **M2 限制①随本里程碑作废**（idle 静态留存）。**只动 `packages/app`**，L1-L4 与 tui/plugin 零 diff。e2e 16 用例全绿。

**评审修复记录**（2026-08-04 差分审查 `docs/review/AigcForge_DIFFERENTIAL_REVIEW_M2_M7_2026-08-03.md` 首轮 5 HIGH + 3 MEDIUM + GATE 修复 + 二轮复审 `AigcForge_DIFFERENTIAL_REREVIEW_M2_M7_2026-08-04.md` 的残余/新增项闭环，全部带回归测试）：

首轮：
1. **HIGH-1 六态回写**：Progress 折叠面板写回改为单任务 PATCH，`preserveStatus` 六态透传（不再经 `normalizeStatus` 降级）、`flipTaskWriteStatus` 六态显式裁决、scheduled/cancelled 在折叠面板内禁用（走标题弹层管理）。失败的 recurring 任务不再被无关勾选意外重排。
2. **HIGH-2 缓存全量 PATCH 删行**：新增原子单任务端点 `PATCH/DELETE /session/:id/task/:taskID` + `POST /session/:id/task`（核心 `SessionTask.removeTask` 新增），Progress/定时任务 Popover/Agent Hub 全部改走单任务 mutation——陈旧缓存只能触及被命中的行，后台并发 append 不再被静默删除。
3. **HIGH-3 中断永久 in_progress**：`ScheduledJob.arm(now, { recover })` 启动时把「带调度字段的 in_progress 行」（死进程残留 claim）重置为 pending 并重排队；普通 task.updated 重 arm 不触碰运行中 claim（B1 防重入不破）。**交付语义为 at-least-once**（二轮 MEDIUM-5）：child 已产生外部副作用但进程在 terminal settle 前崩溃时，重启会重新执行；高风险 job 需引入幂等/durable claim。
4. **HIGH-4 scheduled 无 trigger 不变量**：`SessionTask.update/append/patch` 域边界统一拒绝「status=scheduled 但无 enabled recurrence 也无 scheduledAt」；HTTP PATCH/`task_schedule` resume 与 create 端点共享该守卫（400），tool 的 schedule-创建路径原有校验保持。
5. **HIGH-5 task_spawn 契约**：工具 description/Input.content 明确「仅记录 derived task、不执行，需另行挂调度」，不再向 LLM 宣称会运行 Agent。
6. **MEDIUM-1 跨 session 环**：写时环检测从「本 session 图」扩展为「全局可达图」（`reachableCycleGraph`，与被引用前置的运行时全局解析一致）；二轮补 append 环检查**移入同一事务**（tagged result），POST create 禁止客户端 id、由服务端统一 mint，堵住并发跨 session 闭环。
7. **MEDIUM-2 cron 性能**：`nextRun` 从逐分钟扫描（最坏 ~525k 次）改为字段跳转（月→日→时→分），稀疏 cron 单次 ~0.03ms（实测较原 47–112ms 提速 ~1500×）。**窗口语义修正（二轮 MEDIUM-4）**：day 预算 365 计数「day-loop 步数」而非「实际经过天数」——稀疏但可能的 cron（如闰日 Feb 29）可在预算内解析数年后的真实匹配（较原 365 天分钟窗口更宽松），不可能的 cron（Feb 30）在 365 步后放弃；注释与 `task_schedule` 旧文案已同步。
8. **MEDIUM-3 Hub 快照语义**：`/agent-task` 刷新按响应原子替换跨 session bucket，服务端已不存在的 session 桶被清理；二轮补**请求起始时间戳守卫**——GET 发出后到达的 task.updated（更新 `session_task_updated_at`）不会被旧响应覆盖。`listAll` 全局无目录过滤，跨目录误清不成立。
9. **GATE-1 lint**：`session-todo-progress.tsx:126` 的 `as Node | null` 改为 `instanceof Node` 收窄，`bun run lint` 全绿。
10. **新增单任务端点** 已进 SDK 再生成（无漂移）；e2e mock-server 补 `POST /task` + `PATCH/DELETE /task/:taskID` 路由，写回断言同步为单任务响应形状。

二轮（`AigcForge_DIFFERENTIAL_REREVIEW_M2_M7_2026-08-04.md`）：
11. **HIGH（二轮 HIGH-1）`task_schedule remove` 原子化**：remove 从 read-modify-reconcile 改为 `SessionTask.removeTask`（单行删除），并发 append 不再被 remove 误删。
12. **HIGH（二轮 HIGH-2）append 环检查入事务**：见第 6 条。
13. **MEDIUM（二轮 MEDIUM-1）create 响应身份**：`createTask` handler 用 `.at(-1)` 取新建行（append 返回按 position 排序的全列表，新建行持最高 position）；非空 session 第二次 POST 返回正确的新任务。
14. **MEDIUM（二轮 MEDIUM-2）position 唯一性**：append 起始 position 从 `existing.length` 改为 `max(position)+1`（task 表主键为 `(session_id, position)`，中间删除后按 length 会 PK 冲突）。
15. **MEDIUM（二轮 MEDIUM-3）Hub SSE 竞态**：见第 8 条。
16. **API 边界**：公开 `PATCH /session/:id/task/:taskID` 载荷移除 `outputDigest`（保留为 TaskDriver/ScheduledJob settle 内部能力），客户端不能覆盖执行摘要/子会话链接。
17. **并发回归补全**：`session-task-service.test.ts` 并发跨 session update 闭环拒环；`tool-taskschedule.test.ts` remove 与 append 并发不丢写；`httpapi-session` prompt directory 回归超时放宽至 60s（消除 flaky）。

三轮（评审裁决 `2026-08-04` BLOCKER B-1 + MEDIUM M-1~M-4 闭环）：
18. **B-1（裁决 BLOCKER）effect `Either`→`Result`**：`session-task-service.test.ts` 曾用 `effect@4.0.0-beta.83` 已更名的 `Either`/`Effect.either`/`Either.isLeft`，导致**整文件 20+ 用例（含 HIGH-2 并发环、HIGH-4、MEDIUM-1、MEDIUM-2 全部新回归）静默不跑**、core typecheck 3 错。已改为 `Result`/`Effect.result`/`Result.isFailure`（failure 取值字段为 `.failure`），文件 23 用例全绿、core typecheck 通过。
19. **M-1 legacy 旁路**：`replaceLegacy`（legacy TodoWrite 桥，`todo.ts` 透传 `status:"scheduled"` 且无 schedule 字段）此前无死调度守卫，可写 daemon 永不执行的任务。抽取共享 `hasDeadSchedule` 校验器，接入 update/append/patch/replaceLegacy 四条写路径；`SessionTodo.update`/`replaceLegacy` 错误通道加宽为 `TaskWriteError`；补 replaceLegacy 拒死任务测试。
20. **M-2 append 并发拒环**：并发 append 测试暴露 SQLite 延迟事务**不串行**两个跨 session 并发写（update 因争用既有行而串行，append 插新行不争用）→ 事务内检环仍可被并发绕过。给全部 task 写操作（update/append/replaceLegacy/patch/delete/removeTask）加 `Semaphore` 写锁串行化；补「并发跨 session append 只能一个落盘」测试（用显式 id 构成真环）。
21. **M-3 e2e mock 类型与保真**：`config.tasks` 由 `unknown[]` 改为结构化任务类型（消 5 个类型错误）；DELETE 缺失 id 从 200 改为 404（真实端点行为）、POST 忽略客户端 id 由 mock 统一 mint（真实端点行为）；本次改动的 e2e 文件 0 类型错误（`e2e/performance`/`e2e/smoke` 的 20 个既有类型错误不在分支 diff）。
22. **M-4 文案**：`specs/v2/todo.md` M3b-2 行「启停走 PATCH reconcile」改为单任务 `PATCH /session/:id/task/:taskID`；`session-scheduled-tasks.tsx` 注释同步；createTask 空结果从 404 改为 500 defect（不可达防御分支）。

**M2 已声明限制**（如实，非已解决）：

1. ~~SessionTodoProgress 仅在会话工作态渲染（沿袭 session-progress 可见性模型）：会话 idle 后节点与统计隐藏；如需常驻展示属产品决策项，本期不做。~~ **已随 M7 正式解决（2026-08-04，`todo-task-m7`）**：统一轨道 idle 且有任务时静态留存（轨道+勾+统计，无动画），下次 working 恢复脉冲——原限制①移除。

**M3 已声明限制**（如实，非已解决）：

1. 分钟级 cron 用本地时区，不处理 DST 边界（计划 §10 声明的分钟级简化）；day-of-month 与 day-of-week 为 AND 语义（偏离标准 cron 的 OR）。**性能与窗口语义（2026-08-04，评审 MEDIUM-2/4）**：`nextRun` 由逐分钟扫描改为字段跳转（月→日→时→分），稀疏 cron 单次 ~0.03ms（原 47–112ms）；`MAX_DAY_STEPS=365` 计数 **day-loop 步数**（非 elapsed-time horizon）——稀疏但可能的 cron（如闰日 Feb 29）可在预算内解析数年后的匹配，不可能的 cron（Feb 30）在 365 步后放弃。
2. recurring 任务一次 failed 后停跑（arm 过滤非 scheduled/pending），需人工 resume——产品语义如此，后续里程碑再议。
3. ~~task_schedule 工具的 remove 仍是 read-modify-reconcile~~ **已修复（2026-08-04，二轮 HIGH-1）**：remove 改走 `SessionTask.removeTask` 单行删除；并发 append 回归见 `tool-taskschedule.test.ts`「remove does not drop a concurrently appended task」。**UI 侧（评审 HIGH-2）**：Progress/定时 Popover/Agent Hub 的 toggle/remove/create 全部改走原子单任务 `PATCH/DELETE /session/:id/task/:taskID` + `POST /session/:id/task`，不再提交客户端缓存快照。
4. ScheduledJob **交付语义为 at-least-once**（二轮 MEDIUM-5）：child 已产生外部副作用但进程在 terminal settle 前崩溃时，重启会重新执行；高风险 job 需引入幂等/durable claim（非 exactly-once）。
5. 定时任务 prompt 经 TaskDriver 会拼接 parent_context 压缩摘要（P6.1 既有行为），非原样下发。
6. executor 行为由 stub TaskDriver 单测覆盖；真实 LLM 端到端触发未在 CI 覆盖。
7. recurring 任务在进程停机期间错过的触发不补偿：re-arm 用 `nextRun(cron, now)` 严格取未来匹配；one-shot 过期任务（`scheduled_at ≤ now`）arm 时会立即补触发——两者行为不对称是有意语义。

**M5 已声明限制**（如实，非已解决）：

1. `dependsOn` 允许跨 session 引用（trigger 门控全局 inArray 查询）；**缺失前置放行**（`blockedBy` 只对存在且非终态的前置阻塞）——防永久死锁的有意语义，代价是写错前置 id 的任务不会被拦住。**跨 session 环已关闭（2026-08-04，评审 MEDIUM-1）**：写时环检测从本 session 图扩展为全局可达图，跨 session 永久环在写入时即拒绝。
2. `task_spawn` 产物无 `scheduled_at`，本期不触发调度（M2 裁决注明）；spawn 任务要触发需另行 PATCH 加调度字段。
3. hub 衍生区跳源仅同源 session 可解析（assistant→`parentID`→`#message-<userMsgId>`）；跨 session 或父消息不在 store 时降级纯文本，不跳死链。
4. `packages/core/schema.json` 的 id/prevIds 为手工增量维护（环境无 drizzle-kit CLI），与 wip 逐行核对一致；下一次迁移生成时会自然暴露漂移。

**M6 已声明限制**（如实，非已解决）：

1. `state.session.task()` 为**可选**公开成员（`TuiState.session.task?`）：新增必需成员会连带 `packages/aigcfroge/test/fixture/tui-plugin.ts` mock 出 diff，违反"其余包零 diff"红线；TUI 内置侧栏用 `task?.() ?? []` 防御读取，第三方插件需 `?.` 守卫。
2. `state.session.todo()` 投影 scheduled→pending 降级：旧插件只能看到 pending（scheduled 不可表示于旧 status 集），桥随 Phase 5 移除。
3. `formatNextRun` 用 `new Date(x).toLocaleString()`（仓内无既有时间格式化工具，grep 确认）；文案随 locale/TZ 变化，测试只断言非空不钉死文案。
4. TUI 版 Agent Hub / 定时任务管理交互明确不做（已裁决：终端管理走 `task_schedule` 工具）。
5. routes/session `TodoWrite` 消息渲染仍显示 V1 工具输出（`metadata.todos`），非 task store——V1 工具寿命期语义，Phase 5 随工具一起退。
6. 投影桥（core `todo.updated`）未拆：TUI 已零消费（`task.updated` + `session.task.get`），桥删除在 Phase 5 V1 退役时。

**与计划的偏差声明**（M2，已调研后如实记录）：

1. SessionTodoProgress 节点 hover **未复用 TooltipV2**（计划 §5.5「tooltip 复用现有 tooltip 组件」），保留原生 `title`。证据：① 计划 §5.3 要求 `title` 保留给键盘/读屏，且 e2e 回归（`packages/app/e2e/regression/session-todo-progress.spec.ts`）断言节点带 `title` 属性——原生 title 在鼠标 hover 时同样弹出，叠加 Kobalte tooltip 会双重渲染；② `TooltipV2.Trigger`（`packages/ui/src/v2/components/tooltip-v2.tsx`）硬编码 `as="div"`，无法直接作为绝对定位的 8px 节点按钮，挂接需重构节点几何。`content` 为空的节点不设置 `title`（不弹空 tooltip）。

### Phase 5 — V1 Retirement

- Flip AIGCFROGE_V2_RUNTIME to default true after V2 path coverage validation
- Physical V1 file deletion (prompt.ts, agent.ts, processor.ts, plugin/, mcp/, etc.)
- 14 unpaired V1 Layer decisions
- RuntimeFlags → V2 Config migration
- experimental.chat.\* hooks → V2 SystemContext/SessionRunnerModel equivalents

### Post-V2 Launch Cleanup

- HttpApi backend: delete compatibility shims, shrink Zod surfaces
- Session cursor API over HTTP (EventV2 replay cursor exposure)
- Batch streamed deltas, add covering context indexes
- Durable/clustered interruption, retries, stale-owner fencing
- Process database migration claiming (currently in-process semaphore only)

## 🗂 Deferred (non-blocking)

- cross-process SQLite polling fallback for connected tails
- stream-cap websearch body collection
- ripgrep execution timeout + bounded line framing
- materialize or reject unresolved URL/file attachment sources
- syscall-level mutation confinement (openat, O_NOFOLLOW) for hostile processes
