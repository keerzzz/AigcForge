# Agent Execution Prompt: Mode Switcher + Secondary Sidebar

> Implementation agent: read this ENTIRE document before touching any file.
> Branch: brand-migration-v001 | Target: v0.0.1
> Plan reference: docs/plan/mode-switcher-implementation.md

---

## EXECUTION PROTOCOL (MANDATORY — Read Before Any Work)

You MUST follow this exact sequence for every task. Skipping steps causes context rot and hallucinated code.

### Step 0: Read Protocols First

Before writing a single line of code, read ALL of:
1. CLAUDE.md — project constitution, 8 virtues, 4 refusals, safety gates, verifications
2. AGENTS.md — code style, naming, imports, testing conventions
3. DESIGN.md — design language, tokens, accessibility, verification matrix
4. docs/architecture/system-blueprint.md — architecture overview, provider hierarchy, layout skeleton

If any of these files does not exist or conflicts with a later instruction, STOP AND REPORT.

### Step 1: Task Initiation — Read Upstream/Downstream Code

For each task, BEFORE editing ANY file, read:
- ALL files listed in the "Before writing code" section for that task
- The current implementation of every file in the task's "Changes" section
- Any dependency file whose import you do not already know the exact signature of

Do NOT guess import signatures, hook return types, or component props. If unsure, read the source.

### Step 2: Implement

Write code that follows:
- **No dead code**: no unused imports, props, variables, or branches
- **No hardcoded values**: all colors/spacing from v2 CSS variables, all text from i18n
- **No hand-written btoa/utils**: reuse base64Encode from @aigcfroge/core/util/encode
- **No import aliases** (import { foo as bar }), no star imports
- **No else** — use early returns
- **No any** — use precise types
- **No @ts-ignore** — use @ts-expect-error with a comment explaining why only in escape hatches
- **No try/catch** in UI code — use solid-js patterns (ErrorBoundary, Show with fallback)
- **const over let** — use ternaries or early returns
- **Functional array methods** (flatMap, filter, map) over for loops
- **Reuse** existing components (Icon, IconButtonV2, ButtonV2, Tooltip, etc.) before creating new ones
- **v2 tokens** for ALL styling: --v2-color-*, --v2-spacing-*, --v2-border-*, --v2-text-*, --v2-bg-*, --v2-icon-*
- **Accessibility**: role, aria-label, aria-expanded, aria-controls, aria-current, keyboard handlers, visible focus rings

### Step 3: Self-Review Gate (BEFORE tests)

After writing code for a task, do NOT proceed to the next task yet. Instead:
1. RE-READ the relevant sections of CLAUDE.md, AGENTS.md, DESIGN.md
2. Check each line of your changes against:
   - Eight Virtues: no guessed interfaces, no assumed business logic, no skipped verification
   - Safety: no null pointer, no unhandled promise, no hardcoded urls/secrets
   - Engineering: no @ts-ignore, no any, no dead code
   - Design: v2 tokens, i18n, accessibility, state coverage
3. Verify ALL imports actually resolve (the module exists, the export exists at that path)
4. Verify the data flow: trace each prop/value from where it's created to where it's consumed

### Step 4: Verification Gate (REQUIRED before next task)

Run ALL of:
```bash
bun --cwd packages/app typecheck
bun --cwd packages/app test --timeout 30000
bun --cwd packages/ui typecheck
bun --cwd packages/ui test --timeout 30000
bun run lint
```

ALL commands must pass with zero errors. If any test fails to compile, fix first. If an existing test breaks, investigate — you likely broke a contract.

If a test failure is genuinely pre-existing (was failing before your changes), report it but do NOT use it to justify skipping the gate.

### Step 5: Commit and Repeat

Only after all gates pass proceed to the next task. Do NOT batch tasks.

---

## Context Rot Prevention

The conversation context is limited. Follow these rules to stay productive:

1. **Re-read before edit**: If you last read a file more than 3 turns ago, re-read it. File content is the only source of truth.
2. **Do NOT assume file content from memory**: Just because you wrote secondary-sidebar.tsx 10 turns ago doesn't mean it's still intact. Re-read before editing.
3. **Tag your progress**: After each completed task (step 4), use `TodoWrite` to update the task status.
4. **If context window fills**: Focus on the CURRENT task only. Reference docs/plan/mode-switcher-implementation.md and docs/plan/agent-prompt.md (this file) as anchor documents.
5. **When stuck**: Read the real source files. Do NOT hallucinate API signatures.

---

## Task Order (3 remaining)

### Task A: Create SecondarySidebar Component

Read docs/plan/mode-switcher-implementation.md § Task A for full spec.

**Key checkpoints**:
- [ ] Read upstream: sidebar-items.tsx, sidebar-workspace.tsx, sidebar-project.tsx, helpers.ts, home.tsx, server-sync.ts, global.ts, tabs.ts, directory-picker.tsx, persist.ts
- [ ] Implement component with all states: default, search-open, search-empty, loading, empty-projects, no-sessions
- [ ] Self-review: i18n keys correct? v2 tokens used? ARIA labels present? keyboard navigable?
- [ ] Run: typecheck(app) + typecheck(ui) + test(app) + test(ui) + lint
- [ ] Output: "Task A complete"

### Task B: Modify layout.tsx

Read docs/plan/mode-switcher-implementation.md § Task B for full spec.

**Key checkpoints**:
- [ ] Read upstream: app.tsx, layout.tsx, titlebar.tsx, system-blueprint.md
- [ ] Restructure: ModeProvider wrapper, horizontal flex layout, Show/hide logic for secondary sidebar
- [ ] Self-review: any regressions in existing routes? Home still works? Session still renders?
- [ ] Run: typecheck(app) + typecheck(ui) + test(app) + test(ui) + lint
- [ ] Output: "Task B complete"

### Task C: Update home.tsx

Read docs/plan/mode-switcher-implementation.md § Task C for full spec.

**Key checkpoints**:
- [ ] Read upstream: home.tsx (full), helpers.ts, global.ts, session-route.ts, home.md
- [ ] Add mode guidance cards section; implement enterMode() with activeSessionId placement
- [ ] Self-review: cards visible on /, click navigates correctly, no regressions in project/session sections
- [ ] Run: typecheck(app) + typecheck(ui) + test(app) + test(ui) + lint
- [ ] Output: "Task C complete"

---

## Emergency Protocol

### If a file does not exist
STOP. Report the missing path. Do not create it without verifying in the plan.

### If a test fails non-deterministically
Run it 3 times. If it fails 3/3, investigate. If 1/3, report as flaky.

### If typecheck fails on code you didn't touch
Run `bun --cwd packages/app typecheck` on the clean branch first. If it also fails, the codebase pre-exists with type errors — report and proceed only for your changes.

### If the context is too long
Start a new conversation with this prompt and plan as reference. Do not try to continue from memory.

---

## Artifact Delivery Format

After each task, output:

```text
[TASK LETTER] COMPLETE
- Files modified: [list]
- Self-review passed: [yes/no]
- Verification: typecheck=[pass/fail], test=[pass/fail], lint=[pass/fail]
- Remaining risk: [none or specific concern]
```
