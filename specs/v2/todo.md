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
- ✅ M3b-2: 定时任务 UI（标题左侧 `⚡ nextRun` chip + dot-grid "定时任务" 菜单项 + 弹层列表/启停走 PATCH reconcile；数据源 `SessionTask.Info.nextRun` 派生）
- ✅ M4: AgentTaskHub（入口 = 标题 dot-grid"智能体"菜单 + 弹层，计划 §5.7，复用 M3 §5.6 模式；三区：我的智能体（非 subagent 全 agent + 未归属桶）+ agent 详情（跨 session 任务聚合 + **定时任务完整管理**：checkbox 启停走 task_schedule pause/resume、删除 = PATCH reconcile remove、新建 = schedule（锚定 hub 所在会话）；省略字段服务端保留式不抹调度）+ 任务衍生 M5 占位（接 task_spawn）+ 新建占位。数据源：`GET /agent-task` 跨 session 聚合端点（新 `agent-task` httpapi group，规避 workspace-routing 对 `/session/<literal>` 的 SessionID.make die）+ SDK 再生成 + 打开时播种 session_task store 后续靠 task.updated SSE；**dead-job cron 校验下沉** SessionTask.update/append（复用 `session/schedule.ts` nextRun，TaskWriteError `invalid_schedule` → HTTP 400，关闭 HTTP PATCH 直通死洞）。**删除 Agent 联动提示已按裁决剔除**（`docs/plan` descope commit `703c5a2ca`）。E2E `agent-task-hub.spec.ts` 3 用例通过（打开→聚合→toggle PATCH 断言 + M5 衍生区分组渲染与跳转行为断言；mock-server 加 `/agent-task` 路由）
- ✅ M5: 跨模式集成（`spawned_from`/`depends_on` 落列（迁移 `20260802140709_add_task_spawn_fields`）+ `SessionTask` 写路径持久化（preserve-omitted）；task_spawn Tool（spawnedFrom=消息 id + dependsOn + agentID，builtins 注册，subagent deny 已有）+ **DAG 门控**：`session/dag.ts` blockedBy（缺失前置→放行防永久阻塞）+ findCycle；写入侧 update/append 拒环（TaskWriteError `depends_on_cycle` → HTTP 400，用有效 dependsOn 与列计算同规则）；scheduled-job trigger 前置 blockedBy 复查（B1 抢占不破坏，阻塞不 claim + task.updated/arm 重评）；hub zone 2b 任务衍生占位 → 真实只读衍生列表（按源消息分组 + 跳源消息——`spawnedFrom` 为 assistant 消息 id，经 `parentID` 解析为父 user 消息锚点 `#message-<userMsgId>`，不可解析/跨 session 降级纯文本不给死链，e2e 含跳转行为断言）；**电商三场景机制链路集成测试**（§7.1 单前置放行 / §7.2 多前置部分不放行全完成放行 / §7.3 recurring 多轮不干扰，走真实 trigger 门控）。注：V1 Todo（`aigcfroge/src/session/todo.ts` + `tool/todo.ts`）deprecated 注释已随本分支 M3b-2 落地（不删文件）
- ✅ M6: TUI 数据源脱离 V1 投影桥（sync `task` store keyed sessionID：SSE `todo.updated` 监听 → `task.updated`、hydrate 拉取 `session.todo` → `session.task.get`、老 todo store/监听/拉取物理删除）+ plugin 公开面（`state.session.todo()` 保留 `@deprecated` 投影老 Todo 形状——scheduled→pending 降级规则测试钉死；新增 `state.session.task()` 访问器，`TuiState.session.task?` 可选成员 type-only 扩 `packages/plugin/tui.ts`，其余包零 diff）+ **TaskItem 组件**（`todo-item.tsx` → `task-item.tsx`，`task-status.ts` 显式六状态 switch：pending/in_progress/completed/cancelled/failed/scheduled，scheduled → ⚡ 标记 + nextRun 文本，未知态返回 undefined 诚实回退不假装支持，颜色全走 theme token）+ 侧栏迁移（`sidebar/todo.tsx` → `sidebar/task.tsx` 读 task store、折叠 >2 逻辑保留、标题 Todo→Task、builtins 注册改名 `internal:sidebar-task`）+ routes/session TodoWrite 仅改组件名（metadata.todos 数据源不动，V1 工具寿命期 Phase 5 随工具退）。投影桥（core `todo.updated`）不拆留 Phase 5
- 📋 M7（已立项 2026-08-03，待执行）：SessionTodoProgress **统一轨道 UX 重构**（计划 §5.8 决策全录；执行提示词 `docs/plan/prompt-todo-task-m7.md`）——无 TODO 环境脉冲与 TODO 交互条合并为标题行**下方**统一轨道（absolute 零占位）+ 四态状态机（无 TODO 纯净轨道 / 激活出「任务列表」文本+节点+统计 / 全完成成功色 / **idle 静态留存**）+ 几何修复（轨道两端 8px 内缩、10px 完成勾节点圆心压线、填充终点改索引语义止 anchor/最后完成节点）+ 双脉冲（环境柔光 ~1.4s 含停留；任务段 `--pulse-from`→`--pulse-to` 区间往返）+ 折叠面板点击外部关闭 + **⑦ session_task 静态锁定修复**（双源按新鲜度选择，V1 不被播种锁死）+ ④ 顶部白块指认后处理。**只动 `packages/app`**，L1-L4 与 tui/plugin 零 diff。**M2 已声明限制①随本里程碑作废**（见下）。

**M2 已声明限制**（如实，非已解决）：
1. ~~SessionTodoProgress 仅在会话工作态渲染（沿袭 session-progress 可见性模型）：会话 idle 后节点与统计隐藏；如需常驻展示属产品决策项，本期不做。~~ **已随 M7 立项作废（2026-08-03，计划 §5.8 决策 2）**：统一轨道改为 idle 且有任务时**静态留存**（轨道+勾+统计，无动画），下次 working 恢复脉冲——M7 执行落地后此条移除。

**M3 已声明限制**（如实，非已解决）：
1. 分钟级 cron 用本地时区逐分钟扫描，不处理 DST 边界（计划 §10 声明的分钟级简化）；day-of-month 与 day-of-week 为 AND 语义（偏离标准 cron 的 OR）。
2. recurring 任务一次 failed 后停跑（arm 过滤非 scheduled/pending），需人工 resume——产品语义如此，后续里程碑再议。
3. task_schedule 的 remove 是 read-modify-reconcile，同一 provider turn 并行 append 时存在丢写窗口（单写者下不可达）。
4. 定时任务 prompt 经 TaskDriver 会拼接 parent_context 压缩摘要（P6.1 既有行为），非原样下发。
5. executor 行为由 stub TaskDriver 单测覆盖；真实 LLM 端到端触发未在 CI 覆盖。
6. recurring 任务在进程停机期间错过的触发不补偿：re-arm 用 `nextRun(cron, now)` 严格取未来匹配；one-shot 过期任务（`scheduled_at ≤ now`）arm 时会立即补触发——两者行为不对称是有意语义。

**M5 已声明限制**（如实，非已解决）：
1. `dependsOn` 允许跨 session 引用（trigger 门控全局 inArray 查询）；**缺失前置放行**（`blockedBy` 只对存在且非终态的前置阻塞）——防永久死锁的有意语义，代价是写错前置 id 的任务不会被拦住。
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
- experimental.chat.* hooks → V2 SystemContext/SessionRunnerModel equivalents

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
