# End-to-End Implementation To PR

Execute these phases in order. Do not skip a phase because the change appears small; reduce the
checks inside a phase only when the affected boundary is demonstrably out of scope.

## Phase 1: Intake

**Entry:** A user request or approved implementation plan exists.

**Actions:**

1. State the problem, user impact, acceptance criteria, non-goals, and risk.
2. Inspect `git status`, branch, remotes, and the diff against `main` or `origin/main`.
3. Preserve unrelated user changes. Do not reset, checkout, or clean files without explicit approval.
4. Route the task through `skills/protocols` and read the applicable root, package, architecture, design, spec, and ADR files.

**Exit:** A bounded scope and an acceptance checklist exist.

## Phase 2: Reuse Audit

**Entry:** Affected files and boundaries are known.

**Actions:**

1. Search the owner module, Coding mode, `build` agent, shared components, services, schemas, routes, fixtures, and tests.
2. Read each candidate definition, caller, registration path, and focused test.
3. Classify findings as reuse, delete, merge, simplify, add, or escalate.
4. Record why rejected candidates cannot be reused.
5. Search for dead code, duplicate constants, stale flags, unnecessary wrappers, complex branches, generated-file edits, and non-English new comments.

**Exit:** The selected owner and smallest implementation action are documented.

## Phase 3: Test Design

**Entry:** The implementation owner is selected.

**Actions:**

1. Define unit/domain cases for success, invalid input, expected failure, and boundary values.
2. Define integration/API cases for persistence, authorization, routing, error mapping, and generated clients when applicable.
3. Define UI/e2e cases for the real user journey, reload/reconnect, empty/loading/error states, keyboard operation, responsive layout, light/dark themes, and English/Chinese text overflow when applicable.
4. Define migration, security, concurrency, interruption, idempotency, and provider round-trip cases when applicable.

**Exit:** Every acceptance criterion maps to at least one executable check or a documented manual check.

## Phase 4: Implement

**Entry:** Test design and reuse audit are complete.

**Actions:**

1. Implement one vertical slice at a time using the existing Coding-mode owner and package conventions.
2. Keep one source of truth for behavior, constants, schemas, UI patterns, and error semantics.
3. Keep new comments short and English-only; remove or correct stale comments in touched code.
4. Add focused tests beside production code. Use repository fixtures and readiness signals instead of arbitrary sleeps.
5. Regenerate SDK, migration indexes, schemas, or other generated artifacts through their scripts.
6. After each slice, run the focused test and typecheck, then inspect `git diff -- <files>`.

**Exit:** Implementation is complete, focused checks pass, and generated artifacts are synchronized.

## Phase 5: Full Verification

**Entry:** All slices pass focused verification.

**Actions:**

1. Run `bun run script/lint-changed.ts` and `git diff --check`.
2. Run each affected package's `typecheck` and `test` from its package directory.
3. Run HTTP API/auth exercises and SDK typecheck when server or SDK contracts changed.
4. Run Playwright e2e and manual browser checks when UI behavior changed.
5. Run clean and existing database migration tests when persistence changed.
6. Run full `bun typecheck` and `bun run lint` before merge when the change is cross-package or broad.
7. Record every skipped or blocked check with its exact cause and residual risk.

**Exit:** All applicable verification is green, or the workflow is explicitly blocked with evidence.

## Phase 6: Differential Review

**Entry:** Verification output is available.

**Actions:**

1. Compare the complete diff with `origin/main`.
2. Check behavior, package boundaries, generated churn, migrations, API compatibility, security, logs, and user-visible text.
3. Re-run searches for old symbols, duplicate paths, bypasses, stale comments, forbidden casts, arbitrary sleeps, and swallowed failures.
4. Confirm docs, specs, ADRs, schema changelog, and roadmap entries are synchronized when required.
5. Produce the repository review conclusion with changed files, skills, gates, commands, and residual risks.

**Exit:** The diff is minimal, explainable, and review-ready.

## Gate 1: Delivery Approval

Present the final diff summary, verification results, remaining risks, target remote, target branch,
issue number, proposed commit, and proposed PR title. Do not commit, push, or open a PR until the
user approves delivery or the project explicitly grants that authority.

## Phase 7: Commit And Remote Delivery

**Entry:** Gate 1 is approved and remote details are confirmed.

**Actions:**

1. Confirm the branch is at most three hyphen-separated words and the commit follows `type(scope): summary`.
2. Run the final pre-push checks without bypassing failures.
3. Stage only intended files. For ignored protocol skills, use an exact path list with `git add -f`; never add the whole `.aigcfroge/` directory.
4. Commit and inspect `git show --stat --oneline HEAD`.
5. Confirm the worktree and commit contain no secrets, full prompts, user file content, or unrelated changes.
6. Update from `origin/main` according to repository policy, resolve conflicts, and rerun affected verification.
7. Push to the confirmed remote without force-pushing unless explicitly authorized.

**Exit:** The remote branch points to the verified commit.

## Gate 2: PR Creation And Readback

**Entry:** The branch is pushed and the issue identifier is confirmed.

**Actions:**

1. Create or prepare a concise PR with problem, solution, scope, non-goals, tests, e2e evidence, screenshots, migration notes, and risks.
2. Link the issue with `Fixes #N` or `Closes #N`.
3. Read the PR back from the remote and verify title, base branch, changed files, issue linkage, and CI checks.
4. Report the PR URL, commit, check results, review blockers, and residual risk.

**Exit:** The PR is remotely verified, or the exact blocked step is reported without claiming completion.
