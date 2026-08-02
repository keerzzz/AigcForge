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
- ⬜ M4（未开始——实现已移出本分支，保留在 wip 分支 `todo-task-m4m5`，待 M4 里程碑）: AgentTaskHub 面板（composer 内 "我的智能体" 三区：智能体列表 + 任务衍生聚合（`session_task` 跨 session 按 agentID 过滤）+ 新建入口占位（衍生接 M5 task_spawn）；纯模型 `agent-task-hub-model` 可测）
- ⬜ M5（未开始——实现已移出本分支，保留在 wip 分支 `todo-task-m4m5`，待 M5 里程碑）: 跨模式集成（`spawned_from`/`depends_on` 落列（迁移 `20260802140709_add_task_spawn_fields`）+ SessionTask 字段持久化；task_spawn Tool（spawnedFrom=消息 id + dependsOn + agentID）；DAG 依赖纯逻辑（`session/dag.ts`：blockedBy 前置终态门控 + findCycle 循环拒绝））。注：V1 Todo（`aigcfroge/src/session/todo.ts` + `tool/todo.ts`）deprecated 注释已随本分支 M3b-2 落地（不删文件）

**M2 已声明限制**（如实，非已解决）：
1. SessionTodoProgress 仅在会话工作态渲染（沿袭 session-progress 可见性模型）：会话 idle 后节点与统计隐藏；如需常驻展示属产品决策项，本期不做。

**M3 已声明限制**（如实，非已解决）：
1. 分钟级 cron 用本地时区逐分钟扫描，不处理 DST 边界（计划 §10 声明的分钟级简化）；day-of-month 与 day-of-week 为 AND 语义（偏离标准 cron 的 OR）。
2. recurring 任务一次 failed 后停跑（arm 过滤非 scheduled/pending），需人工 resume——产品语义如此，后续里程碑再议。
3. task_schedule 的 remove 是 read-modify-reconcile，同一 provider turn 并行 append 时存在丢写窗口（单写者下不可达）。
4. 定时任务 prompt 经 TaskDriver 会拼接 parent_context 压缩摘要（P6.1 既有行为），非原样下发。
5. executor 行为由 stub TaskDriver 单测覆盖；真实 LLM 端到端触发未在 CI 覆盖。
6. recurring 任务在进程停机期间错过的触发不补偿：re-arm 用 `nextRun(cron, now)` 严格取未来匹配；one-shot 过期任务（`scheduled_at ≤ now`）arm 时会立即补触发——两者行为不对称是有意语义。

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
