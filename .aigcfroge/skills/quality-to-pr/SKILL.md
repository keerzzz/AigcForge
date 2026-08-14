---
name: quality-to-pr
description: "Drives an AigcForge change from clarified requirements through implementation, reuse review, tests, end-to-end verification, commit, push, and PR evidence. Use for feature, bug fix, refactor, cleanup, schema, UI, or cross-package work intended for remote review."
allowed-tools: Read Edit Write Bash Glob Grep
---

# Quality To PR

Run this skill for a complete repository change from clarified requirements to a reviewable,
verified branch and PR. It is a sequential pipeline with explicit stop gates; it does not silently
push or open a PR when required human or remote-state confirmation is missing.

## When to Use

- Implement a feature, bug fix, refactor, cleanup, schema change, or UI change intended for review.
- Turn an approved plan into code and a remote PR.
- Prepare a Coding-mode change for end-to-end verification.
- Recover a partially completed branch with existing edits or failed checks.

## When NOT to Use

- Read-only code review: use the review-specific skill and do not modify the branch.
- Security incident response: use the applicable security workflow first.
- Release publishing or production deployment: use the release workflow after the PR is merged.

## Safety And Ownership

- Never discard user or unrelated work. Inspect dirty state and isolate the task first.
- Never commit secrets, credentials, full prompts, user file content, generated noise, or unrelated changes.
- Never push or create a PR without confirming target branch, remote, issue linkage, and final diff.
- Do not bypass hooks or failed checks in the final run. A temporary skip must be re-run before delivery.
- Use the repository's Coding-mode implementation and `reuse-first-refactor` skill before adding code.

## Phase 1: Intake And Scope

**Entry:** The user has described a change or approved plan.

**Actions:**

1. Restate the intended problem, user-visible behavior, non-goals, acceptance criteria, and risk.
2. Inspect `git status`, current branch, remotes, and the diff against `main` or `origin/main` without changing existing work.
3. Read `CLAUDE.md`, applicable `AGENTS.md`, `ARCHITECTURE.md`, `DESIGN.md`, package guides, ADRs, specs, and tests using `skills/protocols` routing.
4. Identify affected packages, generated artifacts, migrations, APIs, UI surfaces, permissions, and external integrations.
5. Stop for clarification if requirements conflict with an accepted contract or the target behavior cannot be inferred safely.

**Exit:** A bounded change scope and acceptance checklist are written in the plan or response.

## Phase 2: Reuse And Design Check

**Entry:** Scope and affected boundaries are known.

**Actions:**

1. Search the exact owner module, Coding mode, `build` agent, shared UI, core services, existing routes, schemas, fixtures, and test helpers.
2. Build a reuse table: candidate, caller/test evidence, compatibility, selected action, and rejected alternatives.
3. Inspect for duplicate, dead, surplus, over-complex, non-English-commented, generated, or hand-written bypass code.
4. Choose the smallest valid action: reuse, delete, merge, simplify, refactor, then add only as a last resort.
5. Define the test matrix before implementation: unit/domain, integration/API, UI, e2e, migration, security, and regression cases that apply.

**Exit:** The owner module, implementation approach, test matrix, and non-goals are explicit.

## Phase 3: Implement In Small Slices

**Entry:** Reuse/design check is complete.

**Actions:**

1. Implement one vertical slice at a time, following the applicable package protocol and existing Coding-mode pattern.
2. Keep handlers and adapters thin and put behavior in the established service or owner module.
3. Add or update focused tests beside the implementation; do not duplicate production logic in test helpers.
4. Regenerate SDK, migration index, schema, or other generated output through the repository script when required. Never hand-edit generated output to hide drift.
5. After each slice, inspect the focused diff and run the smallest relevant test and typecheck before continuing.

**Exit:** Requested behavior is implemented, focused tests cover acceptance criteria, and generated artifacts are synchronized.

## Phase 4: End-To-End Verification

**Entry:** Implementation and focused checks pass.

**Actions:**

1. Run affected package typechecks with the package command; never invoke `tsc` directly.
2. Run affected package tests from package directories, including regression tests and the full package suite when practical.
3. Run repository incremental lint and formatting/diff checks; run full lint when the change is broad or before merging.
4. For HTTP or SDK changes, run API/auth/coverage exercises and regenerate/check the SDK.
5. For UI changes, run unit tests, Playwright e2e, desktop and narrow viewport checks, light/dark themes, keyboard focus, empty/loading/error states, and English/Chinese overflow checks.
6. For database changes, apply migrations against clean and existing fixtures, test compatibility, and inspect generated schema/migration diffs.
7. For security-sensitive changes, verify path/command/URL validation, authorization, XSS boundaries, secret redaction, interruption, and fail-closed behavior.
8. If a check cannot run, record the exact blocker and residual risk; do not call the workflow green.

**Exit:** All applicable checks pass, or remaining failures and risks are explicit and require a human decision.

## Phase 5: Differential Review And Cleanup

**Entry:** Verification results are known.

**Actions:**

1. Review the diff against `origin/main` for correctness, regressions, scope creep, dead code, duplicate code, comment language, generated churn, and API/schema compatibility.
2. Re-run searches for old symbols, bypass paths, stale comments, duplicate constants, and forbidden patterns.
3. Check logs and tests for secrets, full prompts, user file content, unstable sleeps, broad mocks, unchecked casts, and swallowed failures.
4. Confirm documentation, specs, ADRs, schema changelog, and roadmap status are synchronized when behavior changed.
5. Produce the repository review conclusion: affected files, skills, security gates, engineering gates, commands, and residual risk.

**Exit:** The diff is minimal, explainable, and review-ready; all known risks are documented.

## Phase 6: Commit, Push, And PR

**Entry:** User has approved the final diff and remote delivery details are available.

**Actions:**

1. Confirm an existing issue or obtain its identifier; PRs must link the issue with `Fixes #N` or `Closes #N`.
2. Confirm a short branch name of at most three hyphen-separated words and a conventional commit/PR title.
3. Run final pre-push checks, including the repository typecheck hook, without bypassing failures.
4. Commit only intended files with `type(scope): summary`.
5. Re-read `git show --stat --oneline HEAD`, confirm the working tree, and verify no secrets or unrelated changes.
6. Fetch/rebase or merge `origin/main` according to repository policy; resolve conflicts by re-reading protocols and re-running verification.
7. Push the branch to the confirmed remote. Do not force-push unless explicitly authorized.
8. Open or prepare the PR with problem, solution, scope, tests, e2e evidence, screenshots for UI changes, migrations, risks, and issue linkage. Keep it concise per `CONTRIBUTING.md`.
9. Read the created PR and CI result back from the remote. Report the URL, commit, checks, review blockers, and remaining risk.

**Exit:** Remote branch and PR are verified, or delivery stops at the exact missing approval, credential, issue, or CI condition.

## Required Output

```text
Delivery conclusion:
- Scope and acceptance:
- Reused owners:
- Changed files:
- Tests/typechecks/lint/e2e:
- Security and engineering gates:
- Commit and remote branch:
- PR URL and CI status:
- Remaining risks or blocked steps:
```

## Reference

Read [delivery-gates.md](references/delivery-gates.md) for the command matrix and PR evidence checklist.
Read [end-to-end-pr.md](workflows/end-to-end-pr.md) when executing the complete implementation-to-PR pipeline.
