# Differential Review Report

## Executive Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 4 |
| LOW | 3 |

**Overall Risk:** MEDIUM  
**Recommendation:** CONDITIONAL / DO NOT APPROVE UNTIL MEDIUM FINDINGS ARE FIXED

**Key Metrics:**
- Files analyzed: 20 changed or untracked files
- Production code files: 13
- Security regressions detected: 0
- Test coverage gaps: no dedicated tests for mode/session ownership or secondary sidebar behavior
- Verification: app/ui typecheck and tests pass; repo lint fails on existing debt

## What Changed

**Range:** working tree against `HEAD` on branch `brand-migration-v001`

| Area | Files | Risk |
|------|-------|------|
| Mode state and switching | `context/mode.tsx`, `mode-switcher.tsx`, `home.tsx`, `app.tsx`, `submit.ts` | MEDIUM |
| Secondary sidebar | `secondary-sidebar.tsx`, `layout.tsx`, `sidebar-items.tsx`, `sidebar-workspace.tsx`, `titlebar.tsx` | MEDIUM |
| Shared UI/i18n | `icon.tsx`, `en.ts`, `zh.ts` | LOW |
| Docs/plans | `docs/architecture/*`, `docs/plan/*` | LOW |
| Local generated state | `.codegraph/*` | LOW |

Total tracked diff: +431 / -143 lines across 12 tracked files.  
Untracked implementation/docs/local files: 8 files.

## Findings

### MEDIUM: ModeSwitcher navigates and creates drafts despite documented "state-only" contract

**Files:** `packages/app/src/components/mode-switcher.tsx:28`, `docs/architecture/pages/mode-switcher.md:43`

The architecture doc says clicking a ModeSwitcher icon should only call `mode.setCurrentMode(m)` and leave the current session/page untouched. The implementation calls `navigate(sessionHref(...))` when a placement exists and `tabs.newDraft(...)` otherwise.

This makes the always-visible rail a destructive navigation control: a user can lose the current view merely by changing mode. It also duplicates the Home mode-card behavior, even though the docs distinguish the two entry points.

**Required action:** Make `ModeSwitcher` only set `currentMode`, or update the architecture/product contract and tests if navigation is intended.

### MEDIUM: SecondarySidebar cannot identify the active project/workspace on canonical session routes

**Files:** `packages/app/src/components/secondary-sidebar.tsx:71`, `packages/app/src/components/secondary-sidebar.tsx:630`, `packages/app/src/pages/layout/sidebar-workspace.tsx:347`

The new canonical route is `/server/:serverKey/session/:id`; it has no `params.dir`. `SecondarySidebar` still derives `currentDir` and active project state from `params.dir`, so active project/workspace detection is false for normal session routes.

Impact:
- current project highlight does not work
- sandbox workspace active state does not open/bootstrap from the current route
- `SortableWorkspace` behavior depending on `active()` cannot fire

**Required action:** Resolve the directory from `global.sessionPlacement` or route-scoped session placement instead of `params.dir`.

### MEDIUM: New-session wrapper nests a button role around an anchor

**File:** `packages/app/src/pages/layout/sidebar-workspace.tsx:252`

When `onNewSession` is provided, `WorkspaceSessionList` wraps `NewSessionItem` in `<div role="button" tabindex={0}>`, but `NewSessionItem` renders an `<A>` internally. This creates nested interactive controls with conflicting keyboard/default navigation semantics.

Impact:
- invalid accessible structure
- duplicate focus targets
- Enter/Space behavior can diverge between the wrapper and inner link

**Required action:** Add explicit `onClick`/`href` override support to `NewSessionItem`, or render a real button for this mode instead of wrapping the link.

### MEDIUM: Project collapse rows are mouse-only

**File:** `packages/app/src/components/secondary-sidebar.tsx:691`

`SecondaryProjectRow` uses a clickable `<div>` to expand/collapse projects, with no `role`, `tabindex`, `aria-expanded`, or keyboard handler. This violates the design protocol requirement that interactive controls be keyboard reachable and operable.

**Required action:** Use a `<button type="button">` or add the full keyboard/ARIA contract.

### LOW: No focused tests cover mode/session placement behavior

**Files:** `packages/app/src/context/mode.tsx`, `packages/app/src/app.tsx`, `packages/app/src/components/prompt-input/submit.ts`, `packages/app/src/pages/home.tsx`

The change introduces persistent mode state and two session ownership write paths, but no tests verify:
- draft submit records active mode session
- opening an existing session records the current mode
- Home mode card restores the last placement
- ModeSwitcher follows the intended state-only contract

**Required action:** Add focused tests around the new state flow or document why UI-only manual verification is sufficient.

### LOW: New code uses provider-absence `try/catch` in prompt submit path

**File:** `packages/app/src/components/prompt-input/submit.ts:224`

`useGlobal()` is wrapped in `try/catch` and silently ignored to support tests. This weakens provider-boundary assumptions and conflicts with the local execution prompt's "No try/catch in UI code" rule.

**Required action:** Prefer an explicit optional context helper, test provider setup, or a narrow documented utility instead of swallowing context errors in production code.

### LOW: Local CodeGraph state is present in the working tree

**Files:** `.codegraph/.gitignore`, `.codegraph/daemon.pid`

`.codegraph/.gitignore` and `.codegraph/daemon.pid` are untracked. The PID file is local machine state and should not be part of the review or commit.

**Required action:** Remove local runtime files from the commit surface, or ignore `.codegraph/` at the repo level if CodeGraph is expected locally.

## Test Coverage Analysis

Commands run:

| Command | Result |
|---------|--------|
| `bun --cwd packages/app typecheck` | PASS |
| `bun --cwd packages/ui typecheck` | PASS |
| `bun --cwd packages/app test --timeout 30000` | PASS |
| `bun --cwd packages/ui test --timeout 30000` | PASS |
| `git diff --check` | PASS |
| `bun run lint` | FAIL, repo-wide existing lint debt: 3693 warnings and 1 error |
| targeted `bunx oxlint` on new mode/sidebar files with `--deny-warnings` | PASS |

No browser/manual UI verification was run. Package guidance says not to restart app/server processes; the review stayed at static and package command verification.

## Blast Radius

| Function/component | Callers/entrypoints | Risk |
|--------------------|---------------------|------|
| `ModeProvider` | entire app shell via `Layout` | MEDIUM |
| `ModeSwitcher.enterMode` | always-visible rail buttons | MEDIUM |
| `Home.enterMode` | Home mode cards | MEDIUM |
| `ResolvedTargetSessionRoute` placement write | every canonical session route | MEDIUM |
| `WorkspaceSessionList` | V1 workspace list plus secondary sidebar path | MEDIUM |
| `SessionItem.serverKey` | V1-compatible session navigation | LOW |

## Historical Context

Recent relevant history is shallow:
- `7a4a989 fix: remove V1 legacy layout, consolidate to single layout, fix regressions`
- `83e3651 chore: migrate brand to aigcfroge and update version to 0.0.1`
- `c51269f chore: initial commit (slimmed version)`

No removed security checks, auth logic, crypto, command execution, or sensitive logging were found in this diff.

## Methodology

Skills/protocols used:
- `differential-review`
- `audit-context-building` for context-building discipline
- `CLAUDE.md`
- `AGENTS.md`
- `DESIGN.md`
- `packages/app/AGENTS.md`

Analysis scope:
- Read all new implementation files.
- Reviewed tracked diffs and untracked files.
- Traced mode state, session placement, route, tab, sidebar, and workspace call paths.
- Ran package typechecks/tests and lint diagnostics.

Limitations:
- No Playwright/browser inspection.
- Did not inspect every locale beyond fallback behavior.
- Did not fix findings; this report is review-only.
