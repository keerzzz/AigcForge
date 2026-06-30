# Differential Review Report

## Executive Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 1 |

**Overall Risk:** LOW
**Recommendation:** APPROVE for the reviewed fix set.

**Key Metrics:**
- Files analyzed: prompt admission, agent selection, task delegation, external CLI execution, DB migration, and changed/untracked TypeScript surface
- Security regressions detected after fix: 0
- Prior blocker fixed: prompt admission only direct-routes safe primary-agent targets and falls back to meta for subagents, external CLIs, workflows, and multi-target routes
- Verification: typecheck/tests pass; scoped oxlint has 0 warnings and 0 errors

## What Changed

**Range:** working tree against `HEAD` on `dev`-based repository state.

| Area | Files | Risk |
|------|-------|------|
| Prompt admission safe direct routing | `packages/aigcfroge/src/session/prompt.ts`, `packages/aigcfroge/test/session/prompt-preroute.test.ts` | LOW |
| Meta/default agent selection | `packages/aigcfroge/src/agent/agent.ts`, `packages/core/src/agent.ts` | LOW |
| External CLI task delegation | `packages/aigcfroge/src/tool/task.ts`, meta adapter files/tests | LOW |
| Plugin tool registry cleanup | `packages/aigcfroge/src/tool/registry.ts` | LOW |
| DB migration generated artifacts | `packages/core/schema.json`, migration/schema generated files | LOW |

## Resolved Findings

### RESOLVED: Prompt admission treated unsafe pre-router targets as session agents

**File:** `packages/aigcfroge/src/session/prompt.ts`
**Fix:** constrained prompt-admission pre-routing to high-confidence, single-target, visible primary/all agents.
**Regression Test:** `packages/aigcfroge/test/session/prompt-preroute.test.ts`

Previously, omitted-agent prompts ran `PreRouter.preRoute(...)` and assigned `route.targets[0].engine` to `agentName`. That broke prompts such as:

```text
@codex review this        -> engine: "codex"
@claude-code inspect      -> engine: "claude-code"
先做 A 再做 B              -> engine: "builtin"
```

Those values are not registered agents. The fix keeps the meanings separate: explicit `input.agent` is honored; omitted-agent prompts may direct-route only when the target is a safe primary agent; all other pre-router targets fall back to the default `meta` agent so the orchestration layer can handle external CLI mentions, workflow phrases, and multi-target routes.

The revised regression test covers fallback-to-meta cases:
- `@codex review this`
- `@claude-code inspect this`
- `先做 A 再做 B`
- `@explore 查找代码 @build 实现修复`
- `explain how authentication works`

Each prompt is admitted successfully with `message.info.agent === "meta"`.

It also covers safe direct-routing cases:
- `fix login bug`
- `@build 修复这个 bug`

Each is admitted with `message.info.agent === "build"`.

### RESOLVED: Auto-routing can bypass meta only for safe primary targets

Prompt admission now allows the intended optimization only when the pre-router returns exactly one high-confidence target and that target resolves to a visible non-subagent. High-confidence text such as `fix login bug` can direct-route to `build`, while `explore`, external CLI, workflow, unknown, and multi-target cases stay on the default `meta` agent for orchestration.

### RESOLVED: Multiple @mentions were collapsed to the first target

Because prompt admission only consumes a single safe primary target, multi-mention intent remains in the user text for the meta layer instead of being collapsed into one session agent.

### RESOLVED: Changed-file scoped lint warning

Scoped oxlint over changed and untracked TypeScript files now reports 0 warnings and 0 errors.

## Remaining Low-Risk Note

`.codegraph/daemon.pid` remains dirty local runtime state. It should stay out of review/commit scope.

## Test Coverage Analysis

Commands run:

| Command | Result |
|---------|--------|
| `bun --cwd packages/aigcfroge typecheck` | PASS |
| `bun --cwd packages/core typecheck` | PASS |
| `bun --cwd packages/plugin typecheck` | PASS |
| `bun --cwd packages/aigcfroge test test/session/prompt-preroute.test.ts --timeout 30000` | PASS |
| `bun --cwd packages/aigcfroge test test/session/prompt-preroute.test.ts test/agent/meta/meta-agent.test.ts test/agent/meta/prerouter.test.ts --timeout 30000` | PASS |
| `bun --cwd packages/aigcfroge test test/session/prompt.test.ts --timeout 30000` | PASS |
| `bun --cwd packages/aigcfroge test test/agent/meta/prerouter.test.ts test/agent/meta/mention.test.ts test/tool/task.test.ts test/session/prompt-preroute.test.ts --timeout 30000` | PASS |
| `bun --cwd packages/core test test/database-migration.test.ts test/agent.test.ts test/plugin/host.ts --timeout 30000` | PASS |
| `git diff --check` | PASS |
| Scoped `bunx oxlint` over changed/untracked TS | PASS, 0 warnings |

## Blast Radius Analysis

| Function | Risk After Fix | Reason |
|----------|----------------|--------|
| `SessionPrompt.createUserMessage` | LOW | Maps only high-confidence single visible primary targets; otherwise falls back to default agent |
| `PreRouter.preRoute` | LOW | Still unit-tested; prompt admission consumes only a constrained subset |
| `TaskTool.executeCLI` | LOW | Permission ask and argv spawning remain covered by task tests |
| `Agent.defaultInfo/defaultAgent` | LOW | Meta default behavior is covered by agent tests |

## Analysis Methodology

**Strategy:** FOCUSED, security/behavioral review of current working-tree diff.

**Techniques:**
- Reviewed changed prompt admission code and direct dependencies.
- Verified pre-router outputs for primary agent, subagent, external CLI, workflow, and multi-target cases.
- Added prompt-admission regression tests for safe build direct-routing and fallback-to-meta admission.
- Ran package typechecks, targeted prompt/task/meta tests, core migration/agent/plugin tests, diff whitespace check, and scoped lint.

**Limitations:**
- Did not inspect every untracked doc file in detail.
- Did not run full repository tests.
- Did not perform browser/manual UI verification because the change is backend/session/tooling focused.

**Confidence:** HIGH for the fixed prompt-admission routing issue; MEDIUM for broader untracked meta-agent behavior.
