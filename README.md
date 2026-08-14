<p align="center">
  <a href="https://github.com/keerzzz/AigcForge">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Aigcfroge logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center">
  <a href="https://github.com/keerzzz/AigcForge/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/keerzzz/AigcForge/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a>
</p>

[![Aigcfroge Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://github.com/keerzzz/AigcForge)

---

## What is AigcForge?

AigcForge is an open-source AI agent that goes beyond a single coding terminal. It is a **unified agentic workspace**: four product modes for different kinds of work, an asset studio for building reusable building blocks through conversation, a native task system, and an event-sourced session runtime that stays durable and resumable across every surface.

## Key features

### Four product modes

Switch between modes without losing your project — sessions stay in sync, and each mode gets the right tools (and only the right tools):

| Mode | Purpose |
|---|---|
| **Coding** (default) | Full development workspace: edit code, run the terminal, work with git worktrees, run tests. |
| **Chat** | Build reusable assets through conversation. Read-only for your code — it *proposes* assets that you apply with one click. |
| **Work** | Non-programming output. Pick a preset, answer a few clarifying questions, preview the result, and save a Markdown document to your project. |
| **Assistant** (planned) | Personal, proactive agents that act on your behalf. |

### Asset studio

Seven kinds of reusable assets — **prompts, skills, MCP servers, commands, agents, workflows, and plugins** — each with create, import, propose, apply, insert, and delete. Build something once in Chat mode, then reuse it across every project and mode.

### Native task system

A first-class task/todo model with dependencies, priorities, scheduling, and resume-from-breakpoint. Delegate work to subagents — or to external CLIs like Claude Code, Codex, Gemini, and opencode — and watch progress update live.

### Agent system

- **meta** — the default orchestration entry: intent classification, routing, and delegation.
- **build** — the default executor with full tool access.
- **plan** — read-only; ideal for analysis and exploration.
- **@general / @explore** — subagents for research and fast codebase exploration.
- Per-mode orchestrators (`chat-orchestrator`, `work-orchestrator`) enforce exactly what each mode is allowed to do.

### Event-sourced sessions

The Session V2 runtime records every event durably, so work survives restarts and stays consistent across CLI, TUI, and desktop. Built-in **revert/unrevert**, **share**, and **summary**.

### MCP & plugin SDK

Connect any MCP server — stdio, remote, or OAuth — and extend AigcForge with the plugin SDK: v1 for stability, v2 for the modern Effect-based API.

### Security-first

Permission prompts (ask / allow / deny / unattended auto-deny), project sandboxes, untrusted-import guards, and mode-based restrictions on shell and commands.

### One runtime, many surfaces

CLI, terminal TUI, and an Electron desktop app — plus deploy units for the web, Slack, and a sync server.

## Installation

```bash
# Package managers
npm i -g aigcfroge@latest        # or bun/pnpm/yarn
scoop install aigcfroge             # Windows
choco install aigcfroge             # Windows
brew install anomalyco/tap/aigcfroge # macOS and Linux (recommended, always up to date)
brew install aigcfroge              # macOS and Linux (official brew formula, updated less)
sudo pacman -S aigcfroge            # Arch Linux (Stable)
paru -S aigcfroge-bin               # Arch Linux (Latest from AUR)
mise use -g aigcfroge               # Any OS
nix run nixpkgs#aigcfroge           # or github:keerzzz/AigcForge for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

## Desktop App (BETA)

Aigcfroge is also available as a desktop application. Download directly from the [releases page](https://github.com/keerzzz/AigcForge/releases).

| Platform              | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `aigcfroge-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `aigcfroge-desktop-mac-x64.dmg`     |
| Windows               | `aigcfroge-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask aigcfroge-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/aigcfroge-desktop
```

#### Installation directory

The install script respects the following priority order for the installation path:

1. `$AIGCFROGE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.aigcfroge/bin` - Default fallback

## Getting started

Point AigcForge at the model provider of your choice, then configure models, permissions, and MCP servers from the config file or the UI. Switch between the **meta**, **build**, and **plan** agents as needed, and invoke the **@general** / **@explore** subagents inline for research and codebase exploration.

## Architecture

AigcForge is a 17-package monorepo built on [Effect](https://effect.website) with a Schema-first domain model and Drizzle + SQLite persistence:

- **Entry** — `desktop` (Electron shell), `aigcfroge` (sidecar server + orchestration), `tui` (terminal UI)
- **Application** — `app` (SolidJS frontend), `server` (HTTP API), `script`
- **Domain** — `core` (session/event/tool/permission/plugin), `llm` (provider abstraction), `schema` (contracts), `sdk/js`
- **UI** — `ui` (design system), `session-ui` (session rendering), `storybook`
- **Extension** — `plugin` (plugin SDK)
- **Infrastructure** — `effect-drizzle-sqlite`, `effect-sqlite-node`, `http-recorder`

## Contributing

If you're interested in contributing to AigcForge, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on opencode

If you are working on a project that's related to opencode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the AigcForge team and is not affiliated with us in any way.

## License

AigcForge is a fork of [opencode](https://github.com/anomalyco/opencode) and is distributed under the [MIT License](./LICENSE).
