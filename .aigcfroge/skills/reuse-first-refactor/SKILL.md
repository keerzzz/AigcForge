---
name: reuse-first-refactor
description: "Inspects AigcForge changes for duplicate hand-written implementations, dead or surplus code, stale comments, non-English new comments, and unnecessarily complex logic. Use before adding helpers or abstractions, during refactors and code review, or when aligning Chat, Work, Assistant, TUI, desktop, and shared code with Coding mode."
allowed-tools: Read Edit Write Bash Glob Grep
---

# Reuse First Refactor

Inspect an existing change or code area for duplicated, dead, oversized, and needlessly complex
implementation. Produce evidence first, then make the smallest safe correction.

## When to Use

- Before adding a helper, component, route, service, adapter, schema, or test utility.
- During review of a feature, generated patch, migration, or cross-mode implementation.
- When similar code appears in Coding, Chat, Work, Assistant, TUI, desktop, or shared packages.
- When a function has many branches, repeated transformations, stale comments, or suspicious fallback code.
- When preparing a refactor or cleanup PR.

## When NOT to Use

- Pure API or architecture discovery: use `skills/protocols/SKILL.md` and codegraph first.
- Security-specific vulnerability analysis: use the relevant security skill.
- Blind whole-repository formatting or mass deletion without an evidence report and approval.

## Core Rule

Apply this order and stop as soon as the root problem is solved:

```text
reuse -> delete -> merge -> simplify/refactor -> add
```

"Hand-written code" is a finding only when it duplicates an existing owner, bypasses a generated
boundary, or recreates a project primitive. Necessary new code is allowed after the search record
proves that reuse is unavailable or would violate scope, authority, or lifecycle semantics.

## Phase 1: Build Evidence

**Entry:** Target files or diff are known.

**Actions:**

1. Read applicable `AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md`, and the relevant package guide.
2. Inspect the diff and classify every changed symbol as reused, modified, generated, or new.
3. Search for matching names, behavior, constants, selectors, schemas, test helpers, and route patterns in the owning package and Coding mode.
4. Read each likely candidate's definition, callers, registration path, and nearest tests. Do not declare duplication from text similarity alone.

**Exit:** A candidate table exists with `candidate`, `evidence`, `compatibility`, `decision`, and `reason`.

## Phase 2: Detect Findings

**Entry:** Candidate table and target diff are available.

**Actions:**

1. Detect duplicate implementation: two owners perform the same domain operation or normalize the same data.
2. Detect dead code: unreachable branch, unused export, stale feature flag path, orphaned file, obsolete compatibility shim, or test that no longer exercises production behavior.
3. Detect surplus code: duplicate constants, repeated state, wrapper layers with no changed contract, speculative abstractions, generated-file edits, and comments that repeat the code.
4. Detect complexity: nested conditionals, avoidable mutable state, repeated scans, manual parsing where a Schema/helper exists, and a helper used once without a meaningful boundary.
5. Detect comment issues: new comments not in English, comments describing obvious statements, stale comments, or user-facing text embedded in code instead of i18n.

**Exit:** Findings are classified as `keep`, `reuse`, `delete`, `merge`, `simplify`, `needs-owner-decision`, or `false-positive`, each with file/line evidence and blast radius.

## Phase 3: Apply the Smallest Correction

**Entry:** Findings have evidence and no unresolved owner conflict.

**Actions:**

1. Prefer extending the existing owner over creating a parallel module.
2. Delete only code proven unused or superseded; preserve compatibility behavior required by an ADR, schema changelog, or public API.
3. Merge duplicate constants, types, and helpers only when ownership and import direction remain clear.
4. Simplify control flow without changing error, permission, concurrency, ordering, persistence, or public response semantics.
5. Translate or rewrite only new or touched comments into concise English; do not perform unrelated documentation cleanup.
6. Re-read the changed symbol, callers, and tests after every meaningful edit.

**Exit:** The root duplication, complexity, dead-code, or comment issue is resolved, and the diff remains focused.

## Phase 4: Verify and Report

**Entry:** The correction is implemented.

**Actions:**

1. Re-run targeted searches for the removed duplicate, dead symbol, old comment, and parallel path.
2. Run affected package tests and typecheck, then lint the diff.
3. Run UI/e2e, migration, generated SDK, or protocol checks when their boundaries are affected.
4. Review `git diff --check` and the full diff for unrelated changes or sensitive output.
5. Report findings fixed, findings intentionally retained, commands run, and residual risk.

**Exit:** Verification is green or every blocked command is explicitly recorded with its cause and impact.

## Finding Rules

| Finding        | Evidence threshold                                                    | Default action                  |
| -------------- | --------------------------------------------------------------------- | ------------------------------- |
| Duplicate      | Same behavior, same owner boundary, compatible contract               | reuse/merge                     |
| Dead           | No reachable caller or required compatibility/registration path       | delete after impact check       |
| Surplus        | Adds no behavior, authority, validation, or lifecycle value           | delete or inline                |
| Complex        | More branches, state, or indirection than the local contract requires | simplify, then test             |
| Comment defect | New, stale, non-English, or narrative comment                         | rewrite/remove                  |
| Uncertain      | Evidence conflicts or public behavior may change                      | keep and request owner decision |

## Reference

Read [detection-rules.md](references/detection-rules.md) for search patterns and evidence rules.
