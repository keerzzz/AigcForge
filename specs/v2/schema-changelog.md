# V2 Schema Changelog

## 2026-08-27: Custom Mode M3 Phase E/F/G MCP Composition Projection and Approval Surface

> **Status: IMPLEMENTED (composition/snapshot MCP projection + scoped-grant HTTP/SDK surface + credential binding schema)**

Affected schema:

- `Composition.Plan` gains `mcp: McpPlan` (`requested` / `effective` / `denied`) built from `McpRequestedInfo`, `McpEffectiveInfo` and `McpDeniedInfo`; `McpDeniedInfo.reason` carries the fail-closed cause and optional `health` / `credentialStatus` facts, typed by the new `McpConnectionHealth` and `McpCredentialStatus` literals.
- `Composition.SnapshotDataV2` gains `mcp: SnapshotMcpInfo` (`bindings: SnapshotMcpBinding[]`, `tools: SnapshotMcpTool[]`) — server name, MCP `ref` (relativePath + revision), opaque `credentialRef` and the canonical tool names actually registered. No command, URL, header, PID, health or credential material is recorded.
- `Composition.AllowedKind` and `AssetRef` gain the `"mcp"` member (`McpRef`), so an MCP asset is addressable everywhere an asset ref is.
- `CustomProfile.Profile` gains `mcpBindings: McpBinding[]`, and `decodeProfile` is the single strict decoder for the profile (unknown keys rejected).
- New `McpScope.McpCredentialBinding` plus the single-point `workspaceID` sentinel codec (`normalizeWorkspaceId` / `denormalizeWorkspaceId`, ADR-21 §2.2 v1.2): the DB column is `not null` with `""` for a workspace-less Location, so the uniqueness constraint covers the common case, and the sentinel is translated in exactly one place.
- New exported helper `Composition.mcpAuditMatchesCatalog`: one comparison shared by the Snapshot loader and the runner. The two previously sorted MCP audit names independently, and legal names like `list-files` / `list_files` order differently under the default sort than under `localeCompare`, so the runner could false-positive and block a legal turn.
- `credential-scan` promotes the secret patterns (`API_KEY_RE`, `BEARER_TOKEN_RE`, `PRIVATE_KEY_RE`, `ENV_LINE_RE`, `SECRET_PATTERNS`) and `containsSecret` to the schema public surface, so binding decode, stderr redaction and the scanner share one definition instead of three.
- Generated SDK (`v2`): scoped-grant endpoints `v2.permission.grant.list`, `v2.permission.grant.revoke` (`grantID` + `expectedRevision` CAS) and `v2.session.permission.grant` (`sessionID` + `requestID` + `level`).

Durable migrations:

- `20260825033229_secret_rachel_grey` creates `mcp_credential_binding`: opaque `credential_ref` only, `binding_revision` for CAS, `revoked_at` for the in-place `rebind` transition, and `unique(directory, workspace_id, server_name)` with `workspace_id` `not null default ''` so the constraint covers workspace-less Locations. No credential material is stored in this table.
- `20260826074345_scoped_grant_location` adds `directory` + `workspace_id` to `scoped_grant`, then **deletes rows carrying neither**. That `DELETE` is deliberate and destructive: grants issued before Location ownership cannot be attributed to a Location, and an unattributable grant must not keep authorizing anything, so it is revoked rather than migrated. The two session/level indexes are replaced with Location-leading equivalents (`scoped_grant_location_session_issued_idx`, `scoped_grant_location_level_issued_idx`).

Compatibility:

- `Plan.mcp` and `SnapshotDataV2.mcp` are optional on decode with an empty default (`withDecodingDefaultKey` + `withConstructorDefault`), so existing V1/V2 plans and frozen snapshots decode unchanged and the `version` union is not extended — evaluated and rejected a `version: 3`.
- `Profile.mcpBindings` defaults to `[]`, so profiles written before Phase E stay valid.
- No durable event family is introduced beyond the Phase D `grant.updated.1` family. The MCP projection itself introduces no migration: it is derived at resolve/freeze time from the MCP asset owner and the single `McpConnection.Service.facts()` owner, and `CompositionResolver.resolve/freeze` never calls `connect()`. The two migrations above come from credential custody and grant Location-scoping, not from the projection.

## 2026-08-25: Custom Mode M3 Phase C Remote Connection, Health, and Canonical Long Names

> **Status: IMPLEMENTED (Slice 3 + Slice 4 connection foundation)**

- `McpConnection` extends the existing single owner to remote JSON-RPC HTTP: remote DNS, connection-refused, TLS, unavailable, credential-missing, credential-expired, binding-revoked, and owner-close paths are typed. Runtime health exposes the six `McpScope.McpConnectionHealth` states and validates legal transitions; `auth-required` remains distinct from `offline`.
- Credential custody remains in `Credential.Service`: stdio receives only the documented `MCP_CREDENTIAL_API_KEY` / `MCP_CREDENTIAL_ACCESS_TOKEN` environment values; remote uses OAuth `Authorization: Bearer` per request. Neither connection projection, registry catalog, Snapshot, nor log payload contains material. Remote response headers/body are scanned before redaction/truncation reaches logs.
- Connection close is a typed `ConnectionClosedError` boundary. Both stdio Deferred requests and remote in-flight requests are owned by the same connection Scope and resolve on management close instead of hanging. The custom runtime flag is an admission gate for MCP connect/call; an admission attempt after it is disabled closes existing owned connections with `kill_switch_disabled` before returning typed `McpDisabledError`.
- Canonical MCP names keep all short existing names byte-for-byte. Long inputs deterministically compact to `mcp_<server-prefix>_<tool-prefix>_<hash16>` where the 16-hex SHA-256 suffix covers the complete `(server, tool)` identity; final validation and collision checks remain fail-closed. This supersedes the prior Phase B `McpToolNameTooLongError` deferral.
- Compatibility: no event-family or SDK change. The credential-custody table `mcp_credential_binding` is this phase's one durable migration (`20260825033229_secret_rachel_grey`, ADR-21 §2.2); it is listed with the 2026-08-27 entry so both M3 migrations read in one place. Existing frozen snapshots retain short names; long canonical names become stable only at future registration/freeze boundaries. Reconnect updates the canonical registry entry, and existing per-turn fingerprint/catalog verification rejects a changed definition fail-closed.

## 2026-08-23: Custom Mode M3 Phase D Scoped Grants and Ask Bounds

> **Status: IMPLEMENTED (store + consultation + ask bounds + attended ceiling rewrite + provenance + F0 retention/import preflight)**

- New durable owner `ScopedGrantStore` (`packages/core/src/grant/`): SQLite `scoped_grant` table (migration `20260823072731_wakeful_lady_bullseye`), single CAS writer whose state transitions are committed inside the same transaction as the new durable event family `grant.updated.1` (aggregate `grantID`, `seq+1 === grantRevision`). Consume/revoke use RETURNING-based CAS; 0 affected rows raise typed `ScopedGrant.StateError`. Consultation (`findValid`) re-reads live state every call — expiry/revocation/consumption apply immediately, no cached copy.
- `PermissionV2` consults candidate grants only when the policy verdict is `ask` (ADR-20 §2.2): deny rejects outright, allow passes outright. A hit skips the prompt; a `once` grant is consumed atomically so the next identical call asks again. The store is an optional dependency read per-call — hosts without grant wiring keep prior behavior.
- Approval asks are bounded (ADR-20 §2.7): typed `AskExpiredError` after `ttlMs` (default 300,000, clamped ≤60min), and immediate typed rejection with reason `no_responder` when no capable subscriber is attached.
- New `ApprovalPresence` service (`core/src/permission/approval-presence.ts`) is the responder-fact source: **one process-wide instance** (`LocationServiceMap` dependencies, beside `ApplicationTools`), and each event-stream connection calls `bindResponder()` for the lifetime of its connection Scope — both SSE surfaces bind (the instance `event` route and `packages/server`'s `server.event`, which the instance server also mounts). `hasResponder()` reads the live count; **there is no default "someone is there"**. `PermissionV2` takes it as a **hard dependency**: the first cut read it through `Effect.serviceOption` while nothing provided it, so `Option.isNone` held forever and every `ask` in every mode became a silent `RejectedError(no_responder)` with no prompt — a missing provider must be a layer/type error instead. Presence is a coarse liveness hint, not an authorization fact: over-reporting costs one bounded TTL wait, under-reporting denies everything, and `reply` still routes through the owning Location's PermissionV2 with the leaf `assert` as the final boundary.
- Behavior change: hosts that never attach an event stream (scripts / CI driving V2 sessions directly) now get an immediate `no_responder` rejection instead of a 300s park. TUI and App both subscribe, so interactive paths are unaffected. This is the fail-closed direction required by the M3 plan's stop condition (an `ask` may neither wait indefinitely nor default to allow); a "default online" switch for headless hosts would need a product ruling and must not be implemented by restoring a default `true`.
- `AgentV2.Info` gains optional `originRelativePath` / `originRevision`, backfilled by `agent/asset-bridge.ts` from the asset. Each custom provider turn verifies the registry entry's origin against the bound asset's `relativePath` + `revision`; a mismatch (including absence) fails closed with `SessionRunner.AgentProvenanceError`, closing the same-name impersonation variant.
- Settled `ScopedGrantStore` rows are retained for a bounded default window of 30 days instead of being deleted by the next `issue`. The Location-owned store prunes immediately and then hourly under its owner Scope; failures are classified and logged without stopping the schedule. `ScopedGrantStore.list` exposes active and in-window settled rows. Without `sessionID` it returns once/session/location rows; with `sessionID` it returns that Session's session rows plus location rows, while once rows remain explicitly un-attributed because the current schema stores no issuing Session. `findValid` still excludes consumed, revoked, and expired grants; explicit `prune` removes only settled rows outside the configured window and is idempotent.
- Agent asset import/apply now returns non-blocking permission warnings. Dangerous allows and broad wildcard allows are disclosed after config decoding; a readonly action with a wildcard resource is still broad and warns, while a readonly action scoped to `src/**` does not. The warning is transported as propose metadata and as the independent apply result `{ asset, warnings }`; the persisted asset content is not rewritten.
- Attended custom ceiling rewritten to **ask** (ADR-20 §2.6 attended half): asset-sourced non-whitelist allows become `ask` so the approval prompt actually surfaces; whitelist actions stay `allow`; saved always-approvals are appended independently and survive; unattended behavior unchanged (custom/coding paired assertions kept green).

## 2026-08-23: Custom Mode M3 Phase B Registration Placement and MCP Namespace

> **Status: IMPLEMENTED (core registry contracts; connection owner deferred to Phase C behind G3-3)**

- `ToolRegistry` gains the ADR-19 §2.2 placement dimension: registrations carry an optional owning `sessionID`, and **one visibility predicate** (Location entries visible to every Session, a Session entry only to its own) serves all three consumers — `materialize`, settle and the §2.4 collision input.
- `materialize({ sessionID? })` filters Location∪own-Session entries, and the returned `Materialization` **binds that placement**: settle resolves the winner through the materialization's placement, never the call's, and a Session-placed materialization settled by another Session fails closed with a placement mismatch. This is ADR-19 approval condition C1 — definitions and settle must read one source, otherwise a Session registration can fake staleness against the Location-wide view the runner materializes (`session/runner/llm.ts:209`/`:556` pass no `sessionID`). Guard `tool-registry-stale.test.ts` (four phases) stays green.
- New `registerSession(sessionID, tools)` on both `ToolRegistry` and the narrow `Tools.Service` capability; owner-Scope close removes exactly that registration and reveals any prior winner (session or location).
- New read-only probe `registeredNames(sessionID?)` on `ToolRegistry`: names a new registration **at that placement** would collide with. Omitting `sessionID` (Location placement) sees every occupied name, because a Location registration shadows whatever any placement serves; a Session placement does not see sibling Sessions — so two child Sessions of one composition can bind the same MCP server independently.
- New owner `McpRegistration` (`packages/core/src/tool/mcp-registration.ts`): namespaces external tools under `mcp_<server>_<tool>` ([a-z0-9_-]{1,64} server segment), validates every final name, and fails closed at its own placement with typed errors (`McpNameCollisionError` / `InvalidServerNameError` / `Tool.RegistrationError`) — all-or-nothing per server, so last-wins is never exercised by MCP producers. Phase C later finalized deterministic long-name compaction; see the 2026-08-25 entry.
- Compatibility: existing callers unchanged (omitted `sessionID` keeps pure Location-wide semantics; prior single-placement behavior identical).

## 2026-08-23: Custom Mode M3 Phase A Scope Contract (McpScope)

> **Status: PROPOSED（Phase A 契约层；运行时实现被 ADR-19/ADR-20 接受阻塞）**
> **Scope:** MCP binding/ref/health、ScopedGrant scope 语法与 decode 边界。无运行时 owner、无迁移、无 HTTP 面。

- 新增 `packages/schema/src/mcp-scope.ts`（namespace `McpScope`，已入 barrel）：
  - `McpConnectionHealth`：封闭六值 `connecting | ready | degraded | offline | auth-required | revoked`。
  - `McpServerBinding`：冻结身份事实（serverName / ref{relativePath, revision} / transport stdio⇒command、remote⇒http(s) url / 可选 opaque `credentialRef`）。**不含任何 secret 物料**；canonical 解码器以 `onExcessProperty:"error"` 钉死——token/clientSecret/env/headers 等多余键即解码失败，绝不静默剥离。全部字符串与集合字段解码期上界（§4.5-3 教训：不留 opaque 串、不等 freeze 拒绝）。
  - `GrantScope`：`once | session(sessionID) | location` 封闭 union；location scope 无法携带外来 location 身份（多余键失败）。
  - `ScopedGrant`：id(`grt_`) / action / resources(≤32) / effect 钉死 `"allow"`（grant 永不表达 deny）/ agent? / revision? / issuedAt / expiresAt?(必须晚于签发) / revokedAt?。
- 兼容性：纯新增模块，不改任何既有 schema；既有 Snapshot V1/V2 行为不受影响。
- 关联提案：[ADR-19](../../docs/architecture/adr/ADR-19-mcp-scoped-registration.md)、[ADR-20](../../docs/architecture/adr/ADR-20-scoped-grant-model.md)（均 Proposed 待裁决）；代码事实基础见 [Phase A 调研报告](../../docs/plan/custom-mode-m3-phase-a-research.md)。

## 2026-08-21: Custom Mode M2 Workflow Contract Slice

> **Status: IMPLEMENTED (Schema/Resolver contract only)**
> **Scope:** Workflow lifecycle schemas, retry lineage, structured step input/branch output, consumer-scoped Snapshot v2 bindings, frozen concurrency, and Command resolution. Runtime owner, migration, HTTP, SDK, and App adoption remain separate slices.

- `WorkflowRunStatus` adds `cancelling` and `recovery_required`; `StepRunStatus` adds `dispatching`, `cancelling`, and `execution_unknown`.
- `WorkflowRunInfo` exposes optional `parentRunID`, `rootRunID`, and `retryOfStepRunID` lineage identifiers for terminal retry runs.
- `StepDef.input` now accepts JSON objects only. Branch results use strict `{ branch, summary? }`, with summary limited to 2,000 code points; branch nodes reject `failurePolicy: continue`.
- Snapshot v2 adds consumer-scoped Prompt/Skill/Command bindings keyed by `orchestrator` or `agents/<agent>`, plus frozen `maxConcurrency` constrained to `1..8`.
- Existing Snapshot v2 rows remain readable: omitted `bindings`, `commands`, and `maxConcurrency` decode to `{}`, `[]`, and `1`. Existing flat Prompt/Skill/Command arrays remain as compatibility projections until downstream consumers adopt scoped bindings.
- `CompositionResolver` resolves Command assets into static templates, validates missing/stale refs, and includes Command refs in health/reference queries. Commands do not add instructions, capabilities, tools, or executors.

## 2026-08-19: Custom Mode Composition Platform M1 (ADR-17 v1.2) — Implemented

> **Status: IMPLEMENTED (M1 Waves W1-W4)**
> **Scope:** Full-stack implementation of Custom Mode M1 single-agent runtime: schema, SQLite snapshot table, HTTP APIs (plan, start, upgrade, health, references), SDK client capability injection (`x-aigcfroge-capabilities: product-mode-custom-v1`), kill-switch gate (`AIGCFROGE_CUSTOM_MODE`), Phase E full UI (3-column Builder, 4 preview tabs, draft persistence, snapshot panel, upgrade action, 18-locale i18n), and 50-round stability & determinism matrix.

- **ProductMode Domain (`packages/schema/src/product-mode.ts`)**:
  - Expanded the closed `ProductMode` union to five values: `chat | coding | work | assistant | custom`.
  - Compatibility & Decoding: Historical rows, omitted create inputs, and legacy event payloads continue decoding as `coding`. In contrast, `custom` mode is never defaulted or fallen back to `coding`; clients that do not negotiate custom capability receive a typed unsupported error (`UnsupportedProductModeError`).
- **AssetKindId Domain (`packages/schema/src/asset.ts`)**:
  - Registered `custom-profile` as the 8th asset kind alongside `prompt`, `skill`, `agent`, `mcp`, `command`, `workflow`, `plugin`.
  - Canonical file location: `.aigcfroge/custom-profiles/*.yaml`.
- **Composition Schemas (`packages/schema/src/custom-profile.ts` + `packages/schema/src/composition.ts`)**:
  - `CustomProfile` `Schema.Class` in `custom-profile.ts` (discrete profile schema).
  - `Plan` in `composition.ts` (resolving assets, diagnostic errors, effective capabilities, effective permissions, and deterministic digest).
  - `Snapshot` in `composition.ts` (immutable runtime record containing profile metadata, authorized agent, bound asset revisions, `SnapshotToolInfo`, and `SnapshotData`).
  - `StartInput`, `UpgradeInput`, `StartResponse` in `composition.ts`.
- **Snapshot Database Table (`packages/core/src/database/schema.ts`)**:
  - Independent SQLite table `session_composition_snapshot` (columns: `session_id text PK references session(id) on delete cascade`, `version integer not null`, `digest text not null`, `profile_path text null`, `profile_revision text null`, `data text(json) not null`, `time_created integer not null`).
  - Strict isolation: Immutable, owned by Session, strictly separate from `session.metadata`, transcript, or Context Epoch.
- **HTTP API & Capability Negotiation (`packages/aigcfroge/src/server/routes/instance/httpapi/`)**:
  - `x-aigcfroge-capabilities: product-mode-custom-v1` request header negotiation and kill-switch gate (`AIGCFROGE_CUSTOM_MODE`).
  - `POST /custom-composition/plan`: resolves proposed composition into a deterministic plan.
  - `POST /custom-composition/start`: atomic custom session creation and snapshot persistence.
  - `POST /custom-composition/upgrade`: freeze new composition for idle custom session into a new session and snapshot without mutating source.
  - `GET /custom-composition/health`: profile health check.
  - `GET /custom-composition/references`: asset references list.
  - Capable clients may use `session.children` and `session.context` as read endpoints; they return 200 for custom sessions, including an empty `{ data: [] }` result when no records exist. Clients without the capability receive `SessionNotFoundError` (HTTP 404).
  - V1 sync `prompt`/`command`/`shell` endpoints reject custom sessions with typed `UnsupportedProductModeError` (HTTP 400); custom sessions use the V2 async admission surface (`POST /api/session/:sessionID/prompt|shell|skill` or `session.prompt_async`).
  - Kill-switch semantics: `AIGCFROGE_CUSTOM_MODE` (default off) gates the creation surfaces only — `plan`, `start`, `upgrade`, and `POST /api/session/custom` fail closed with HTTP 400; existing custom sessions remain readable (history preserved), and sessions created while the flag was on are not interrupted mid-drain. Drain-level execution kill is deferred (see `docs/technical-debt.md`).
  - Fork of a custom parent is allowed for capable clients and routes to V2 `create({ parentID })`, copying the immutable snapshot; orphan custom parents (no snapshot) fail closed typed.
- **Tool Materialization & Stable Fingerprint (`packages/core/src/tool/`)**:
  - `ToolRegistry.materialize(permissions?, intent?, { allowlist? })` signature.
  - Stable `ToolRegistrationFingerprint` (4 fields: `placement`, `name`, `digest` [normalized definition/schema digest], `installationVersion`) and independent `ToolCatalogDigest` (aggregate catalog digest), captured in `Snapshot.tools` at freeze.
  - Provider-turn before-execution re-verification of both fingerprint and catalog digest against the stored snapshot, fail-closed via typed `SessionRunner.SnapshotDriftError`.
- **EventV2 & SDK Impact**:
  - Implemented session lifecycle events are: `session.next.agent.switched`, `session.next.model.switched`, `session.next.moved`, `session.next.prompted`, `session.next.prompt.admitted`, `session.next.shell.admitted`, `session.next.skill.admitted`, `session.next.context.updated`, `session.next.synthetic`, `session.next.forked`, `session.next.shell.started`, `session.next.shell.ended`, `session.next.step.started`, `session.next.step.ended`, `session.next.step.failed`, `session.next.text.started`, `session.next.text.delta`, `session.next.text.ended`, `session.next.reasoning.started`, `session.next.reasoning.delta`, `session.next.reasoning.ended`, `session.next.tool.input.started`, `session.next.tool.input.delta`, `session.next.tool.input.ended`, `session.next.tool.called`, `session.next.tool.progress`, `session.next.tool.success`, `session.next.tool.failed`, `session.next.retried`, `session.next.compaction.started`, `session.next.compaction.delta`, `session.next.compaction.ended`, `session.next.compaction.soft-warning`, `session.next.compaction.stuck`, `session.next.verify.started`, `session.next.verify.passed`, `session.next.verify.failed`, and `session.next.cache.diagnostic`. No custom-specific event names were introduced.
  - The generated `@aigcfroge/sdk` remains the contract surface for the implemented routes (including `customComposition.upgrade`).
- **App & UI Phase E (`packages/app/src/`)**:
  - 3-column Custom Builder (`CustomProjectColumnSidebar`, `CustomCompositionConfig`, `CustomPlanPreviewColumn`).
  - 4 Preview Tabs: Instructions, Capabilities, Permissions, Diagnostics.
  - Draft persistence via `Persist` store (`createCustomDraftStore`).
  - Session Side Panel: Snapshot read-only view + Upgrade action.
  - 18-locale i18n support verified by `parity.test.ts`.

## 2026-08-03: Task Spawn Fields, task_spawn Tool, and DAG Helpers (Todo/Task M5 Step 1 — recovered from wip)

- Persist M5 spawn fields on the `task` table via the drizzle-kit pipeline (`20260802140709_add_task_spawn_fields`): nullable `spawned_from` (originating message id) and `depends_on` (JSON predecessor task ids); existing rows backfill null. Registered in `migration.gen.ts` between `add_task_schedule_fields` and `backfill_task_table`.
- `SessionTask.WriteInfo`/`Info` now carry `spawnedFrom`/`dependsOn`; `update`/`append`/`replaceLegacy` persist them and preserve them through an omitting reconcile (same preserve-omitted rule as `agentID`/`scheduledAt`/`recurrence`).
- New core `task_spawn` tool (`tool/taskspawn.ts`): spawns a derived task recording `spawnedFrom` = the calling message id, optional `dependsOn` predecessors, and the owning `agentID`; registered in `tool/builtins.ts`. Subagent default deny for `task_spawn` already landed in M2/M3 (`4baeebe3d`).
- New core `session/dag.ts`: pure `blockedBy` (predecessor terminal-state gate) and `findCycle` (cycle detection) helpers; `test/dag.test.ts` covers both.
- Compatibility: additive nullable columns + optional fields; generated SDK `SessionTaskWriteInfo` regenerated (`spawnedFrom`/`dependsOn`).

### 2026-08-03 (M5 Step 3): DAG gating on the scheduled-job trigger + write-side cycle rejection

- `SessionTask.update`/`append` reject a `dependsOn` cycle via `findCycle` with a new `TaskWriteError` reason `depends_on_cycle` → HTTP 400. The write-side guard prevents a graph where no task in a cycle can ever be triggered. The `update` guard evaluates the _effective_ `dependsOn` (`input ?? existing row`, the same preserve-omitted rule as the column write) so an omitted-preserve PATCH cannot close a cycle unseen.
- `scheduled-job.ts` trigger now runs a DAG gate before claiming a task: a scheduled/pending job whose `dependsOn` predecessors are not all terminal is skipped (left scheduled/pending, NOT claimed), and re-evaluated when a `task.updated` re-arms the queue — the existing B1 in_progress claim semantics are untouched (the gate sits before the claim).
- `dag.ts blockedBy` semantics changed: a _deleted_ predecessor (absent from the task set) is released instead of blocking — otherwise deleting a predecessor would permanently deadlock its dependents. A present non-terminal predecessor still blocks.
- Compatibility: valid acyclic graphs are unaffected; a `depends_on_cycle` write now fails with 400, and a blocked trigger is skipped until its predecessors settle.

## 2026-08-03: Agent Task Cross-Session Aggregation Endpoint (Todo/Task M4 Step 3)

- New core `SessionTask.listAll()`: reads every task across all sessions from the `task` table (the M3 `agent_id` column already landed), each row keeping its owning `sessionID`/`agentID`.
- New `GET /agent-task` HTTP endpoint returning `Array<SessionTask.Info>` — the Agent Hub's cross-session aggregation source. It lives in a new `agent-task` httpapi group (root `/agent-task`) rather than under `/session/:sessionID`: the workspace-routing middleware parses `/session/<segment>` as a session id and dies on non-`ses_` literals, so a literal cross-session path cannot live under the session prefix.
- Generated SDK client `AgentTask.list` (`/agent-task`).
- Compatibility: additive read-only endpoint; no stored data changes, no migration.

### 2026-08-03 (M4 Step 4 refinement): Dead-job cron validation sinks to the write path

- `SessionTask.update`/`append` now reject any `recurrence` cron that fails `nextRun` (malformed or no future run within the search window) with a new `TaskWriteError` reason `invalid_schedule`, surfaced as HTTP 400 on `PATCH /session/:sessionID/task`. This closes the dead-job hole that the direct HTTP PATCH path reintroduced after the task_schedule tool's own guard.
- `TaskWriteError.id` is now optional (a rejected new task has no id yet).
- Compatibility: valid schedules are unaffected; a previously-accepted malformed cron now fails with 400 instead of persisting a job that can never fire.

## 2026-08-02: Task Spawn and DAG Fields (Todo/Task M5)

（未落地——M5 变更已移出本分支，完整保留在 wip 分支 `todo-task-m4m5`，待 M5 里程碑合入。移出的内容：`spawned_from`/`depends_on` 落列（迁移 `20260802140709_add_task_spawn_fields`）、`SessionTask.WriteInfo`/`Info` 写路径持久化、`task_spawn` 内建工具、`session/dag.ts` DAG 纯逻辑。注：V1 Todo（`packages/aigcfroge/src/session/todo.ts` + `tool/todo.ts`）的 `@deprecated` 注释已随本分支 M3b-2 落地，文件保留。已于 2026-08-03 随 M5 恢复落地，见本文件顶部条目。）

## 2026-08-02: SessionTask.Info nextRun Derived Field and Scheduler Production Wiring (Todo/Task M3a/M3b-1)

- `SessionTask.Info` gains an optional derived `nextRun` (ms) field — never persisted, computed at read time against the current clock: only `scheduled`/`pending` tasks carry a value; an enabled recurrence resolves to the next cron match after now, otherwise the one-shot `scheduledAt`; all other statuses omit the field. This is the M3b-2 UI data source and rides every `task.updated` payload and the task HTTP endpoints; generated SDK `SessionTaskInfo` regenerated.
- ScheduledJobRunner production wiring: the httpapi app graph now mounts `ScheduledJob.node` (shared Database/EventV2/SessionTask + production executor) and `ScheduledJob.daemonNode` — startup `arm`, a minute `tick` fiber, and a `task.updated` subscription that re-arms so new schedules, resumes, and pauses take effect immediately. The production `ScheduledExecutor` (`session/scheduled-job-executor.ts`) drives each trigger through a TaskDriver unattended child Session (`attended: false`), keeping `run` total: `DelegateError` classifies failed/cancelled and seam/infrastructure defects settle failed.
- Compatibility: `nextRun` is additive and optional; no stored data changes, no migration.
- M3b-2 UI consumes `nextRun`: the session title row renders a `⚡` chip with the earliest upcoming trigger, and the dot-grid "定时任务" popover lists scheduled tasks (checkbox toggles PATCH `status` only, preserving schedule fields server-side).

## 2026-08-02: Task Scheduled Job Columns and Recurrence Value Type (Todo/Task M3a)

- Persist M3 schedule fields on the `task` table via the drizzle-kit pipeline (`20260802093236_add_task_schedule_fields`): nullable `agent_id`, `scheduled_at` (ms), and `recurrence` (JSON) columns; existing rows backfill null.
- `SessionTask.WriteInfo`/`Info` now carry `agentID`/`scheduledAt`/`recurrence`; the write paths persist them and preserve them through an omitting reconcile (same rule as `parentID`/`outputDigest`).
- `TaskRecurrence` changed from a `Schema.Class` to a `Schema.Struct` so the value record encodes/decodes as a plain object (it is persisted as a JSON column and exchanged over HTTP); generated SDK `TaskRecurrence` shape unchanged. This is an adjudicated exception to the AGENTS.md "multi-field records use `Schema.Class`" rule — the JSON-column persistence plus HTTP exchange constraint above is the recorded justification, and the exception applies to this value type only.
- New core `ScheduledJobRunner` (single-process in-memory minute-level scheduler): `arm` re-scans the task table to rebuild the next-run queue (startup re-arm), `tick` triggers due jobs and settles each task (completed/failed/cancelled); recurring jobs re-arm to their next cron match only after a completed outcome (failed/cancelled outcomes stay settled).
- Unattended permission policy (plan §8 G2): scheduled jobs run under an agent whose permissions pre-authorize reads; explicit `allow` rules are not converted to `deny` by the unattended child ask→deny fallback.

## 2026-08-02: Task output_digest Persistence and GET Task Endpoint (Todo/Task M2a)

- Persist `output_digest` on the `task` table (nullable column) via the drizzle-kit pipeline (`20260802043814_add_task_output_digest`); `SessionTask.patch` writes the digest, and a later patch omitting it leaves the stored digest intact.
- `SessionTask.Info` maps `outputDigest` from the table, so it survives a page refresh (TaskPanel reload-recovery); DB, resolved Info, and `task.updated` payload stay in agreement — full-list `update` reconciles carry the stored digest (like `parentID`) into the resolved Info and republished event.
- New `GET /session/:sessionID/task` HTTP endpoint returning the full TaskInfo list with stable ids + persisted digest (empty session returns `[]`); generated SDK `Task.get` client method.
- Legacy `GET /session/:id/todo` V1/V2 dual-branch read path unchanged.

## 2026-08-02: SessionTask Contract, Table, and PATCH API (Todo/Task M0+M1)

- New shared `SessionTask` Schema contract (`packages/schema/src/session-task.ts`): stable `tsk_` id, literal `TaskStatus`/`TaskPriority`, optional `parentID`; M2/M3/M5 fields (outputDigest/agentID/scheduledAt/recurrence/spawnedFrom/dependsOn) declared but not yet persisted.
- New `task` table (id PK, session_id FK → session.id ON DELETE CASCADE, content/status/priority/parent_id/position + timestamps) with `task_session_idx`, generated via the drizzle-kit pipeline (`20260801230425_add_task_table`).
- New `task.updated` EventV2 (sessionID + tasks) alongside the retained `todo.updated`; both remain emitted during transition.
- New `PATCH /session/:sessionID/task` HTTP endpoint (replace-list reconcile) and generated SDK `SessionTaskUpdate` client + `SessionTaskInfo` type.
- Legacy `TodoTable`/`SessionTodo`/`TodoWrite` retained for backward compatibility; the one-shot TodoTable→TaskTable backfill migration is delivered (`20260802220000_backfill_task_table`, `tsk_` ids, unknown status/priority normalized to pending/medium).

## 2026-06-22: Simplify Session Input Promotion

- Keep `session.next.prompt.admitted.1` as the durable, client-visible record of pending Session input.
- Replace `session.next.prompt.promoted.1` with the existing `session.next.prompted.1` event when input becomes model-visible.
- Preserve the prompt endpoint, admission receipt, idempotency, steer/queue ordering, and atomic user-message projection.
- Reset experimental V2 events, projections, inputs, Context Epochs, and synchronized workspace state while preserving canonical V1 `session`, `message`, and `part` rows.

## 2026-06-22: Reset Unpublished Compaction Event

- Replace the unpublished `session.next.compaction.ended.1` payload with the current checkpoint payload and remove its legacy decoder.
- Reset experimental events, sequences, Session inputs, projected Session messages, Context Epochs, synchronized workspace rows, and Session workspace links.
- Preserve canonical V1 `session`, `message`, and `part` rows.

## 2026-06-22: Make Session Interruption Process-Local

- Remove the unprojected `session.next.interrupt.requested.1` event from the experimental durable Session event union and generated SDK.
- No canonical V1 data requires migration; experimental V2 event history containing the retired event is disposable.

## 2026-06-05: Execute Automatic Session Compaction

- Trigger automatic compaction before provider turns using the complete estimated request and absolute model-aware headroom.
- Preserve the existing structured summary contract and update prior summaries with newly compacted history.
- Store token-bounded recent history as plain serialized text inside the checkpoint instead of replaying provider-native messages.
- Keep compaction starts durable and progress deltas live-only; activate history cutover only from a durable completed summary.
- Store the completed event with the current checkpoint payload containing stable message identity, reason, summary, and recent context.
- Reload the replacement Context Epoch and continue the original pending turn after compaction.
- Preserve full durable history; compaction changes only the active model representation.
- Defer provider-overflow recovery, explicit manual compaction, and deterministic old tool-result pruning.

Record V2 database, durable-event, projected-message, HTTP, and generated SDK schema changes here. Each entry states why the contract changed and whether consumers or stored data need compatibility handling. Commit messages for schema-affecting changes should include the same summary.

This document covers meaningful contract changes introduced on the `feat/aigcfroge-embedded-api` branch since its divergence from `origin/dev`. Mechanical file moves and internal refactors are omitted unless they changed stored data, replay behavior, public HTTP or SDK shapes, or model-facing tool contracts.

## 2026-06-04 Event-Sourced Session Input Cutover

Affected schema:

- `session_input`, `session_message`, `event`, `event_sequence`, and disposable workspace beta storage.
- New synchronized `session.next.prompt.admitted.1` and `session.next.prompt.promoted.1` events.
- Experimental `SessionV2.prompt(...)`, HTTP, and generated SDK admission receipt.

Change:

- Replace inbox-local admission sequence with event-sourced prompt admission and promotion sequences.
- Give projected Session messages stable `msg_*` resource IDs distinct from `evt_*` creator event IDs.
- Give every event that creates a projected transcript resource an explicit `msg_*` resource ID. Assistant steps propagate one `assistantMessageID` through assistant-owned events.
- Reset incompatible unreleased beta event history, derived Session projections, workspace rows, and Session workspace links.

Compatibility:

- The reset preserves canonical V1 `session`, `message`, and `part` rows.
- Existing synchronized workspaces are disposable beta state and are removed by the reset.
- Before starting the new build, discard adapter-managed external workspace resources created by unreleased builds. The SQL migration cannot remove external resources through runtime adapters, and rediscovering retained resources after startup can replay incompatible beta history.
- Exact prompt retries reconcile one stable `msg_*` identity when Session, prompt, and delivery mode match.

## Earlier Branch History

### Replayable Session Event Refinement And Cursor Stream

Affected schema:

- Existing synchronized `session.next.*` event family in `packages/core/src/session/event.ts`.
- Existing projected V2 Session-message union in `packages/core/src/session/message.ts`.
- New explicit durable-event union and internal replay cursor returned by `sessions.events({ sessionID, after? })`.

Change:

- Keep the existing Session lifecycle event family and projected-message union rather than introducing them in this branch.
- Stop synchronizing text deltas, reasoning deltas, and tool-input deltas; keep them explicitly ephemeral.
- Add an explicit durable-event union for replay-safe consumers.
- Add replay-and-tail aggregate cursors backed by durable Session-event sequence.
- Encode synchronized event payloads before writing JSON storage and decode them while replaying so schema transforms remain explicit at the durable boundary.

Reason:

- Embedded Session execution needs a reconnect-safe replay stream over the existing durable log and derived chronological read model.
- Fragment streams are useful to connected renderers but must not advance durable cursors or inflate synchronized storage.

Compatibility:

- The `session.next.*` lifecycle event family predates this branch; this branch refines its experimental V2 durability and replay contracts.
- Durable replay cursors are per-aggregate event sequences; ephemeral deltas are intentionally absent after reconnect.

### Durable Step Settlement Ownership

Affected schema:

- `session.next.step.ended` and `session.next.step.failed` synchronized event version `2`.

Change:

- Bind step settlement to an explicit assistant message ID.

Reason:

- Provider-local call identifiers can repeat across turns.

Compatibility:

- Step settlement uses synchronized event version `2` because the durable payload changed.

### Durable Session Input Inbox

Affected schema:

- New `session_input` table from `20260603141458_session_input_inbox.ts`.
- Updated pending-input index from `20260603160727_jittery_ezekiel_stane.ts`.
- New `SessionInput.Admitted` schema and `Prompted.delivery` field.
- Prompt-admission conflict behavior in `SessionV2.prompt(...)`.

Change:

- Persist admitted prompts before projection with an autoincrement inbox sequence, unique message ID, Session ID, encoded prompt, `steer` or `queue` delivery mode, optional promoted event sequence, and creation time.
- Index pending inputs by Session, promotion state, delivery mode, and admission sequence.

Reason:

- Prompt admission and model-visible promotion must be separate durable operations.
- Steering must promote at safe provider-turn boundaries while queued prompts remain pending in FIFO order until continuation would otherwise end.

Compatibility:

- Database migration creates the inbox table and replaces its first pending index with a delivery-aware index.
- Exact prompt retries are idempotent; reusing a message ID for different input fails.

### Durable Session Projection Order

Affected schema:

- `session_message.seq` from `20260603040000_session_message_projection_order.ts`.
- Session-message and event indexes from `20260603001617_session_message_projection_indexes.ts`, `20260603040000_session_message_projection_order.ts`, and `20260603160727_jittery_ezekiel_stane.ts`.

Change:

- Reset pre-launch Session-message projections and add `session_message.seq` for newly projected synchronized events.
- Add event aggregate-sequence and aggregate-type-sequence indexes.
- Add Session-message sequence, type-sequence, and compatibility timestamp indexes.

Reason:

- Projected history, replay, compaction lookup, and pagination must follow durable aggregate order rather than timestamps or caller-generated IDs.
- Runner and HTTP read paths need covering indexes for their concrete lookup shapes.

Compatibility:

- Pre-launch Session-message projections are disposable because historical versions could write them without durable creator events.
- The migration resets those projections rather than inventing chronology or blocking startup.
- The timestamp compatibility index remains for legacy or transitional query shapes.

### Structured Tool Registry And Canonical Output

Affected schema:

- Core-owned typed tool registry contract.
- Canonical tool output content and structured settlement schemas.
- Canonical tagged tool file sources in `@aigcfroge/llm`.
- Durable tool called, progress, success, and failure events and projected assistant-tool states.

Change:

- Validate model input against each registered tool's parameter schema.
- Validate handler success against each tool's success schema before optional pure model-output lowering.
- Generate optional tool-definition output JSON Schema from typed success schemas.
- Persist canonical structured output and content for running, completed, and failed tools.
- Represent tool files explicitly as inline data, remote URL, or managed file URI sources rather than one ambiguous URI string.

Reason:

- Embedded tool execution needs one typed boundary between provider calls, local side effects, durable settlement, and replay.

Compatibility:

- These are additive experimental V2 runtime contracts.
- Tool results are durably settled before provider continuation.
- Legacy text, JSON, and inline-media results remain convertible; unresolved URL and file sources must be materialized or explicitly rejected before provider lowering.

### Managed Tool-Output Files

Affected schema:

- New optional managed `outputPath` and `outputPaths` fields on tool results and completed Session tool state.
- Absolute managed output paths accepted by ordinary `read` and `grep` inputs.

Change:

- Spill oversized model-facing tool text into globally unique files under Aigcfroge's shared tool-output directory.
- Include the absolute file path in the bounded preview so ordinary `read`, `grep`, and `bash` operations can inspect it.

Reason:

- Tool results need bounded model context without discarding the full output.
- Filesystem resolution admits only direct generated `tool_*` files from the managed directory, while existing permissions whitelist that directory.

Compatibility:

- Managed output is retained for a bounded period and exposed as a normal host filesystem path.

### Location-Scoped Filesystem Read And Search Contracts

Affected schema:

- Core filesystem read, directory-list, root-resolution, and named-reference inputs.
- `LocationSearch.FilesInput`, `LocationSearch.GrepInput`, and bounded result schemas.
- `read`, `glob`, and `grep` tool parameters and success payloads.

Change:

- Add bounded file reads, paged directory listings, bounded glob results, and bounded grep matches with line previews.
- Allow named project references for read-oriented operations.
- Resolve and pin canonical approved search roots before traversal.
- Exclude hidden path segments from broad V2 glob and grep discovery.

Reason:

- Embedded tools need deterministic bounds and a shared path-containment authority.
- Broad search should not disclose hidden files implicitly.

Compatibility:

- These are additive V2 tool contracts.
- Hidden-file discovery is intentionally narrower than an unconditional ripgrep `--hidden` traversal.

### Location Workspace Identity

Affected schema:

- `Location.Ref.workspaceID`.
- V2 Location HTTP middleware routing.

Change:

- Brand optional Location workspace identity as `WorkspaceV2.ID` instead of an untyped string.
- Preserve nested `location[workspace]` and workspace-header routing inputs while decoding them into the branded identity.

Reason:

- Location-scoped services and embedded routing need one typed workspace identity boundary.

Compatibility:

- Existing workspace strings remain accepted when they satisfy the workspace ID schema.
- Generated OpenAPI reflects the workspace prefix constraint.

### Structured Mutation Authority And File Leaves

Affected schema:

- New `LocationMutation.ResolveInput`, planned target, external-directory authorization, and typed path errors.
- New `write` and exact `edit` tool schemas.
- New internal file-mutation commit service.

Change:

- Resolve relative mutation paths within the active Location.
- Accept absolute internal paths and require explicit `external_directory` approval before leaf approval for external absolute paths.
- Keep named references read-oriented and reject them for mutation.
- Revalidate path authority immediately before write mechanics.

Reason:

- Mutation tools need explicit capability escalation and symlink/path-swap checks without pretending path APIs provide a syscall-level sandbox.

Compatibility:

- These are additive V2 mutation contracts.
- Richer V1 fuzzy edit behavior remains intentionally deferred.

### V2 Permission Requests And Saved Rules

Affected schema:

- `PermissionV2.Request`, `AssertInput`, `ReplyInput`, source metadata, tagged errors, and lifecycle events.
- V2 permission list, reply, and saved-rule HTTP routes and generated SDK schemas.

Change:

- Add Location-scoped pending permission requests with `once`, `always`, and `reject` replies.
- Attach optional originating tool message and call IDs.
- Preserve authored ordered rules and saved approvals as separate inputs to evaluation.
- Establish action and resource conventions for `read`, `glob`, `grep`, `edit`, `external_directory`, `bash`, `todowrite`, and `webfetch` approvals.

Reason:

- Embedded tool calls need a Core-owned authorization boundary that can suspend and resume through HTTP.

Compatibility:

- These are additive experimental V2 contracts.
- Policy authors should account for canonical resource forms; originating tool source metadata remains optional until every registry call carries its durable assistant owner.

### Initial Core V2 Built-In Tool Schemas

Affected schema:

- `read`, `glob`, `grep`, `write`, exact `edit`, `bash`, and `websearch` model-facing tool contracts.

Change:

- Add Core-owned Location-scoped built-ins with explicit parameter and success schemas.
- Bound bash output and timeout input, search result counts and previews, read sizes, directory pages, and websearch result/context controls.

Reason:

- Embedded runner launch requires a minimal typed tool set without importing legacy application orchestration.

Compatibility:

- These are additive V2 built-ins.
- Richer launch-follow-up leaves such as `apply_patch`, skill loading, task dispatch, and LSP remain separate slices.

### Bash Advisory Warnings

Affected schema:

- Optional `warnings` in the `bash` tool success payload.

Change:

- Return advisory warning strings when best-effort command-argument scanning detects external absolute paths; keep structured external `workdir` approval enforced.

Reason:

- A shell subprocess has host-user filesystem, process, and network authority. Token scanning cannot honestly provide containment.

Compatibility:

- Consumers rendering bash success should tolerate optional warning strings.

### V2 Session HTTP And Generated SDK Contracts

Affected schema:

- V2 Session list, prompt, context, message-list, compact, and wait HTTP routes.
- V2 Location query routing fields.
- Generated OpenAPI and JavaScript SDK schemas.

Change:

- Expose embedded Session creation and read-side behavior over the experimental HTTP API.
- Accept optional prompt admission `id`, `delivery`, and `resume` fields so callers can request idempotency, steering or queue semantics, and durable admission without immediate execution.
- Keep message cursors opaque and preserve configured Location routing through both legacy flat and nested `location[...]` query parameters in the V2 SDK client.

Reason:

- Remote and embedded consumers need one generated contract while Location middleware remains compatible with current server routing.

Compatibility:

- These are experimental V2 routes.
- Prompt admission now returns the admitted user-shaped message and may return a conflict error when one message ID is reused for different input.
- SDK Location GET rewriting preserves existing flat query behavior and adds nested compatibility parameters.

## 2026-06-03: Durable Session Message Pagination

Affected schema:

- Internal `SessionV2.messages()` cursor input.
- Opaque cursor payload returned by `GET /api/session/:sessionID/message`.

Change:

- Remove wall-clock `time` from the message cursor payload.
- Resolve the opaque cursor's projected message `id` to its stored `session_message.seq`.
- Apply page boundaries and ordering with durable per-session `seq` rather than `time_created` plus `id`.

Reason:

- Projected V2 message chronology is defined by synchronized Session-event order.
- Wall-clock timestamps may collide or move backwards, so they are not safe pagination boundaries.
- The list endpoint must agree with replay and context loading, which already order by durable sequence.

Compatibility:

- No database migration is required. `session_message.seq` and its session-scoped index already exist.
- The HTTP cursor remains opaque and existing cursors remain usable because they already carry the projected message `id`; older extra `time` data is ignored while decoding.
- No OpenAPI or generated SDK schema changes are required for this pagination correction.

## 2026-06-03: Public Provider And Model Catalog DTOs

Affected schema:

- Responses from `GET /api/provider`, `GET /api/provider/:providerID`, and `GET /api/model`.
- Generated `ProviderV2PublicInfo` and `ModelV2PublicInfo` SDK schemas.

Change:

- Replace internal catalog response schemas with explicit public DTOs.
- Remove provider request headers and bodies, API settings, custom enablement data, model request overrides, and variant request overrides from public responses.

Reason:

- Internal catalog records may contain credentials or provider-specific request material and must not cross the public HTTP serialization boundary.

Compatibility:

- Public V2 catalog responses intentionally expose fewer fields.
- Internal provider and model schemas remain available to the runtime.

## 2026-06-03: Durable Reasoning And Hosted Tool Replay Metadata

Affected schema:

- Durable `session.next.reasoning.started` and `session.next.reasoning.ended` events.
- Durable `session.next.tool.success` and `session.next.tool.failed` events.
- Projected assistant reasoning and settled tool message state.

Change:

- Add optional reasoning `providerMetadata`.
- Add optional durable tool `result` and project it into settled tool message state.
- Preserve projected tool-call metadata separately from optional settlement-result metadata.
- Replay provider-native reasoning and tool metadata only when the historical assistant model matches the selected continuation model.

Reason:

- Provider continuation requires signed or encrypted reasoning metadata on later turns.
- Provider-executed hosted tool results must survive projection so replay can keep hosted calls and results inline in assistant content.
- Recovery settlement must not erase provider-native call metadata needed to reconstruct a valid continuation request.

Compatibility:

- Added durable-event fields are optional so previously recorded experimental events remain decodable.
- Projected settled tool state gains model-facing result data when available.
- Projected assistant tools gain optional result-side provider metadata; the existing metadata slot remains the backward-compatible call-side slot.
- OpenAI Responses lowers reconstructed provider-executed hosted results to stored item references instead of rejecting assistant history.
- Bedrock Converse signatures, Gemini `thoughtSignature`, and OpenAI-compatible Chat `reasoning_content` now round-trip through canonical continuation parts.

## 2026-06-03: Projected Assistant Ownership And Full-Value Parts

Affected schema:

- Projected assistant text parts.
- Durable text and tool lifecycle boundaries.
- Projected assistant tool ownership.

Change:

- Preserve stable IDs on projected assistant text parts.
- Route durable tool projection updates through explicit owning assistant message IDs rather than provider-local call IDs alone.
- Replay full-value text and tool-input end checkpoints while keeping fragment deltas ephemeral.

Reason:

- Provider-local tool call IDs may repeat across turns.
- Durable projection reconstruction must not depend on ephemeral fragments that disappear after reconnect.

Compatibility:

- Earlier experimental projected assistant rows without stable text IDs are not assumed replay-compatible.
- Current V2 histories reconstruct from durable full-value checkpoints.

## 2026-06-03: Location-Scoped V2 Questions

Affected schema:

- New `QuestionV2.*` domain schemas.
- New `question.v2.asked`, `question.v2.replied`, and `question.v2.rejected` events.
- New question list, reply, and reject HTTP routes and generated SDK schemas.

Change:

- Add schemas for pending requests, question options, ordered answers, and tool ownership metadata.
- Add `GET /api/question/request`.
- Add `POST /api/session/:sessionID/question/request/:requestID/reply`.
- Add `POST /api/session/:sessionID/question/request/:requestID/reject`.

Reason:

- Embedded V2 tool execution needs a Location-owned pending-question service whose suspended replies can be settled through HTTP.

Compatibility:

- These are additive experimental V2 contracts.
- No database migration is required because pending questions are intentionally in-memory Location state.

## 2026-06-03: Core-Owned Todo Update Event

Affected schema:

- Core-owned `SessionTodo.Info`.
- Global `todo.updated` event registration.

Change:

- Register the todo update event from Core session-todo ownership and expose the existing todo item shape to the Core V2 tool.

Reason:

- Embedded V2 `todowrite` execution needs Core-owned persistence and update publication without importing legacy application orchestration.

Compatibility:

- The todo table and public todo update event shape are preserved.
- No database migration is required.

## 2026-06-03: Added Core V2 Tool Schemas

Affected schema:

- New `todowrite` tool parameters and success payload.
- New `question` tool parameters and success payload.
- New `webfetch` tool parameters and success payload.

Change:

- Add a todo replacement-list tool using `SessionTodo.Info` items.
- Add a question tool using ordered `QuestionV2.Prompt` values and ordered answer arrays.
- Add an HTTP(S) fetch tool with explicit `text`, `markdown`, and `html` formats, bounded timeout input, and optional managed output resource metadata.

Reason:

- Embedded V2 execution needs Core-owned built-ins rather than imports from legacy application orchestration.
- Explicit schemas keep model-facing definitions, runtime validation, and durable tool settlement aligned.

Compatibility:

- These are additive Location-scoped V2 built-ins.
- No database migration or public HTTP API migration is required.

## 2026-06-03: Conditional File-Mutation Stale Error

Affected schema:

- New internal `FileMutation.StaleContentError` tagged error.

Change:

- Add a typed error carrying the mutation target path when an approved exact edit no longer matches the bytes at commit time.

Reason:

- V2 exact edits must fail rather than stale-clobber a concurrent cooperating write after permission approval.

Compatibility:

- This is an additive internal error contract.
- No database, HTTP, or generated SDK schema changes are required.

## 2026-06-03: Provider Stream Watchdog Policy Deferred

Affected schema:

- No database, durable-event, HTTP, or generated SDK schema changes.
- Internal Session-runner provider-stream policy.

Change:

- Do not impose a universal provider-stream inactivity or absolute timeout.
- Remove the internal timeout error and hardcoded watchdog service.
- Defer provider timeout, retry, watchdog, durable failure-reporting, and drain-chain-release policy to a configurable design slice.

Reason:

- V1 had no universal processor inactivity watchdog.
- Providers and autonomous workloads have different runtime characteristics, so one hardcoded default is premature.

Compatibility:

- No migration or generated artifact regeneration is required.
- Embedded runner callers do not receive a runner-defined provider-stream timeout error.

## 2026-06-03: Keyed Coalescing Durable Tail Signals

Affected schema:

- No database, durable-event, HTTP, or generated SDK schema changes.
- Internal durable aggregate-tail wake delivery only.

Change:

- Replace the process-global unbounded aggregate-ID PubSub with one sliding-capacity-1 dirty signal per active tail and aggregate.
- Subscribe and register the signal before historical SQLite replay, then remove it when the tail closes.
- Re-query durable rows after each dirty edge and advance only by persisted aggregate sequence.

Reason:

- Wake notifications are advisory edges, not durable event payloads.
- Slow consumers should not retain an unbounded number of redundant wake IDs when one SQLite query can recover every committed row after their cursor.
- Per-tail signaling preserves independent cursors for multiple consumers of the same aggregate.

Compatibility:

- No migration, synchronized event version, OpenAPI, or SDK regeneration is required.
- `sessions.events({ sessionID, after? })` remains a replay-and-tail stream of every durable event in aggregate sequence order.

## 2026-06-03: Sequential V2 Apply Patch Tool

Affected schema:

- New Core-owned `apply_patch` model-facing tool parameters and success payload.
- New Core-owned pure patch hunk representation for add, update, and delete operations.

Change:

- Accept `{ patchText: string }` using the `*** Begin Patch` envelope.
- Return ordered applied-operation records carrying `type`, canonical `target`, and permission-facing `resource`.
- Resolve and approve every target before reading approved update/delete contents.
- Preflight update/delete correctness before committing operations sequentially.
- Report already-applied resources explicitly when a later commit fails.

Reason:

- Embedded V2 agents need reviewable multi-file edits without importing legacy application orchestration into Core.
- Sequential semantics are small and honest: they avoid claiming rollback or transactionality that path-based filesystem commits do not provide.

Compatibility:

- This is an additive model-facing V2 tool contract.
- Moves and atomic rollback are deliberately unsupported in the first slice and remain visible follow-ups.
- No database migration, durable-event version, public HTTP, OpenAPI, or generated SDK change is required.

## 2026-06-03: Embedded Local-Tool Recovery Alignment

Affected schema:

- No database, durable-event, HTTP, or generated SDK schema changes.
- Internal runner recovery and permission evaluation behavior only.

Change:

- Evaluate permissions through the default `build` agent when a Session omits an explicit agent, matching provider-turn execution.
- Before assembling a provider request, durably fail local tools still projected as `running` from a previous process with the existing `session.next.tool.failed` shape and `Tool execution interrupted` message.

Reason:

- Agent-less embedded Sessions previously executed as `build` while evaluating an empty permission ruleset, so the first local tool could wait forever for an approval surface the local Discord proof did not expose.
- A process lost while a local tool was running previously left a dangling tool call that made later provider continuation invalid. Recovery must settle the durable projection without replaying an abandoned side effect.

Compatibility:

- No migration, synchronized event version, OpenAPI, or SDK regeneration is required.
- Existing experimental Session databases recover dangling local-tool projections on the next provider attempt.

## 2026-06-03: V2 Skill Tool

Affected schema:

- New Core-owned `skill` model-facing tool parameters and success payload.
- Existing upstream `SkillV2` service remains the single Location-scoped skill registry.

Change:

- Accept `{ name: string }` for one skill selected from the upstream-discovered Location skill list.
- Assert `skill` permission for the selected name.
- Return V1-shaped `<skill_content name="...">` model output with the skill base directory and a bounded sampled supporting-file list.

Compatibility:

- This is an additive model-facing V2 tool contract.
- No database migration, durable-event version, public HTTP, OpenAPI, or generated SDK change is required.

## 2026-06-03: Pre-PR V2 Safety Review

Affected schema:

- V2 OpenAPI request bodies preserve requiredness instead of inheriting legacy optional-body normalization.
- Existing durable tool-failure and replay-owner schemas are reused without version changes.

Change:

- Fence replay envelopes whose aggregate ID differs from the decoded synchronized payload and persist owner claims when replay first adopts an existing unowned aggregate.
- Settle abandoned local and provider-executed tools durably before continuation; hosted failures preserve inline provider-executed replay.
- Give `apply_patch` add hunks create-only semantics, make sequential commits uninterruptible after preflight, and reject malformed patch grammar eagerly.
- Wait for initial plugin boot before materializing the `skill` built-in, discover conventional config-root skill directories, and resolve current skills again during execution.
- Sanitize provider and model public API URLs by stripping credentials, queries, and fragments.
- Keep V1-like `webfetch` network semantics: approve the requested HTTP(S) URL, allow ordinary hostnames, and delegate redirects to the HTTP transport.
- Keep V2 request bodies required in generated OpenAPI and SDK types.

Compatibility:

- No database migration is required.
- `session.next.*` databases are production-compatibile. Backward-compatible schema changes (add column, add index) are applied via TypeScript migration in `packages/core/src/database/migration/`. Incompatible changes (rename/drop/retable) require an explicit ADR with a two-phase plan: dual-write → backfill → switch, never requiring a full data reset.
- V1 returns fetched images as attachments. The first Core V2 typed settlement remains text-only, so V2 continues to reject fetched images and other non-text files until attachment settlement is designed explicitly.

## 2026-06-03: Defer V2 Bash Background Execution

Affected schema:

- Core V2 model-facing `bash` tool parameters and success payload.

Change:

- Remove the optional `background` bash parameter and process-local background settlement shape from the shipped tool.
- Retain the internal `BackgroundJob` prototype for a later integration slice.

Reason:

- The model has no registered observation or cancellation tool for background bash jobs, and process-local status is not a sufficient remote contract.

Compatibility:

- Foreground V2 bash execution is unchanged.
- Reintroduce background bash only with durable status observation, completion delivery, and explicit cancellation semantics.

## 2026-06-18: Remove Bash Description Input

Affected schema:

- V1 and Core V2 model-facing `bash` tool parameters.

Change:

- Remove the V1 required and V2 optional `description` parameter.
- Derive shell presentation from the command or a generic shell label instead of model-authored description metadata.

Compatibility:

- Existing persisted tool calls may still contain `description`, but new tool definitions no longer expose or require it.
- Shell command execution behavior is unchanged.

## 2026-06-04: Add Durable Session Context Snapshots

Affected schema:

- Add `session_context_epoch` for one active immutable baseline string, structured JSON snapshot, and baseline sequence per Session.

Change:

- Lazily initialize one durable Context Epoch snapshot at the first safe provider-turn boundary.
- Lower its exact baseline string through `LLMRequest.system` for every provider turn in the epoch.
- Reuse the stored baseline verbatim after restart or producer changes instead of resampling privileged initial context.
- Compare later observations against an overwriteable codec-encoded structured snapshot rather than rendered-text hashes.
- Expose admitted chronological context as first-class `system` Session messages while keeping the active baseline in bounded context state.

Compatibility:

- The unpublished Context Epoch schema is consolidated into one database migration; baseline and structured snapshots are operational state rather than synchronized event history.
- Existing experimental V2 Session databases remain disposable across incompatible pre-launch event-schema changes.
- Chronological context updates, replacement epochs after compaction or model switches, project instructions, skills guidance, and plugin transforms remain follow-up slices.

## 2026-06-04: Admit Chronological Session Context Updates

Affected schema:

- Add synchronized `session.next.context.updated.1` Session events containing a durable System-message ID and only exact combined model-visible text.
- Add `session_context_epoch.revision` for transactional structured-snapshot advancement.
- Add the first-class `system` Session message projection for chronological context updates.

Change:

- Reconcile Location-scoped Context Sources at each safe provider-turn boundary using one coherent observation.
- Keep the stored baseline immutable while admitting changed source renderings as chronological `Message.system(...)` history.
- Advance the overwriteable structured snapshot atomically with the rendered System-message event.
- Emit the previously stored model-meaningful removal rendering when a source is removed.
- Reject chronological system updates that would split a local tool call from its result across provider protocols; use wrapped user fallback when Anthropic native system-update placement is unsupported.

Compatibility:

- The synchronized event log retains only text actually shown to the model, not internal structured snapshots.
- Existing experimental V2 Session databases remain disposable across incompatible pre-launch event-schema changes.
- Replacement epochs after compaction or model switches, skills guidance, and plugin-defined context remain follow-up slices.

## 2026-06-04: Replace Session Context Epochs Lazily

Affected schema:

- Add nullable `session_context_epoch.replacement_seq` for idempotent lazy replacement requests.

Change:

- Mark the active Context Epoch for replacement after a model switch or completed compaction projection.
- Persist the triggering aggregate sequence so same-target replay cannot reopen an already-settled replacement.
- Render and overwrite the fresh immutable baseline and structured snapshot lazily at the next safe provider-turn boundary.
- Exclude chronological System messages from earlier epochs when assembling active provider history.

Compatibility:

- Baseline replacement is bounded operational state and does not add permanent synchronized events.
- Existing experimental V2 Session databases remain disposable across incompatible pre-launch event-schema changes.
- Compaction execution, skills guidance, and plugin-defined context remain follow-up slices.

## 2026-06-05: Register Ambient System Context Producers

Affected schema:

- No database schema changes.

Change:

- Replace the Session-specific context loader with a Location-scoped registry of stable-keyed scoped context producers.
- Register environment/date and ambient instruction producers independently, then evaluate producers concurrently in stable contribution-key order.
- Directly discover and read global plus upward project `AGENTS.md` files at each safe provider-turn boundary.
- Preserve admitted instructions across transient scan/read failures and block first-epoch initialization while any context source is unavailable.
- Retry Context Epoch preparation until stable after optimistic revision mismatches.
- Clear the active Context Epoch when a Session moves so the destination initializes a complete baseline before promoting more input.
- Fence Context Epoch initialization against the authoritative Session Location so a concurrent old-Location runner cannot recreate stale privileged context after a move.
- Canonicalize ambient instruction traversal boundaries, honor `AIGCFROGE_DISABLE_PROJECT_CONFIG`, and make non-empty aggregate updates explicitly supersede previously loaded instructions.

Compatibility:

- Watcher-backed per-file `Refreshable` instruction observations, configured sources, nested discovery, and plugin-defined context remain follow-up slices.

## 2026-06-05: Admit Selected-Agent Skill Guidance

Affected schema:

- Add `session_context_epoch.agent` so each durable baseline records its owning effective agent.
- No synchronized event, public HTTP API, or generated SDK schema changes.

Change:

- Compose selected-agent, permission-filtered available-skill guidance with Location-wide System Context before Context Epoch admission.
- Keep skill bodies behind the existing permission-checked `skill` tool and remove the unfiltered skill list from its Location-wide definition.
- Stop missing-skill errors from enumerating the unfiltered Location-wide skill catalog.
- Bind local tool authorization and pending permission requests to the provider turn's effective agent.
- Keep absolute skill locations out of available-skill guidance; expose body and location only through the permission-checked `skill` tool.
- Request Context Epoch replacement after an agent switch, dynamically re-observe the effective agent during retries, and fence first-epoch creation against the authoritative effective agent.
- Fence existing-epoch replacement against the authoritative effective agent and block cross-agent provider turns while replacement context is unavailable.
- Group the System Context algebra, registry, and built-ins under `system-context/`; keep source producers and Context Epoch persistence with their owning Skill, instruction, and Session modules; rename projected conversation selection to Session History.
- Add the canonical V1-to-V2 runtime-context parity checklist to `specs/v2/session.md`.

Compatibility:

- Existing Context Epoch rows backfill the default `build` agent and reconcile to another selected agent at the next safe provider-turn boundary.

## 2026-06-22: Simplify Session Context Rebaselining

Affected schema:

- Remove `session_context_epoch.agent`, `session_context_epoch.replacement_seq`, and `session_context_epoch.revision`.
- No synchronized event, public HTTP API, or generated SDK schema changes.

Change:

- Sample the effective agent and model once for each provider turn; selection changes apply to the next turn.
- Preserve the immutable baseline and admit ordinary System Context changes as chronological `ContextUpdated` messages.
- Rebuild the baseline directly after completed compaction instead of maintaining pending replacement state.
- Preserve the old baseline and its effective chronological updates while a post-compaction baseline cannot be rendered completely.
- Rely on the process-local Session execution lane instead of optimistic concurrency state between Context Epoch writers.

Compatibility:

- Existing Context Epoch rows migrate in place by dropping the obsolete selection and pending-replacement columns.
- Model and agent switches no longer discard earlier chronological System Context updates by forcing a new baseline.
