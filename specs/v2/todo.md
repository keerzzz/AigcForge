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
