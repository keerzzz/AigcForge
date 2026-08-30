<p align="center">
  <a href="https://github.com/keerzzz/AigcForge">
    <h1 align="center">AigcForge</h1>
  </a>
</p>

<p align="center">
  <strong>The Unified Open-Source Agentic Workspace for Next-Gen Software Engineering & Knowledge Creation</strong>
</p>

<p align="center">
  <a href="https://github.com/keerzzz/AigcForge/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" /></a>
  <a href="https://effect.website"><img alt="Effect-TS" src="https://img.shields.io/badge/Powered%20by-Effect--TS-orange.svg?style=flat-square" /></a>
  <a href="https://github.com/keerzzz/AigcForge/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/keerzzz/AigcForge/publish.yml?style=flat-square&branch=main" /></a>
  <a href="https://github.com/keerzzz/AigcForge/releases"><img alt="Release" src="https://img.shields.io/github/v/release/keerzzz/AigcForge?style=flat-square" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/keerzzz/AigcForge">
    <img src="screenshot-uk.png" alt="AigcForge Terminal UI & Workspace" width="800" />
  </a>
</p>

---

## Table of Contents

- [1. What is AigcForge?](#1-what-is-aigcforge)
- [2. Five Product Modes Matrix](#2-five-product-modes-matrix)
  - [Coding Mode (Full-featured AI Development)](#coding-mode-full-featured-ai-development)
  - [Chat Mode (Asset Studio: Conversation Value to Assets)](#chat-mode-asset-studio-conversation-value-to-assets)
  - [Work Mode (Non-programming Structured Delivery)](#work-mode-non-programming-structured-delivery)
  - [Assistant Mode (Proactive Personal Agent)](#assistant-mode-proactive-personal-agent)
  - [Custom Mode (Asset Composition & Execution Platform - In Review)](#custom-mode-asset-composition--execution-platform---in-review)
- [3. Key Architectural Innovations & Subsystems](#3-key-architectural-innovations--subsystems)
  - [Session V2 & EventV2 Event-Sourced Engine](#session-v2--eventv2-event-sourced-engine)
  - [Meta-Agent Unified Orchestrator](#meta-agent-unified-orchestrator)
  - [External CLI Dispatch System (ACP / SDK)](#external-cli-dispatch-system-acp--sdk)
  - [Harness 7-Layer Hardening & Anti-Hallucination Loop](#harness-7-layer-hardening--anti-hallucination-loop)
  - [Security Tiers & Path Containment](#security-tiers--path-containment)
- [4. Monorepo 18-Package Topology Matrix](#4-monorepo-18-package-topology-matrix)
- [5. Installation & Multi-Surface Support](#5-installation--multi-surface-support)
- [6. Core Workflow Paradigms](#6-core-workflow-paradigms)
- [7. Product Roadmap & Status](#7-product-roadmap--status)
- [8. Contributing & Code Standards](#8-contributing--code-standards)
- [9. License](#9-license)

---

## 1. What is AigcForge?

**AigcForge** is far more than a single coding terminal; it is a **Unified Agentic Workspace**.

Traditional AI coding tools are often confined to single terminal interfaces, lack verification loops, lose conversation lessons after sessions end, and exclude non-coding stakeholders. AigcForge solves this through **asset-first human-agent collaboration** and **reliable engineering delivery**:

- **4+1 Product Modes**: Tailored workspaces for engineering, asset creation, structured business delivery, and personal task management.
- **Asset Studio**: 3 acquisition channels (Guided Creation, Session Capture, External Import) to capture valuable conversation experience into 7 classes of managed, reproducible project assets.
- **External CLI Dispatch**: Seamlessly orchestrate built-in agents alongside top-tier external CLIs like Claude Code, Codex, Gemini, and opencode.
- **Industrial-Grade Effect-TS Runtime**: Schema-First domain contracts, Session V2 event sourcing, SQLite transaction durability, and Harness 7-layer mechanized anti-hallucination verification.

---

## 2. Five Product Modes Matrix

AigcForge enforces durable `Product Mode` classification. Switching modes preserves project context, syncs sessions automatically, and strictly exposes only the necessary capabilities per mode.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        AigcForge Product Workspace                     │
├───────────────────┬───────────────────┬──────────────────┬─────────────┤
│   Coding Mode     │     Chat Mode     │    Work Mode     │  Assistant  │
│ (Full-power Dev)  │   (Asset Studio)  │ (Structured Work)│ (Proactive) │
├───────────────────┴───────────────────┴──────────────────┴─────────────┤
│                 Custom Mode (Composition & Run Platform)               │
├────────────────────────────────────────────────────────────────────────┤
│                 Meta-Agent Unified Orchestration Hub                   │
├────────────────────────────────────────────────────────────────────────┤
│         Session V2 (Event Sourcing / Verification / Permissions)       │
└────────────────────────────────────────────────────────────────────────┘
```

### Coding Mode (Full-featured AI Development)

- **Primary Focus**: Full development workspace for professional software engineers.
- **Key Capabilities**:
  - Read, search, patch code (AST-level precision diffing), and run isolated Git worktrees.
  - Full terminal execution and process supervision for tests, builds, and automated debugging.
  - Inline subagents (`@general` for research, `@explore` for fast codebase sweeps) via `@mention`.
  - **Verification Gate**: Mechanized `typecheck` / test suite triggers post-edit to catch defects immediately.

### Chat Mode (Asset Studio: Conversation Value to Assets)

- **Primary Focus**: Transform implicit conversational insights into explicit, reusable project building blocks.
- **Key Capabilities**:
  - **7 Standard Managed Asset Kinds**: `prompt`, `skill`, `mcp`, `command`, `agent`, `workflow` (definition), and `plugin`.
  - **Three Supply Paths**:
    1. _Guided Creation_: Interactive questionnaires infer asset kinds, properties, and produce validated drafts.
    2. _Session Capture_: One-click "Save as Asset" from message cards in any session.
    3. _External Import_: Paste external AI chat threads or import files; automatically strips thinking tags and noise.
  - **Fail-Closed Safety Envelope**: Creation agent is read-only + `propose_*_asset` only (no Shell or direct Write). Assets are written atomically to `<project>/.aigcfroge/` via typed server transactions after user review.

### Work Mode (Non-programming Structured Delivery)

- **Primary Focus**: High-confidence structured delivery for non-coding roles (Preset Tasks → Live Ledger → Safe Artifact Delivery).
- **Target Roles (12 IT Roles + 5 Creative/Academic Groups)**:
  - _Engineering & Tech_: PO (PRD / WSJF ROI scoring), BA (Gherkin BDD specs), UI/UX (Design Tokens), Architect (ADR candidate generation), FE/BE (API & SQL audits), QA (BDD test plans), SRE (Incident postmortems), Data Analysts (SQL verification).
  - _Creators & Academics_: Video storyboard scripts, Game GDDs, Academic literature matrix comparison, Student thesis structuring, Zero-code wizard writing.
- **Key Capabilities**:
  - **Presets Catalog**: Hardcoded domain presets with interactive clarification wizards.
  - **Progress Ledger**: Visual stage tracking with incremental **Resume from Breakpoint**.
  - **Safe Conflict Detection**: Detects file collisions and prompts with interactive diff confirmation.
  - **Reverse Asset Loop**: One-click "Save as Asset" routes successful outputs back to Chat Studio.

### Assistant Mode (Proactive Personal Agent)

- **Primary Focus**: Long-term personal context and proactive local task management.
- **Key Capabilities**:
  - **Persistent Scheduler**: Natural language timer/cron scheduling. Uses lease-based claims and idempotent delivery; **catches up on missed tasks after system reboot** without wasteful background polling.
  - **Personal Knowledge Base & Memory (`kb_note`)**: Dual `[[wikilink]]` support with authentic source-citation footnotes.
  - **Web Research**: Integrated `websearch` and `webfetch` for synthesizing live web intelligence into personal notes.

### Custom Mode (Asset Composition & Execution Platform - In Review)

- **Primary Focus**: Multi-asset composition, preview, and reproducible multi-agent runtime (ADR-17).
- **Key Capabilities**:
  - Bind custom user agents, prompts, skills, and MCP tools under root orchestrator `meta`.
  - Compile an explainable `CompositionPlan` (preview capabilities, instructions, and permissions before execution).
  - Freeze an immutable `CompositionSnapshot` on session launch, guaranteeing deterministic replay regardless of asset mutations.

---

## 3. Key Architectural Innovations & Subsystems

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        AigcForge Core Subsystems                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [ Users & Surfaces ] ──► [ Meta-Agent Orchestrator ] ──► [ Intent Router]│
│                                │                                        │
│          ┌─────────────────────┼─────────────────────┐                  │
│          ▼                     ▼                     ▼                  │
│    [ Built-in Agents ]    [ Mode Orchestrators ]   [ External CLI SDKs ]│
│   (build/plan/explore)   (chat/work-orchestrator) (Claude/Codex/Gemini) │
│          │                     │                     │                  │
│          └─────────────────────┬─────────────────────┘                  │
│                                ▼                                        │
│  [ Session V2 Runtime ] ◄──► [ Harness 7-Layer Verification ] ◄──► [ ACL ]│
│         │                      (DoomLoop/Typecheck/Store) (Propose/Full)│
│         ▼                                                               │
│  [ EventV2 Event Source & SQLite Persistence (Effect + Drizzle) ]       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Session V2 & EventV2 Event-Sourced Engine

- **Durable Admission Decoupling**: User inputs persist into `session_input` before serialized runner drains execute, guaranteeing zero message loss across reboots.
- **EventV2 Stream**: Every lifecycle mutation (message chunks, tool executions, permissions, checkpoints) streams through a typed PubSub bus and persists durably.
- **Deterministic Replay & Time Travel**:
  - **Revert / Unrevert**: Rollback to any past turn and fork execution.
  - **Session Share**: Export and share reproducible session state.
  - **Compaction**: Token-efficient transcript summarization without breaking prefix caching.

### Meta-Agent Unified Orchestrator

- **Single Point of Interaction**: The default orchestrator `meta` routes intents without requiring manual agent juggling.
- **Three-Tier System Prompt Architecture**:
  - **L1 Constant**: Byte-locked role definitions & routing rules (maximizing LLM prompt prefix cache).
  - **L2 Session**: Fixed workspace tools, subagents, and available external CLIs.
  - **L3 Dynamic**: Dynamic session context and delegation history.
- **Flexible Execution Modes**: Single-intent routing, serial pipelines (Plan → Build → Review), and `@mention` parallel fan-out.

### External CLI Dispatch System (ACP / SDK)

Directly dispatch subtasks to third-party coding CLI agents:

- **Supported CLIs**: `claude-code`, `codex`, `gemini`, `opencode`.
- **Three Transport Tiers**:
  1. **ACP (Agent Client Protocol)**: Modern bidirectional client protocol via `@agentclientprotocol/sdk`.
  2. **Official SDKs**: Native `@anthropic-ai/claude-agent-sdk` and `@openai/codex-sdk`.
  3. **JSONL Subprocess**: Robust fallback process spawning.
- **Unified Permission Bridge**: All external tool executions intercept back into AigcForge's `PermissionV2` authority.

### Harness 7-Layer Hardening & Anti-Hallucination Loop

1. **Doom Loop Detection**: Blocks repeated identical tool failures.
2. **Reference Integrity Checker**: Mechanically verifies Markdown links and `import` paths after edits.
3. **Verifier Gate**: Triggers automated `typecheck` / tests post-edit with prose error mapping.
4. **CorrectionStore**: Persists verified corrections as "Verified facts" injected into System Context (never pollutes history; survives compaction).
5. **Multi-Model Judge Arbitration**: Escalates ambiguous outputs to multi-model consensus (Judge / PGE routing).

### Security Tiers & Path Containment

- **Dual Permission Envelopes**:
  - `propose` tier (Chat mode default): Read-only + structured draft proposals.
  - `full` tier (Coding mode): Supervised execution with `ask`, `allow`, `deny`, and unattended auto-deny.
- **Path Containment**: Symlink-aware validation prevents workspace directory traversal.

---

## 4. Monorepo 18-Package Topology Matrix

AigcForge is built on Bun + Turbo, adhering strictly to downward-layer dependency flows:

| Layer              | Package Directory                | Package Name (`package.json`)      | Primary Role & Responsibility                                                                                            |
| ------------------ | -------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Entry**          | `packages/desktop`               | `@aigcfroge/desktop`               | **Electron Desktop Shell**: Window lifecycle, IPC bridges, embedded sidecar management, native OS notifications.         |
|                    | `packages/aigcfroge`             | `aigcfroge`                        | **Core Runtime & CLI Engine**: Command tree, Sidecar daemon, Meta-Agent dispatch, tool/MCP implementations.              |
|                    | `packages/tui`                   | `@aigcfroge/tui`                   | **Terminal User Interface**: High-density, keyboard-driven terminal UI powered by OpenTUI + Solid.                       |
| **Application**    | `packages/app`                   | `@aigcfroge/app`                   | **SolidJS Frontend App**: Mode routes (`/mode/:mode`), ModeWorkspace slots, reactive stores, right-panel tab/diff views. |
|                    | `packages/server`                | `@aigcfroge/server`                | **Unified HTTP/SSE API Server**: Effect `HttpApiBuilder` router with automatic OpenAPI 3.0 specs.                        |
|                    | `packages/script`                | `@aigcfroge/script`                | **Build & Release Scripts**: Automated version computation and workspace publishing tools.                               |
| **Domain**         | `packages/core`                  | `@aigcfroge/core`                  | **Domain Core**: Session V2, EventV2, ToolRegistry, PermissionV2, SystemContext, ACP Client, SQLite schema & migrations. |
|                    | `packages/llm`                   | `@aigcfroge/llm`                   | **LLM Abstraction Layer**: Effect-Schema multi-provider routing (OpenAI, Claude, Gemini, DeepSeek, Ollama, etc.).        |
|                    | `packages/schema`                | `@aigcfroge/schema`                | **Pure Contract Schema**: Shared Effect-Schema contracts across domain and application layers.                           |
|                    | `packages/sdk/js`                | `@aigcfroge/sdk`                   | **TypeScript/JavaScript SDK**: OpenAPI-generated client SDK for programmatic integrations.                               |
| **UI**             | `packages/ui`                    | `@aigcfroge/ui`                    | **Design System V2**: Token V2 styling, 37 built-in themes, accessible primitive controls, and i18n foundation.          |
|                    | `packages/session-ui`            | `@aigcfroge/session-ui`            | **Session Rendering Components**: Markdown streaming, interactive diff viewer, tool cards.                               |
|                    | `packages/storybook`             | `@aigcfroge/storybook`             | **Component Storybook**: Isolated component development and visual regression workspace.                                 |
| **Extension**      | `packages/plugin`                | `@aigcfroge/plugin`                | **Plugin SDK**: Extensibility framework supporting V1 API and modern V2 Effect-based hooks.                              |
|                    | `packages/enterprise`            | `@aigcfroge/enterprise`            | **Enterprise Extensions**: Remote Session Sharing, multi-tenant boundaries, and compliance audit adapters.               |
| **Infrastructure** | `packages/effect-drizzle-sqlite` | `@aigcfroge/effect-drizzle-sqlite` | **Drizzle + Effect SQLite Adapter**: Bridges Drizzle ORM into Effect transactions and services.                          |
|                    | `packages/effect-sqlite-node`    | `@aigcfroge/effect-sqlite-node`    | **Native SQLite Driver Binding**: High-performance Node SQLite driver wrapped in Effect.                                 |
|                    | `packages/http-recorder`         | `@aigcfroge/http-recorder`         | **HTTP Cassette Recorder**: Deterministic HTTP record/replay testing infrastructure for offline suites.                  |

---

## 5. Installation & Multi-Surface Support

### CLI & TUI Installation

Install globally using your favorite package manager:

```bash
# Node.js / Bun / pnpm
npm install -g aigcfroge@latest
# or: bun add -g aigcfroge

# macOS & Linux (Homebrew)
brew install anomalyco/tap/aigcfroge

# Windows (Scoop / Chocolatey)
scoop install aigcfroge
# or: choco install aigcfroge

# Arch Linux (AUR)
paru -S aigcfroge-bin

# Environment Managers (mise / nix)
mise use -g aigcfroge
nix run nixpkgs#aigcfroge
```

### Desktop Application Download

Pre-built desktop binaries are available on [GitHub Releases](https://github.com/keerzzz/AigcForge/releases):

| Platform                  | Package Format                | Direct Command (Optional)                |
| ------------------------- | ----------------------------- | ---------------------------------------- |
| **macOS (Apple Silicon)** | `.dmg` (arm64)                | `brew install --cask aigcfroge-desktop`  |
| **macOS (Intel)**         | `.dmg` (x64)                  | `brew install --cask aigcfroge-desktop`  |
| **Windows**               | `.exe` / `.msi` (x64)         | `scoop install extras/aigcfroge-desktop` |
| **Linux**                 | `.AppImage` / `.deb` / `.rpm` | Executable directly                      |

---

## 6. Core Workflow Paradigms

### Scenario 1: Full-Stack Engineering (Coding Mode)

1. Start in your repo: `aigcfroge` (or launch the Desktop App).
2. In **Coding Mode**, type:
   > _"Refactor the session cache in packages/core and use @explore to verify all consumer call sites."_
3. Meta-Agent routes `@explore` to discover callers, applies atomic code patches, and runs automated `typecheck` verification.

### Scenario 2: Capturing Best Practices into Assets (Chat Mode)

1. Navigate to **Chat Mode** (`/mode/chat`).
2. Request an asset:
   > _"Create a Frontend Code Review skill that enforces Effect error handling and Tailwind Token V2 conventions."_
3. The creation agent interacts to clarify parameters and generates a `propose_skill_asset` preview.
4. Review the diff in the right panel and click **Apply** to save atomically into `.aigcfroge/skills/`.

### Scenario 3: Non-Programming Structured Delivery (Work Mode)

1. Navigate to **Work Mode** and select a preset like `BDD Gherkin Specifications` or `Video Storyboard Planning`.
2. Complete the interactive questions; monitor execution live via the **Progress Ledger**.
3. Inspect the read-only generated artifact, click "Save to Project", or click **"Save as Asset"** to convert the recipe into a reusable workflow.

### Scenario 4: External CLI Orchestration

Delegate complex refactoring tasks inline:

> _"@claude-code Please trace why node-pty child processes hang under Windows and implement the fix."_
> The task delegates over ACP / SDK and streams back results under unified session tracking.

---

## 7. Product Roadmap & Status

```
Milestones                Status & Scope
─────────────────────────────────────────────────────────────────────────────
[Completed]  Phase 1-6 Core Foundations
             ├── Session V2 / EventV2 runtime & SQLite persistence
             ├── Meta-Agent router & 3-tier prefix-cached prompts
             ├── External CLI Dispatch (ACP / SDK / JSONL transports)
             ├── Harness 7-layer verification (Doom loop, typecheck gate, Verified facts)
             └── Mode-scoped permission tiers (propose vs full) & containment

[Completed]  Chat Mode M1-M7 Asset Studio
             └── 7 asset kinds (Prompt/Skill/MCP/Command/Agent/Workflow/Plugin)
                 Guided creation, session capture, import, atomic CAS transactions

[In Progress] Work Mode M1-M3.5 Non-Programming Execution Layer
             ├── Presets Catalog & interactive questionnaire wizard
             ├── Progress Ledger with incremental breakpoint resume
             └── Same-name conflict diffing & Context Inspector parity

[In Review]  Assistant Mode & Custom Mode
             ├── Assistant M0-M1: Persistent scheduler, offline catchup, kb_note
             └── Custom Mode (ADR-17): Multi-asset composition profile & snapshots
```

---

## 8. Contributing & Code Standards

We welcome contributions from the community!

- **Code Style & Protocols**: Read [AGENTS.md](./AGENTS.md) and [ARCHITECTURE.md](./ARCHITECTURE.md). Domain code is written in **Effect-TS** with strict type safety.
- **Local Verification**:

  ```bash
  # Install dependencies
  bun install

  # Run full-repo typecheck
  bun typecheck

  # Run package unit tests
  bun --cwd packages/core test
  ```

---

## 9. License

AigcForge is a fork of [opencode](https://github.com/anomalyco/opencode) and is distributed under the [MIT License](./LICENSE).
