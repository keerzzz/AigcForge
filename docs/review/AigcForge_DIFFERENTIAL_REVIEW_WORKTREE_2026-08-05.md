# AigcForge Worktree Differential Review (P0-P3 Full Scope)

> Review date: 2026-08-06
> Branch: `main` at `89f6a75d0`
> Baseline: current `HEAD`; scope = all unstaged + untracked worktree changes
> Strategy: surgical differential review + five-layer data-flow tracing; TDD red-green per phase

## 1. Executive Summary

| Severity | Found | Fixed | Open |
|---|---:|---:|---:|
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 1 | 1 | 0 |
| Low | 4 | 4 | 0 |

**Overall risk after fixes:** LOW

**Recommendation:** APPROVE

**Scope:** 27 tracked files + 6 untracked = 33 files. Four phases:
- **P0/P1** — pulse refactor (indeterminate activity, single track-local coordinate)
- **P2** — `TaskExecutionProgress` contract + delegation progress + determinate pulse
- **P3** — `revision` optimistic concurrency + 4 incremental LLM tools + HTTP API/SDK + App fold-over

## 2. What Changed

### P0/P1 (pulse refactor)
- Removed `outputFractionFromMessages` / `TASK_OUTPUT_BUDGET` (fake-progress heuristic). Pulse is now an indeterminate activity interval (completedFrontier → anchor).
- Unified nodes/fill/pulse to the track-area's local 0-100 coordinate space (CSS owns the 16px inset via `--session-progress-inset`; no JS width measurement).
- Six-state node rendering (`scheduled`/`failed` preserved, not folded to `pending`).
- `prefers-reduced-motion` handling. Shared `TRACK_INSET`/`PULSE_WIDTH` injected as CSS variables.

### P2 (execution progress)
- `TaskExecutionPhase` + `task.progress` EventV2 event + `SessionTask.recordProgress` (ephemeral, no DB write).
- `task` delegation tool: `Effect.scoped` + `Effect.forkScoped` subscribes to child `task.updated` events during foreground `delegate`; `childCompletionRatio` → parent anchor `recordProgress`. Observer is interrupted on settle (no leak).
- App: `session_task_progress` store + `event-reducer` handler (predicate-narrowed payload) + UI model `anchorProgress` → `pulse.progressPct` + CSS `data-determinate` rests at `--pulse-progress-pct`.

### P3 (revision + incremental commands)
- `revision` field on `SessionTask.Info` (server-managed, starts 1, increments on every write) + migration.
- `expectedRevision` optimistic concurrency: `patch`/`updateTask` (per-task), `update`/`reorder` (max-revision). `stale_revision` error type.
- 4 incremental LLM tools: `task_create`/`task_update`/`task_delete`/`task_reorder`. `taskwrite` keeps `expectedRevision` (full-list replace with guard).
- HTTP API: `patchTask` extended (content/priority/expectedRevision), new `reorderTask` endpoint. SDK regenerated.
- App fold-over PATCH carries `expectedRevision`.

## 3. Findings And Fixes

### MEDIUM-1: `session_task_progress` not cleared on session drop

**Files:** `event-reducer.ts` (`cleanupSessionCaches`/`cleanupDroppedSessionCaches`), `server-sync.tsx`

The new `session_task_progress` store was not wired into the session-cleanup paths — a dropped session's latest progress snapshot would linger in memory. Two `server-sync.tsx` bootstrap call sites also omitted `setSessionTask` (pre-existing gap).

**Fix:** Added `setSessionTaskProgress` param to both cleanup functions; call `setSessionTaskProgress?.(sessionID, undefined)` alongside `setSessionTask`. Passed at all 6 call sites (4 event-reducer + 2 server-sync). The server-sync call sites now also pass `setSessionTask` (fixes the adjacent pre-existing gap consistently).

**Status:** CLOSED.

### LOW-1: Fill endpoint used two incompatible coordinate spaces (P0/P1, carried from prior review)

Resolved by unifying to single track-local coordinates; `fillEndTrackPct` removed. Playwright pixel assertion <1px. **CLOSED.**

### LOW-2: `patchTask` return type needed a final guard (P3-d)

The dispatch handler (`updateTask` → `patch`) has `if (!result) return` in each branch, but TypeScript couldn't narrow `result` across branches at `return result`. Added a final `if (!result) return InvalidRequestError` guard. **CLOSED.**

### LOW-3: SDK `revision` type includes JSON edge strings (P3-e)

The generated SDK types `revision` as `number | "NaN" | "Infinity" | ...`. The app's `TodoProgressInput.revision` is `number | undefined`. Added `typeof task.revision === "number" ? task.revision : undefined` narrowing in the `tasks()` memo. **CLOSED.**

### LOW-4: `TaskTool.layer` now requires `EventV2.Service` (P2-b)

Capturing `EventV2.Service` at layer time added a requirement. Two integration test files (`session-task.test.ts`, `tool-taskwrite.test.ts`) needed `Layer.provide(EventV2.defaultLayer)` on their `taskTool` definition. Same `EventV2.defaultLayer` reference → Effect deduplicates (shared instance, not a separate pub/sub). **CLOSED.**

## 4. Five-Layer Trace

1. **Core persistence** — `SessionTask` writes `revision` (incremented) + publishes `task.updated`; `recordProgress` publishes `task.progress` (no DB write). Migration `20260806000001` backfills `revision=1`.
2. **HTTP/API** — `patchTask` dispatches to `updateTask`/`patch` with `expectedRevision`; `reorderTask` endpoint. `TaskWriteError` → 400; not-found/stale → 404.
3. **App sync** — `event-reducer` narrows `task.progress` payload (predicates, no `as any`); `session_task_progress` store; cleanup on session drop.
4. **Progress model** — `computeTodoProgress(todos, anchorProgress?)` → `pulse.progressPct` when 0..1; `childCompletionRatio` pure function.
5. **Timeline UI** — `task` tool forks scoped event observer during delegation; `SessionTodoProgress` reads progress snapshot, matches anchor taskID, sets `data-determinate` + `--pulse-progress-pct`; CSS rests at progressPct (no sweep).

No Core/API/SDK persistence or Session V2 execution contract was broken. `revision` is additive (new column + field). `task.progress` is a new event type (no existing consumer affected).

## 5. Test Coverage

| Verification | Result |
|---|---|
| Core session+tool tests | 435 pass, 0 fail |
| App unit tests | 635 pass, 0 fail |
| aigcfroge httpapi-session + httpapi-sdk | 48 pass, 0 fail |
| Target Chromium regression | 15 pass, 0 fail |
| `childCompletionRatio` unit tests | 5 pass, 0 fail |
| P2 model tests (determinate progress) | 7 pass, 0 fail |
| P3 domain tests (revision + incremental) | 16 pass, 0 fail |
| App typecheck (`tsgo -b`) | pass |
| Core + aigcfroge + schema typecheck | pass |
| Lint | 0 errors; 1 unrelated existing Core warning (`task.ts:69`) |
| `git diff --check` | pass |

## 6. Security & Engineering Gates

| Gate | Status |
|---|---|
| Catch Everything | ✓ tool execute maps `TaskWriteError`→`ToolFailure`; HTTP handler→`InvalidRequestError`(400); progress observer `Effect.scoped`+`forkScoped` (interrupted on settle, no leak); event-reducer drops malformed payload (break, no crash) |
| No Null Pointer | ✓ `expectedRevision` optional; `result` undefined guards; SDK `revision` edge-string narrowing; `childCompletionRatio` empty-list → undefined; snapshot taskID match check |
| Security First | ✓ `permission.assert` on every tool; `outputDigest` still absent from PATCH; event payload predicate-narrowed (no `as any`) |
| No Cheating | ✓ schema import alias `SessionTaskSchema` commented (genuine collision); no `as any`/`@ts-ignore`; type-only import for `TaskProgressSnapshot` (no runtime cycle) |
| Reusability | ✓ 4 tools reuse domain `append`/`updateTask`/`patch`/`removeTask`/`reorder`; HTTP `patchTask` reuses `updateTask`+`patch`; `childCompletionRatio` independent pure function |
| Clean Logs | ✓ progress events carry only phase/counts; `TaskWriteError.message` has no sensitive data |

## 7. Residual Risk

1. **`taskwrite.expectedRevision` (max-revision) cannot detect concurrent task additions** — a new task (revision 1) doesn't change the max. Real deletion prevention relies on the LLM preferring the 4 incremental tools; `taskwrite`'s guard is a backstop for concurrent modifications to existing tasks.
2. **P2 progress only for foreground delegation** — background/judge/external-cli paths don't await `delegate`, so the scoped observer isn't forked. Background task progress needs a TaskDriver-side subscription (future work).
3. **P2 progress requires the child session to use task tools** — if the child doesn't plan with `taskwrite`/`task_create`, no `task.updated` events, parent anchor stays indeterminate (no regression). **2026-08-06 裁决（MAJOR 4）**：默认子代理 deny `task_*`（`task_create`/`task_update`/`task_delete`/`task_reorder`，与 `taskwrite` 同级），P2-b 为自定义 agent 显式授权后的 opt-in 能力；默认 general 子代理下进度脉冲不触发、父 UI 脉冲保持 indeterminate，此为已接受后果。
4. **P2 progress is ephemeral** — lost on reload; no HTTP GET endpoint (real-time SSE only).
5. **e2e does not exercise determinate pulse** — mock server doesn't emit `task.progress`; determinate behavior is verified by model tests (7) + `childCompletionRatio` tests (5) + typecheck, not browser pixels.
6. **4 new LLM tools are thin wrappers without dedicated integration tests** — domain behavior is covered by 16 tests; tool registration verified by `builtins.ts` typecheck + 435 core tests.

## 8. Final Approval

**APPROVE.** All findings are closed. The worktree adds `revision`-based optimistic concurrency, 4 incremental LLM tools, a `TaskExecutionProgress` contract with delegation-reported progress, and a determinate pulse — all without breaking existing persistence, API, SDK, or Session V2 contracts. Required package tests, browser regressions, and structural invariants pass.
