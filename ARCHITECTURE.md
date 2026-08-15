# AigcForge Architecture Protocol

> **Role**: Senior architecture
> **Scope**: System structure, package topology, subsystem boundaries, cross-layer data flow
> **Nature**: Single source of truth for architecture. Aggregates dispersed architecture docs and points to authoritative sources instead of duplicating them. Code style lives in `AGENTS.md`; UI design in `DESIGN.md`.

## 1. Document Routing

| To understand | Read |
|---|---|
| First principles, gates, review flow | `CLAUDE.md` |
| Code style, branching, Effect/Schema/testing | `AGENTS.md` |
| UI design, tokens, components, i18n, a11y | `DESIGN.md` |
| Session V2 terminology & invariants | `CONTEXT.md` |
| Desktop UI architecture (pages, providers, layout) | `docs/architecture/system-blueprint.md` |
| Per-page UI architecture | `docs/architecture/pages/*.md` |
| V2 subsystem API design | `specs/v2/*.md` |
| Product Mode state and Session classification | `docs/architecture/adr/ADR-11-product-mode-session-classification.md` |
| Product PRDs & requirements | `docs/prd/` |
| Skills navigation & protocol topology | `.aigcfroge/skills/protocols/SKILL.md` |
| Enterprise code standard & refactoring | `.aigcfroge/skills/enterprise-code-standard/SKILL.md` · `.aigcfroge/skills/reuse-first-refactor/SKILL.md` |
| Quality to PR delivery gates | `.aigcfroge/skills/quality-to-pr/SKILL.md` |
| Effect coding detail | `.aigcfroge/skills/effect/SKILL.md` |
| Database schema & migrations | `.aigcfroge/skills/database/SKILL.md` |
| Theme engine internals | `.aigcfroge/skills/frontend-theming/SKILL.md` |
| Implementation plans & status | `docs/plan/`, `specs/v2/todo.md` |
| Roadmaps (milestone plans) | `docs/roadmap/` |
| Research & industry surveys | `docs/research/industry/` · `docs/research/competitors/` · `docs/research/agent/` |
| Architecture decisions | `docs/architecture/adr/` |

> **`CONTEXT.md` caveat**: despite its name, it is the Session Runtime terminology and relationship-invariant dictionary, **not** a project-wide context file. Read it when working on Session V2 internals.
>
> **`packages/llm/DESIGN.md` caveat**: it is a Discussion draft for a future `@aigcfroge/ai` package, **not** a sub-protocol of the root `DESIGN.md`. The naming is coincidental.

## 2. System Overview

```
User
 │
desktop (Electron shell) ────────┐
 │                               │
tui (terminal)                   │
 │                               ▼
 └──► aigcfroge (sidecar server, command tree, orchestration)
        │
        ├─► server (HTTP API, Effect HttpApi + OpenAPI)
        │      │
        │      └─► core (domain: Session, Event, Tool, Permission, Plugin, Catalog)
        │             │
        │             ├─► llm (Effect Schema-first provider abstraction)
        │             ├─► schema (pure Schema contracts)
        │             ├─► effect-drizzle-sqlite + effect-sqlite-node (SQLite via Drizzle+Effect)
        │             └─► system-context (Context Source algebra)
        │
        ├─► app (SolidJS frontend) ─► ui + session-ui (design system + session rendering)
        │                                  │
        │                                  └─► sdk/js (generated OpenAPI client) ─► server
        │
        ├─► tui (OpenTUI/Solid terminal UI)
        └─► plugin (plugin SDK, v1+v2 hybrid)
```

Each `►` is an Effect Layer boundary where services are provided and consumed.

## 3. Package Topology

17 workspace packages (per `packages/*/package.json`) plus `packages/sdk/js` (generated SDK), grouped by layer:

```
Entry layer
  desktop     — Electron shell (renderer embeds app + ui; sidecar forks aigcfroge node)
  aigcfroge   — sidecar server + command tree + orchestration (core engine)
  tui         — terminal UI (OpenTUI/Solid)

Application layer
  app         — SolidJS frontend (routes, layout, session UI)
  server      — HTTP API server (Effect HttpApi + OpenAPI groups)
  script      — release version computation

Domain layer
  core        — domain core (Session, Event, Tool, Permission, Plugin, Catalog, System Context)
  llm         — LLM abstraction (provider facades, routes, protocols)
  schema      — pure Schema contracts (consumed by core + llm)
  sdk/js      — OpenAPI-generated JS SDK (v1 + v2)

UI layer
  ui          — design system (v2 components, theme, i18n, icons)
  session-ui  — session rendering components (markdown stream, diff, pierre)
  storybook   — component showcase

Extension layer
  plugin      — plugin SDK (v1 frozen + v2 hybrid)

Infrastructure layer
  effect-drizzle-sqlite — vendored Drizzle + Effect SQLite adapter (oxlint-disabled vendor code)
  effect-sqlite-node     — Node SQLite driver Effect binding
  http-recorder          — HTTP record/replay cassettes (test infrastructure)
```

### Dependency directions

```
aigcfroge → {llm, plugin, sdk, server, tui, script}            (runtime deps)
aigcfroge → {core, http-recorder, script}                       (dev/build deps)
desktop → app → {ui, session-ui, sdk, core}
tui → llm → core
app → sdk → server → core
server → core (Drizzle schema, migrations)
plugin → core
app → llm (only when AIGCFROGE_EXPERIMENTAL_NATIVE_LLM=true)
core → {schema, effect-drizzle-sqlite, effect-sqlite-node, llm}
```

Dependency arrows flow downward through layers; a lower layer never imports a higher one. `effect-drizzle-sqlite` is vendored and `oxlint-disable`d; it is exempt from the project's `as any` / lint gates (see §4.8).

## 4. Core Subsystems

Each subsystem is summarized here; follow the pointer for authoritative detail.

### 4.1 Session V2

The business backbone: user input → durable admission → provider turn → event stream → UI timeline.

- Implementation: `packages/core/src/session/` (`SessionV2`, `SessionExecution`, `SessionRunner`, `SessionRunCoordinator`, `SessionStore`, `SessionProjector`).
- Consumer: `packages/aigcfroge/src/session/`.
- Full architecture (prompt lifecycle, EventV2 model, data tables): `docs/architecture/system-blueprint.md` §11.
- Terminology & invariants: `CONTEXT.md`.
- API design: `specs/v2/session.md`.
- Architectural constraints: `AGENTS.md` → V2 Session Core (8 invariants). Note symbol ownership: `SessionRunner` / `SessionRunCoordinator` / `SessionExecution` live in `core`, not `aigcfroge`.

### 4.2 System Context & Context Epoch

Typed context sources (file tree, git status, workspace info) refreshed independently and snapshotted per provider turn.

- Implementation: `packages/core/src/system-context/` (`index.ts`, `registry.ts`, `builtins.ts`).
- Epoch persistence: `packages/core/src/session/context-epoch.ts`.
- Terminology: `CONTEXT.md` → System Context, Context Epoch.
- The path is `packages/core/src/system-context`, **not** `src/system-context` under `aigcfroge`.

### 4.3 EventV2

Event source with PubSub + durable persistence, projected into Session views.

- Implementation: `packages/core/src/event.ts` + `packages/core/src/event/` (SQL, projector).
- Bridge into app: `packages/aigcfroge/src/event-v2-bridge.ts`.

### 4.4 Tool Registry

Single local-tool representation, registration, lookup, settlement. Location-scoped.

- Implementation: `packages/core/src/tool/` (see `packages/core/src/tool/AGENTS.md`).
- `ToolRegistry.Service` is Location-scoped; `ApplicationTools.Service` is process-scoped — never confuse them.
- Tool leaves express expected failures via `ToolFailure`; never `catchCause` (interruption / defects must survive).
- Permission source is constructed from the canonical invocation context.
- Design: `specs/v2/tools.md`.

### 4.5 Provider & Model Catalog

Provider/model catalog with selection policy.

- Implementation: `packages/core/src/{provider, model, catalog, model-request, models-dev}.ts`.
- Design: `specs/v2/provider-model.md`, `specs/v2/provider-policy.md`.

### 4.6 Permission & Policy

Location-scoped permission source, constructed from the canonical invocation context.

- Implementation: `packages/core/src/{permission, policy}.ts` + `packages/core/src/permission/`.
- Tool permission: `packages/core/src/tool/AGENTS.md`.

### 4.7 Plugin System

Plugin SDK with v1 (frozen) + v2 hybrid API. V1 is frozen; plugins may import both V1 and V2 types but they are not interchangeable.

- SDK: `packages/plugin/` (exports `./v2/effect`, `./v2/promise`, `./tool`, `./tui`).
- TUI plugins: `packages/aigcfroge/specs/tui-plugins.md`.

### 4.8 Database

Drizzle + Effect SQLite. Schema lives in `packages/core/src/session/sql.ts` and `packages/core/src/event/sql.ts`.

- Adapter: `packages/effect-drizzle-sqlite` — vendored, `/* oxlint-disable */`, exempt from the project's `as any` / lint gates.
- Driver: `packages/effect-sqlite-node`.
- Conventions: `.aigcfroge/skills/database/SKILL.md` (snake_case columns, migrations, custom column types).
- Runtime imports the generic `effect/unstable/sql/SqlClient`, never a concrete driver.

### 4.9 LLM Layer

Effect Schema-first provider abstraction. Default path is the AI SDK; native path is opt-in via `AIGCFROGE_EXPERIMENTAL_NATIVE_LLM=true` (or `AIGCFROGE_EXPERIMENTAL=true`). Both runtimes converge on the same `LLMEvent` stream.

- Implementation: `packages/llm/` (see `packages/llm/AGENTS.md` for Route four-axis — Protocol / Endpoint / Auth / Framing — provider facades, folder layout, recording tests).
- Adapter in aigcfroge: `packages/aigcfroge/src/session/llm/` (see its `AGENTS.md` for the strict cross-file import boundary; only `native-request.ts` may construct `LLM.request` / `Message.*`).
- Future proposal (not implemented): `packages/llm/DESIGN.md` — `@aigcfroge/ai` clean-break draft.

### 4.10 Product Mode

Product Mode (`chat | coding | work | assistant`) is a persisted App filtering context and a durable Session classification. It is separate from Agent execution mode (`primary | subagent | all`).

- Home cards and the global icon rail navigate to `/mode/:mode`; that module-entry navigation never creates/restores a Draft or Session, selects a Tab, reclassifies work, or changes the Agent.
- Session routes remain keyed only by server and Session identity.
- Draft routes remain keyed by draft identity; Product Mode comes from `DraftTab.mode`.
- `/mode/:mode` renders one shared `ModeRoute`/`ModeWorkspace` for all Product Modes; Mode-specific capability enters through typed slots/adapters instead of copied routes.
- Root Sessions inherit the Mode frozen on their Draft; child Sessions and forks inherit their parent/source Mode.
- Projects and Workspaces are shared across Modes; their Session descendants are filtered.
- Existing rows and historical events without Product Mode decode as Coding.
- Target implementation: `docs/plan/mode-module-switching-completion.md`.
- Decisions: `docs/architecture/adr/ADR-11-product-mode-session-classification.md`, `docs/architecture/adr/ADR-12-product-mode-entry-routing.md`, `docs/architecture/adr/ADR-13-chat-work-mode-boundary.md`, `docs/architecture/adr/ADR-14-persistence-and-scope-strategy.md`, `docs/architecture/adr/ADR-15-mode-workspace-main-area-slot.md` (Accepted; main-area typed slot, Chat asset-centric; ADR-13 Amendment-1 assigns workflow definition→Chat, execution→Work), `docs/architecture/adr/ADR-16-global-home-overview.md` (Accepted; `/` renders the global aggregate home page, titlebar left gains a global home entry).

### 4.11 External CLI Dispatch

Delegates `task` tool executions to external coding CLIs (claude-code, codex, gemini, opencode) over three transports sharing one adapter seam. The `task` built-in writes a child Session per delegation; the child's messages surface the CLI result.

- Single adapter store: module-level registry cell in `packages/core/src/tool/cli-adapter.ts` (`registerCliAdapter`/`getCliAdapter`/`listCliAdapters`). `packages/aigcfroge/src/agent/meta/adapters/registry.ts` is a thin Effect wrapper over the same cell (no second registry). Config-defined `cli_agents` (config > built-in) register via `registerConfigCliAdapters`; `transport: "sdk"|"acp"` for non-claude/codex names fails loudly.
- Transports: `jsonl` (spawn + parse, default), `sdk` (official `@anthropic-ai/claude-agent-sdk` / `@openai/codex-sdk`), `acp` (Agent Client Protocol via `@agentclientprotocol/sdk`). Built-in order per name: ACP (when bridge binary on PATH) > SDK > jsonl. Resume persists the external session id in `external_cli_session` keyed by parent session (`DelegationResult.sessionId ?? parseResumeHint`).
- SDK/ACP adapters are factory-injected (`makeClaudeCodeSdkAdapter(sdk)` / `makeAcpAdapter(factory)`), default instances cast the real SDK/process seam at module load; tests inject fakes. ACP client lifecycle lives in `packages/core/src/acp-client/` (`connection.ts` wraps `ClientSideConnection`, `update.ts` parses `session/update` tool-call progress + `_meta.parentToolUseId`, `process.ts` spawns the bridge).
- Permission bridge: the fill's `executeCLI` resolves `PermissionV2.Service` from the caller's (session-drain) context and builds a `canUseTool` handler — SDK `canUseTool` and ACP `session/request_permission` share this one bridge, asserted against the parent session. Absent PermissionV2 → auto-deny.
- Implementation: `packages/core/src/session/task-driver-fill.ts`, `packages/core/src/tool/{cli-adapter, cli-timeout, claude-code, codex, gemini, opencode, claude-code-sdk, codex-sdk, claude-code-acp, codex-acp, acp}.ts`. Plan: `docs/plan/external-cli-dispatch-implementation.md`.

## 5. src/ Directory Index

A directory-to-responsibility map for the two largest packages.

### `packages/aigcfroge/src/` — application / CLI / server layer

| Group | Directories |
|---|---|
| CLI & commands | `cli/`, `command/`, `index.ts`, `node.ts` |
| Server & API | `server/`, `control-plane/`, `share/`, `sync/` |
| Session runtime | `session/`, `event-v2-bridge.ts`, `background/`, `bus/` |
| Provider & LLM | `provider/`, `session/llm/` |
| Tools & MCP | `tool/`, `mcp/`, `lsp/`, `acp/` |
| Project & FS | `project/`, `patch/`, `worktree/`, `git/`, `ide/`, `image/` |
| Permission & auth | `permission/`, `auth/`, `account/` |
| Plugin & skill | `plugin/`, `skill/`, `agent/`, `question/` |
| Infra | `config/`, `env/`, `effect/`, `storage/`, `util/`, `format/`, `id/`, `snapshot/`, `installation/`, `temporary.ts` |

### `packages/core/src/` — domain layer

| Group | Files / directories |
|---|---|
| Session V2 | `session.ts`, `session/`, `system-context/` |
| Event | `event.ts`, `event/` |
| Tool | `tool/`, `tool-output-store.ts` |
| External CLI (ACP client) | `acp-client/` |
| Provider & model | `provider.ts`, `model.ts`, `catalog.ts`, `model-request.ts`, `models-dev.ts`, `aisdk.ts` |
| Permission & policy | `permission.ts`, `permission/`, `policy.ts` |
| Plugin | `plugin.ts`, `plugin/` |
| Domain primitives | `account.ts`, `agent.ts`, `command.ts`, `config.ts`, `credential.ts`, `project.ts`, `question.ts`, `skill.ts`, `snapshot.ts`, `workspace.ts` |
| Location & filesystem | `location.ts`, `location-layer.ts`, `location-mutation.ts`, `filesystem.ts`, `filesystem/`, `fs-util.ts`, `file-mutation.ts`, `patch.ts`, `ripgrep.ts`, `repository.ts`, `repository-cache.ts` |
| Process & shell | `process.ts`, `shell.ts`, `pty.ts`, `pty/`, `cross-spawn-spawner.ts` |
| Integration | `integration.ts`, `integration/`, `github-copilot/`, `npm.ts`, `npm-config.ts` |
| Infra | `cache/`, `config/`, `control-plane/`, `database/`, `effect/`, `flag/`, `id/`, `image/`, `installation/`, `meta-agent/`, `observability.ts`, `observability/`, `public/`, `reference.ts`, `reference/`, `state.ts`, `util/`, `v1/`, `v2-schema.ts`, `data-migration.sql.ts`, `instruction-context.ts`, `global.ts` |

## 6. Cross-Layer Effect Boundaries

- Effect Layers are provided once at the app/server boundary (`packages/aigcfroge/src/server/`, `packages/app/`); handlers consume services via `yield*` and never call `Effect.provide(SomeLayer)` inside a handler or raw callback.
- Request-derived context (`WorkspaceRouteContext`, `InstanceRef`, `WorkspaceRef`) is provided via `Effect.provideService(...)` middleware, not `HttpRouter.provideRequest(...)`.
- Endpoint styles: `HttpApiBuilder.group(...)` for normal endpoints (including SSE); `handleRaw(...)` for raw request/response (WebSocket upgrade); raw `HttpRouter.use(...)` only for catch-all outside the declared API. See `packages/aigcfroge/src/server/routes/instance/httpapi/AGENTS.md`.
- Process boundaries: Electron main (`packages/desktop/src/main/`) ↔ renderer via `window.api` (preload-exposed IPC, registered in `src/main/ipc.ts`); server is a Node process; `cli` reuses `aigcfroge`'s command tree.

## 7. Design State

| Status | Items |
|---|---|
| Implemented | Session V2, EventV2, Tool Registry, Provider/Model Catalog, System Context, Database layer, v2 UI design system, MetaAgent service, MetaHooks/ToolHooks SDK, MCP V2 (stdio+remote+OAuth), SessionShare V2 (internal), SessionRevert V2, SessionSummary V2, INTENT_TOOL_FILTERS, PreToolUse/PostToolUse hooks, Product Mode skeleton (mode classification + `/mode/:mode` entry routing), Prompt Asset M1 (prompt-asset schema/registry/transaction service + V1/V2 propose tool + chat-orchestrator + HTTP API + Chat surface) |
| Design in progress | Chat PRD v4.6（资产工作室，已批准 2026-07-18；M1-M7 全部完成 — 7 类资产新建/导入/创建/apply/delete 全闭环）与 Work PRD v4.1（非编程执行层，已批准 2026-07-31，实施计划见 [`docs/roadmap/work-mode-roadmap.md`](docs/roadmap/work-mode-roadmap.md) + [`docs/plan/work-mode-execution-layer-m1.md`](docs/plan/work-mode-execution-layer-m1.md)）；Assistant/My Agents v3 PRDs are drafts gated by accepted ADRs and owner contracts (`docs/prd/chat-mode-creation-layer.md`, `docs/prd/work-mode-execution-layer.md`, `docs/prd/assistant-mode-personal-agent.md`, `docs/prd/my-agents-launcher.md`) |
| In progress | V2 config (`specs/v2/config.md`), TUI package extraction (`specs/tui-package.md`), legacy storage removal (`specs/storage/remove-opencode-db.md`) |
| Phase 6 complete | Structured Handoffs (summary compression), Judge multi-model arbitration, external CLI session recovery, symlink-aware path containment, Fork CLI endpoint |
| Accepted decisions | `docs/architecture/adr/ADR-09-mode-route-decoupling.md`, `docs/architecture/adr/ADR-10-schema-versioning.md`, `docs/architecture/adr/ADR-11-product-mode-session-classification.md`, `docs/architecture/adr/ADR-12-product-mode-entry-routing.md`, `docs/architecture/adr/ADR-13-chat-work-mode-boundary.md`, `docs/architecture/adr/ADR-13-amendment-1-workflow-asset.md`（工作流定义→Chat，执行→Work）, `docs/architecture/adr/ADR-13-amendment-2-meta-agent-dispatch.md`（元智能体统一调度与 Chat 权限信封收敛）, `docs/architecture/adr/ADR-14-persistence-and-scope-strategy.md`, `docs/architecture/adr/ADR-15-mode-workspace-main-area-slot.md` |
| Proposed decisions | （无；ADR-15 已于 2026-07-19 接受，见 Accepted 行） |

V2 migration status is tracked in `specs/v2/todo.md` and `packages/aigcfroge/specs/effect/todo.md`. The schema changelog lives in `specs/v2/schema-changelog.md`.
