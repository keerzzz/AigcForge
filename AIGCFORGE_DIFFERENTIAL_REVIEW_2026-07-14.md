# AigcForge Differential Review — 2026-07-14

## Decision

**APPROVE** — all previously blocking findings are resolved. No security regression, type error, test failure, lint error, build failure, broken relative documentation link in the reviewed scope, or whitespace error remains in the reviewed working tree.

| Severity | Open findings |
|---|---:|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

## Scope

- Product Mode navigation and workspace presentation in `packages/app`
- Mode, Session, Home, sidebar, and titlebar documentation
- ADR-13/ADR-14 and the four v3 product PRDs
- Root lint boundary for independent Console and Stats projects
- Supporting route and mode-registry tests

## Resolved Findings

### 1. One Product Mode registry

`packages/app/src/context/mode.tsx` now owns `MODE_DEFINITIONS`. Every built-in mode defines its id, canonical href, icon, label key, description key, and surface slot in one typed contract.

- `ModeSwitcher` and Home cards iterate that registry directly.
- `ModeRoute` continues to validate against registry-derived `isMode`.
- `modeSurface()` resolves the workspace surface through the definition's surface slot, so sidebar and right-panel selection cannot drift from the navigation mode.
- `mode.test.ts` verifies registry order, uniqueness, routes, icons, i18n keys, and surface-slot parity.

### 2. Work / workflow boundary corrected

The Mode Switcher architecture page now classifies **Work** as a non-programming-output Session category. It no longer assigns workflow ownership to Work, matching ADR-13 and the Work PRD.

### 3. My Agents naming corrected

The PRD is now `docs/prd/my-agents-launcher.md`. Its references in `ARCHITECTURE.md` and ADR-13 use the launcher-oriented name, consistent with the explicit rule that My Agents is not a fifth Product Mode or a Session workspace.

### 4. Root lint boundary repaired

`.oxlintrc.json` excludes `packages/console/**` and `packages/stats/**` from the root lint run. Both are independent projects outside the root workspace dependency graph; this prevents root Oxlint from loading Console's uninstalled `@webgpu/types` dependency while keeping workspace packages covered.

## Verification

| Command | Result |
|---|---|
| `git diff --check` | Pass |
| `bun --cwd packages/app typecheck` | Pass |
| `bun test --timeout 30000 src/context/mode.test.ts src/utils/secondary-sidebar-route.test.ts` | 4 passed |
| `bun --cwd packages/app test --timeout 30000` | 434 passed |
| `bun run lint` | Pass: 0 errors, 2,817 existing warnings |
| `bun --cwd packages/app build` | Pass after removing ignored `packages/app/dist` left by Vite's non-ASCII-path cleanup failure |
| Review-scope Markdown relative-link validation | Pass |

## Residual Risk

- The production build retains existing dynamic-import and large-chunk warnings.
- Browser interaction was not manually exercised; the changed behavior is covered by type checking, unit tests, full package tests, lint, and production build validation.
