# Phase 5 Implementation & Verification Walkthrough: Codex App-Server Control Plane & Lifecycle Management

## 1. Scope & Overview

Phase 5 establishes a complete, production-grade Codex app-server control plane, transport capability negotiation, turn and thread lifecycle management, the 5 interrupt invariants, and fail-safe recovery per ADR-22 (§2.7, §2.8) and Plan §16.9 / §881–§925.

All implementations strictly adhere to repository conventions (`AGENTS.md`, `CLAUDE.md`, ADR-22):

- **Worktree**: `/media/win_data/aigcfroge/.worktrees/delegation-runtime`
- **Branch**: `delegation-runtime`
- **Boundaries**: Strictly NO git commits, pushes, merges, or PRs executed.
- **Zero Mock/Stub in Production**: Real `ChildProcessSpawner` running `codex app-server --stdio` with bidirectional JSON-RPC NDJSON stream processing, typed Effect `Schema` decoding at runtime, thread-level turn concurrency isolation, and Scope-bound clean process termination.

---

## 2. Remediation of Reviewer Findings (2 P0, 5 P1)

| Finding  | Severity | Problem                                                                       | Remediation in Code                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| :------- | :------- | :---------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0-1** | P0       | Codex app-server adapter was an in-memory stub                                | Implemented `makeCodexAppServerProcessConnection` via `ChildProcessSpawner` connecting to `codex app-server --stdio`, with JSON-RPC id correlation, stream encoding/decoding, and Scope-bound lifecycle cleanup. Registered `CodexAppServer.adapter` under `"codex-app-server"` and wired in `builtInTransports.codex["app-server"]`.                                                                                                                                  |
| **P0-2** | P0       | Missing Effect Schema runtime validation matching `codex-cli 0.150.1`         | Defined complete Effect schemas matching host's `codex-cli 0.150.1` JSON schema snapshot: `UserInput` discriminated union, `InitializeParams`/`Response`, `ThreadStart`, `ThreadResume`, `ThreadFork`, `ThreadArchive`, `ThreadDelete`, `TurnStart`, `TurnSteer`, `TurnInterrupt`, and server notifications (`turn/completed`, `item/agentMessage/delta`, `error`). Handled decoding via `Schema.Decoder<T>` and `Schema.decodeUnknownSync` with typed failure errors. |
| **P1-1** | P1       | Capability negotiation did not probe method capabilities or fell back naively | Implemented two-stage capability negotiation in `negotiateCapabilities`: verifies the installed `0.150.x` initialize response AND probes method capability via `modelProvider/capabilities/read`. Falls back safely to `sdk` or `jsonl` without dropping options.                                                                                                                                                                                                      |
| **P1-2** | P1       | Turn state tracking was keyed by global `cwd` causing cross-thread collision  | Replaced `activeTurnsByCwd` with `activeTurnsByThread: Map<string, ActiveTurnRecord>` keyed by `threadId`. Added `threadId` parameter to `cancel(cwd, threadId?)` and isolated concurrent turns in the same directory.                                                                                                                                                                                                                                                 |
| **P1-3** | P1       | Interrupt blocked waiting for child fiber quiescence                          | In `DelegationExecution.interrupt`, forked `coordinator.interrupt(delegationID)` within the execution scope (`Effect.forkIn(scope)`), ensuring semantic non-blocking cleanup while child fibers cleanly drain; tests use a non-settling cleanup signal rather than a wall-clock threshold.                                                                                                                                                                             |
| **P1-4** | P1       | `resolve` had an existence oracle leaking delegation presence                 | In `DelegationService.resolve`, enforced auth before lookup by querying `(id, parent_session_id)` together from `DelegationTable`, returning uniform `DelegationInvalidStateError` before aggregate state lookup.                                                                                                                                                                                                                                                      |
| **P1-5** | P1       | `fold.ts` rejected `recovery_required -> failed` transition on same attempt   | Updated `allowedNextStatuses` in `fold.ts` to allow `recovery_required: ["failed", "cancelled"]`, enabling `DelegationService.reconcile` to settle failed deliveries on the same attempt without schema or state corruption per Plan §344.                                                                                                                                                                                                                             |

---

## 3. Implemented Architecture & Components

### 3.1 Codex App-Server Control Plane (`packages/core/src/tool/codex-app-server.ts`)

- **Protocol Schema & Typing**:
  - Full Effect Schema definitions for all client requests and server notifications.
  - Runtime validation using `Schema.Decoder<T>` ensuring typed errors on malformed payloads without unhandled defects.
- **Connection Lifecycle & Scoping**:
  - `makeCodexAppServerProcessConnection` uses `ChildProcessSpawner` running `codex app-server --stdio`.
  - Atomic request ID generator, `Map<number, Deferred<unknown, Error>>` correlation.
  - Finalizer on Scope termination cleanly issues process termination via `handle.kill()`.
- **Concurrency Isolation**:
  - `activeTurnsByThread: Map<string, ActiveTurnRecord>` prevents collisions between concurrent threads in the same workspace.

### 3.2 CLI Adapter Extension (`packages/core/src/tool/cli-adapter.ts`, `task-driver-fill.ts`)

- Added `"app-server"` transport variant to `CliAdapter["transport"]` and `cli-agent.ts`.
- Added optional lifecycle methods: `startThread`, `resumeThread`, `forkThread`, `archiveThread`, `deleteThread`, `startTurn`, `steerTurn`, `interruptTurn`.
- Exported production `CodexAppServer.adapter` and registered in `task-driver-fill.ts`.

### 3.3 Delegation Lifecycle & State Machine (`fold.ts`, `service.ts`, `execution.ts`)

- **The 5 Interrupt Invariants**:
  1. _Preserve inbox_: Queued turns remain durable across interrupts.
  2. _Immediate unblocking_: `interrupt` forks cleanup in scope and returns without waiting for a deliberately non-settling cleanup target.
  3. _At-most-once cancellation_: Claimed turns are cancelled once and not re-queued.
  4. _Idempotent no-op_: Interrupt on missing or idle delegations is a safe no-op.
  5. _Auth before lookup_: Caller authentication runs before target lookup to eliminate existence oracles.
- **External Lifecycle Cleanup**:
  - `DelegationService.close` commits the durable admission fence only; `DelegationExecution.close` owns process-local teardown, while archive remains a separate lifecycle command.
  - `archive` and `delete` cleanly invoke external thread management hooks.
  - `reconcile` transitions `recovery_required` to `failed` cleanly.

---

## 4. Test Suites & Verification Results

### 4.1 Phase 5 Targeted Suites (20 pass / 0 fail)

```bash
bun --cwd packages/core test test/delegation-codex-app-server.test.ts test/delegation-recovery.test.ts
```

- `test/delegation-codex-app-server.test.ts`: **10 pass / 0 fail**
  1. Request contracts match app-server schema (`thread/start`, `resume`, `fork`, `archive`, `delete`)
  2. Turn contracts enforce `expectedTurnId` precondition on `steer` and `turn/interrupt`
  3. `turn/interrupt` settles as cancelled/interrupted, does not fake completed
  4. Capability negotiation failure falls back to SDK/JSONL without silent option dropping
  5. Connection scope cleanly releases resources and closes transport on exit
  6. Capability negotiation probe failure (valid initialize, failing probe) falls back cleanly
  7. Schema validation failure on malformed app-server response surfaces typed error without defect
  8. Concurrent turns in same cwd with different threadIds run isolated without collision
- `test/delegation-recovery.test.ts`: **10 pass / 0 fail**
  1. Interrupt preserves inbox: queued turns remain and resume at safe boundary
  2. Interrupt does not wait for quiescence: returns without waiting for a deliberately non-settling cleanup target
  3. Interrupt does not re-queue claimed batch: cancelled is at-most-once
  4. Missing target or idle interrupt is idempotent no-op
  5. Auth before lookup: unauthorized caller fails before target lookup (no existence oracle)
  6. Close shuts down new turn admission and preserves durable child session
  7. Archive retains history and delete purges on explicit request
  8. Unexpected process/connection disruption enters `recovery_required` without blind retry
  9. Reconcile transitions `recovery_required` delivery to failed and `foldState` succeeds
  10. Service close fences admission without ambient cancel or archive side effects

### 4.2 Full Core Delegation Suite (112 pass / 0 fail)

```bash
bun --cwd packages/core test delegation-
```

- **112 pass, 0 fail, 535 expect() calls across 13 files**
- Covers all Phase 0, 1, 2, 3, 4, and 5 delegation suites.

### 4.3 Core Regressions (51 pass / 0 fail)

```bash
bun --cwd packages/core test test/task-driver-fill.test.ts test/delegation-build-participant.test.ts test/session-task.test.ts
```

- **51 pass, 0 fail, 209 expect() calls across 3 files**.

### 4.4 AigcForge Delegation Tests (16 pass / 0 fail)

```bash
bun --cwd packages/aigcfroge test delegation-
```

- **16 pass, 0 fail, 92 expect() calls across 2 files**.

### 4.5 Full Typecheck & Compilation

- `bun --cwd packages/core typecheck`: **0 errors (PASS)**
- `bun --cwd packages/aigcfroge typecheck`: **0 errors (PASS)**
- `bun --cwd packages/schema typecheck`: **0 errors (PASS)**

### 4.6 Quality & Safety Gates

- `bun script/lint-changed.ts`: **0 errors (PASS - 75 changed files, 16629 added lines)**
- `bun x prettier --check <changed files>`: **All matched files use Prettier code style (PASS)**
- `git diff --check`: **Clean (PASS - 0 whitespace/conflict errors)**
- `bun packages/core/script/migration.ts --check`: **Clean schema (PASS)**
- `bash scripts/check-agent-protocols.sh`: **All agent protocol checks passed (PASS)**
- `bash scripts/check-delegation-docs.sh`: **All documentation and gate checks passed (PASS)**
- `bun script/check-unawaited-assertions.ts`: **0 unawaited assertions across 830 test files (PASS)**

---

## 5. Worktree State & Git Constraints

- **Worktree**: `/media/win_data/aigcfroge/.worktrees/delegation-runtime`
- **Branch**: `delegation-runtime`
- **Constraint Adherence**:
  - `git commit`: **NOT EXECUTED**
  - `git push`: **NOT EXECUTED**
  - `git merge`: **NOT EXECUTED**
  - PR creation: **NOT EXECUTED**
- All changes remain unstaged/uncommitted in the worktree ready for user direction.

## Phase 6–7 continuation (2026-09-08)

- Added canonical `/api/delegation` and legacy `/delegation` HttpApi contracts with distinct `v2.delegation.*` / `legacy.delegation.*` identifiers. No delivery pagination or delivery identity is exposed.
- Added Core list/get-participant/list-turns/retry/unarchive/fork commands. Retry increments the attempt on the existing Turn and rejects completed delivery replay.
- Generated the JavaScript SDK and verified both namespaces expose all 16 operations at runtime.
- Added AgentTaskHub delegation projection and pure App/session-ui models for independent concurrent delegations, Build/Codex navigation, recovery/archived/soft-expired states.
- Soft expiry is derived from a configurable seven-day policy (`AIGCFROGE_DELEGATION_SOFT_EXPIRY_DAYS`); it does not mutate domain status or close provider threads, and expired rows are excluded from interactive current-delegation resolution while remaining available for audit.
- Added restart recovery scanning gated by `AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS` and `AIGCFROGE_EXPERIMENTAL_DELEGATION_RECOVERY`; with recovery disabled it reports durable candidates without restarting provider work.
- Recovery-enabled startup converts unconfirmed running deliveries to `recovery_required` instead of replaying provider effects. It rebuilds missing query projections from Delegation `Created` EventV2 streams, marks missing child Sessions for manual takeover, and sends ambiguous or target-mismatched legacy external bindings to `recovery_required` instead of guessing. The idempotent legacy backfill binds only a single unambiguous participant candidate.
- Core and legacy task tools expose lifecycle commands with the fixed PermissionV2 action mapping; HTTP surfaces are flag-gated and enforce Location ownership without forging tool permission sources.

### Phase 6–7 measured evidence

- `DelegationService.list` with 50 delegations now performs one batched EventV2 read and folds rows by aggregate instead of issuing 50 aggregate queries. The targeted SQLite p95 gate remains `< 200 ms`; no delivery projection table was added.
- HttpApi exerciser: coverage 333/333; targeted delegation auth 34/34; targeted delegation effect 34/34. The previous full auth run was 331/331 before the two steer routes were added.. The first full effect pass was interrupted after unrelated existing scenarios ran for an extended period; delegation-only behavior was then isolated and completed green.
- Generated SDK runtime namespace: 16 canonical and 16 legacy methods present.
- Real calendar-time seven-day observation remains intentionally open and is recorded in `docs/technical-debt.md`; it is not represented as a synthetic passing test.

- App delegation Playwright contracts executed with the existing mock-server fixture: the persistent-loop test renders recovery state, Build/Codex participants, and navigates to the durable Build child Session; the 390px narrow-viewport test keeps the Delegation panel visible and within the viewport. Both passed.

## Completion audit continuation (2026-09-09)

- Re-read `CLAUDE.md`, repository/package `AGENTS.md`, Agent/Protocol Card sources, ADR-22, and the canonical plan before approval.
- Closed an HTTP boundary inconsistency: canonical and legacy reconcile/steer/interrupt/close mutations now verify delegation existence and Location ownership before execution; the targeted 34-route coverage/auth/effect matrix passes.
- Completed the historical V1 Protocol Card execution path: `loadProtocolCard` is reusable, complex delegation protocols inject `protocol.md`, and the V1 Meta prompt requires `generate_delegation_protocol` with relevant `AGENTS.md`/`CLAUDE.md` text. The V1 Meta deny-first rules explicitly allow that registered tool. V2 continues to synthesize the same protocol inline because Core has no canonical `generate_delegation_protocol` tool; the prompt does not advertise a nonexistent second tool representation.
- Added focused protocol tests for simple, complex, and external-engine delegation documents. No protocol is invented for an unknown/external engine.
- Hardened the installed Codex app-server live test with an explicit Effect timeout boundary. The combined targeted Core suite passes 84/84; isolated app-server contract passes 10/10.
- Approval remains conditional rather than final: the plan requires a real seven-day soft-expiry observation of an actual enabled delegation cohort plus human confirmation before ADR-22 may move from Proposed to Accepted. The branch is also 69 commits behind `origin/main`, so integration/rebase conflict resolution is still required before merge approval.
- Re-audited the protocol wiring against the canonical Tool boundary: V1 exposes and permission-filters the registered `generate_delegation_protocol` tool; V2 keeps inline synthesis because Core has no such canonical tool. A regression test prevents the V2 prompt from advertising that nonexistent operation, avoiding a second Tool representation solely to mirror V1.
- Simulated replay of all 12 committed branch changes onto current `origin/main` completed cleanly. Replaying the dirty continuation found one localized textual conflict in `packages/app/e2e/utils/mock-server.ts`: upstream added `sessionStatus`, while this work adds `delegations`. The additions are semantically independent and must both be retained during the eventual human-approved rebase/merge; no real Git history mutation was performed.
- Inspected the actual local runtime database selected by `Database.path()` (`/home/keer/.local/share/aigcfroge/aigcfroge-local.db`) without mutation. The three delegation projection tables exist, but `delegation` contains zero rows; therefore there is no real long-lived delegation cohort from 2026-09-08 to observe. This confirms the seven-day gate cannot be honestly closed from current runtime evidence and needs an explicitly operated observation run rather than a synthetic timestamp test.
