# Differential Review Report - Worktree

## Executive Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 4 |
| MEDIUM | 4 |
| LOW | 2 |

**Overall Risk:** HIGH  
**Recommendation:** REJECT

**Key Metrics:**
- Scope: current uncommitted tracked and untracked worktree changes
- Files reviewed: 47 changed/untracked files in scope, with focused review on execution, permissions, hot reload, MCP contributor, schema, UI, and tests
- Test coverage gaps: registry integration, Location-scoped agent file loading, added `.agent.md` hot reload, handoff end-to-end flow
- Verification: typecheck passed for `core`, `aigcfroge`, `schema`, `session-ui`, `app`; targeted tests failed in `core` and `aigcfroge`; full lint failed; targeted oxlint reported 42 warnings

## What Changed

The worktree adds or modifies:

- Tool permission handler registry and bash/read/edit handlers
- Agent file loading from `.claude/agents/*.agent.md`
- Hot reload file change tracking around V2 `SessionExecution`
- MCP server contributor registry plus an IDE contributor
- Agent schema `handoffs` plus session UI handoff button
- Session context/review UI changes
- New tests for the above areas

## Critical Findings

### HIGH: Hot reload does not reload on the first wake after a config change

**Files:** `packages/aigcfroge/src/session/hot-reload-execution.ts:22`, `packages/aigcfroge/src/session/file-change-tracker.ts:66`  
**Test Coverage:** Failing

`HotReloadSessionExecution.checkAndReload` calls `watcher.hasChanged()` once before `resume` or `wake`. `FileChangeTracker.hasChanges()` sets `pendingChange = true` when it first detects a file change, then returns `false` until the debounce window elapses.

That means the first prompt/wake after editing `CLAUDE.md`, `.claude/settings.json`, or an agent file runs with stale config. A later wake may reload, but the request that needed fresh config has already started.

Evidence:

- `bun --cwd packages/aigcfroge test test/session/file-change-tracker.test.ts test/session/file-change-tracker-debounce.test.ts test/session/config-watcher.test.ts --timeout 30000`
- Failed: `FileChangeTracker > should detect file modification`, expected `true`, received `false`

### HIGH: Agent file loading is process-CWD scoped, not Location scoped

**Files:** `packages/core/src/agent/file-loader.ts:35`, `packages/core/src/agent/file-loader.ts:83`, `packages/core/test/agent-file-loader-watch.test.ts:53`  
**Test Coverage:** Partial; test uses `process.chdir`

`AgentFileLoader` scans `.claude/agents` through `FSUtil` using a relative path. It never reads `Location.Service.directory`. The watcher test makes this pass by changing the entire process CWD to the temp workspace, which is not a valid production model for multiple Locations/sessions.

Impact:

- Multi-workspace runs can load agents from the process launch directory instead of the active Location.
- Tests hide the bug by mutating global CWD.
- This violates the V2 invariant that SessionRunner, model resolution, tool registry, permissions, and filesystem behavior are Location-scoped.

### HIGH: Tool permission handler redesign conflicts with tool architecture and is not integrated correctly

**Files:** `packages/core/src/permission/tool-handler.ts:53`, `packages/core/src/tool/registry.ts:103`, `packages/core/src/tool/AGENTS.md`  
**Test Coverage:** Failing/insufficient

The new `ToolPermissionHandler` is a process-global mutable registry used from `ToolRegistry.settle`. Package rules explicitly say the registry has no execution authorization responsibility; leaves own permission and side-effect ordering.

The implementation also does not do what its comments promise:

- `canAutoApprove` returning `{ allow: true }` does not skip leaf `PermissionV2`; built-ins like `bash` still assert permission inside their executor.
- `{ allow: "ask" }` does not create confirmation params or call `PermissionV2`; it just proceeds to `settle`.
- `getConfirmationParams` is never used.
- The registry has no unregister/clear/scope, causing cross-test and potentially cross-runtime contamination.

Evidence:

- `bun --cwd packages/core test test/permission-tool-handler.test.ts test/tool-bash-handler.test.ts test/tool-edit-handler.test.ts test/tool-read-handler.test.ts test/mcp-contributor.test.ts test/agent-file-loader.test.ts test/agent-file-loader-watch.test.ts test/tool-registry-intent.test.ts --timeout 30000`
- Failed: wildcard handler expected, exact `read_file` from another test registration won due global state.

### HIGH: Added `.agent.md` files are not tracked by the hot reload tracker

**Files:** `packages/aigcfroge/src/session/file-change-tracker.ts:36`, `packages/aigcfroge/src/session/config-watcher.ts:15`  
**Test Coverage:** Missing

`ConfigWatcher` registers `.claude/agents` as a directory pattern, but `FileChangeTracker.registerDirectory` only snapshots files that exist at initialization. A newly added `*.agent.md` is never inserted into `snapshots`, so polling cannot detect it.

This breaks a core target workflow: adding a new file-defined agent while a session is running.

## Medium Findings

### MEDIUM: MCP IDE contributor is dead code unless imported

**Files:** `packages/aigcfroge/src/mcp/contributors/ide.ts:27`, `packages/aigcfroge/src/mcp/v2-bridge.ts:45`  

`IdeMcpServerContributor` registers by module side effect, but no production file imports `packages/aigcfroge/src/mcp/contributors/ide.ts`. `buildMcpServersFromRegistry()` will return only contributors whose modules have already been loaded.

The tests for contributor merging are also order-dependent and share global state.

### MEDIUM: Handoff schema/UI is not wired end to end

**Files:** `packages/schema/src/agent.ts:32`, `packages/core/src/config/agent.ts:13`, `packages/core/src/config/plugin/agent.ts:22`, `packages/session-ui/src/components/message-part.tsx:861`, `packages/session-ui/src/components/session-turn.tsx:401`  

`Agent.Info` now requires `handoffs`, and `HandoffButton` exists, but:

- `ConfigAgent.Info` does not include `handoffs`.
- `agentKeys` does not include `handoffs`.
- Config plugin never copies handoffs into `AgentV2.Info`.
- `AgentFileLoader` does not parse handoffs from `.agent.md`.
- No `Message` caller passes the new `handoffs` prop.

The feature is effectively unreachable.

### MEDIUM: Accidental local protocol file appears to be committed

**File:** `packages/aigcfroge/.claude/CLAUDE.md:1`

The untracked file contains only `# Test`. It looks like a local artifact, not a real package protocol. Because the new hot reload watches `.claude/CLAUDE.md`, committing this can also affect runtime behavior.

### MEDIUM: App session UI changed without recorded benchmark baseline

**Files:** `packages/app/src/components/session/session-context-tab.tsx`, `packages/app/src/components/session/session-cache-diagnostics.tsx`, `packages/app/src/components/session/git-commit-bar.tsx`  

`packages/app/AGENTS.md` requires a production benchmark baseline before changing session/timeline code. No baseline or comparison artifact was present in this worktree.

## Low Findings

### LOW: Targeted lint warnings remain in changed files

Targeted oxlint on changed core files completed with 42 warnings, including:

- `packages/aigcfroge/src/session/file-change-tracker.ts`: `no-this-alias`
- `packages/core/src/agent/file-loader.ts`: unsafe `as Agent.ID`
- `packages/core/src/tool/registry.ts`: unsafe assertions around tool input and handler result
- `packages/aigcfroge/src/session/hot-reload-execution.ts`: `sessionID as never`
- several unused imports in new tests and `handoff-button.tsx`

### LOW: UI text/i18n polish gaps

Some new UI strings are hard-coded or use symbols directly, e.g. `tokens` in `session-context-tab.tsx` and the arrow glyph in `handoff-button.tsx`. This is not the merge blocker, but it misses the established i18n/icon style.

## Test Coverage Analysis

**Coverage result:** Not acceptable.

Failing commands:

```bash
bun --cwd packages/core test test/permission-tool-handler.test.ts test/tool-bash-handler.test.ts test/tool-edit-handler.test.ts test/tool-read-handler.test.ts test/mcp-contributor.test.ts test/agent-file-loader.test.ts test/agent-file-loader-watch.test.ts test/tool-registry-intent.test.ts --timeout 30000
```

```bash
bun --cwd packages/aigcfroge test test/session/file-change-tracker.test.ts test/session/file-change-tracker-debounce.test.ts test/session/config-watcher.test.ts --timeout 30000
```

Missing tests:

- `ToolRegistry.settle` behavior for `allow`, `ask`, and `deny`
- Location-scoped `.claude/agents` loading without `process.chdir`
- hot reload detection for newly added `.agent.md`
- end-to-end handoff config -> agent -> message UI action
- production import path for MCP contributor registration

## Blast Radius Analysis

| Area | Risk | Blast Radius |
|------|------|--------------|
| `ToolRegistry.settle` permission preflight | HIGH | All tool executions |
| `AgentV2.fileLayer` in `LocationServiceMap` | HIGH | All Location-scoped agent resolution when flag enabled |
| `HotReloadSessionExecution.layer` in app runtime | HIGH | All V2 session wake/resume when flag enabled |
| `Agent.Info` schema and SDK types | MEDIUM | Agent config/API consumers |
| Session UI context/review changes | MEDIUM | Session panel and review rendering |

## Historical Context

Relevant protocol constraints:

- `packages/core/src/tool/AGENTS.md`: registry has no execution authorization dependency; leaves own permission and side-effect ordering.
- `CLAUDE.md`: security gates require path/command/URL validation and active testing.
- `CLAUDE.md`: changed code must pass lint, affected typecheck, and affected package tests.
- `packages/app/AGENTS.md`: session/timeline code changes require benchmark baseline.

## Recommendations

### Immediate Blocking

- Remove or redesign `ToolPermissionHandler`; keep execution authorization in leaf tools or introduce a scoped service with a clear architecture change and integration tests.
- Fix hot reload semantics so the first wake after a completed file write reloads fresh config, or make the debounce/event model explicit and testable.
- Make file-defined agents Location-scoped by using `Location.Service.directory`, not process CWD.
- Track newly added `.agent.md` files, not only files present during initialization.
- Remove `packages/aigcfroge/.claude/CLAUDE.md` unless it is intentional and complete.
- Fix failing `core` and `aigcfroge` tests.

### Before Production

- Wire handoff through config schema, file loader, agent projection, UI caller props, and action handler, or remove the unreachable UI/schema additions.
- Import MCP contributors from a composition root or replace side-effect registration with an explicit Layer/service.
- Add benchmark evidence for the session UI/timeline changes.
- Regenerate SDK from the official script if schema/API output changed.

## Analysis Methodology

**Strategy:** Focused review of current worktree changes, risk-prioritized around execution, permissions, filesystem, hot reload, schema, and UI.

**Techniques:**

- Read project protocols: `CLAUDE.md`, root `AGENTS.md`, package `AGENTS.md`
- Used `differential-review` skill methodology
- Used codegraph for tool registry and config/agent flow context
- Static review with line references
- Targeted tests and typechecks
- Full lint plus targeted oxlint

**Verification commands run:**

- `bun --cwd packages/core typecheck` - PASS
- `bun --cwd packages/aigcfroge typecheck` - PASS
- `bun --cwd packages/schema typecheck` - PASS
- `bun --cwd packages/session-ui typecheck` - PASS
- `bun --cwd packages/app typecheck` - PASS
- `bun --cwd packages/core test ... --timeout 30000` - FAIL
- `bun --cwd packages/aigcfroge test ... --timeout 30000` - FAIL
- `bun run lint` - FAIL
- targeted `./node_modules/.bin/oxlint ...` - 42 warnings, 0 errors
- `git diff --check` - PASS

**Limitations:**

- Scope was current worktree, not the full `main..HEAD` branch history.
- UI was reviewed statically; no browser screenshot/interaction pass was run because backend tests already produced blocking failures.

**Confidence:** HIGH for blocking findings.
