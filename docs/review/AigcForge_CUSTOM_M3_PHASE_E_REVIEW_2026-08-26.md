# AigcForge Custom Mode M3 Phase E Review

> Date: 2026-08-26
> Branch: `mcp-composition`
> Scope: Resolver, Plan/Snapshot MCP facts, connection-owner runtime facts, custom provider-turn drift checks

## Review Conclusion

**Initial review conclusion was superseded by `2307df31f` after post-merge review found one false-positive drift bug and one incomplete Resolver red-proof claim.** The corrected Phase E implementation is on local `main` at `497268161`: it binds MCP composition output to observed connection-owner facts instead of treating registration capability as runtime truth, and it uses one locale-aware audit comparison at both durable-Snapshot and provider-turn boundaries. No Composition V3 was introduced: MCP plan data and Snapshot audit data use optional/default fields inside the existing V2 shape.

## Impacted Files

- `packages/schema/src/composition.ts`: MCP refs, requested/effective/denied Plan projection, six-state health schema, Snapshot V2 audit facts.
- `packages/schema/src/custom-profile.ts`: Profile MCP bindings and canonical strict binding decoder.
- `packages/schema/src/mcp-scope.ts`: shared health schema source and existing binding contract.
- `packages/core/src/mcp/connection.ts`: read-only owner facts, per-admission credential revalidation, health projection synchronization.
- `packages/core/src/composition-resolver.ts`: explicit Profile binding resolution, asset revision checks, effective MCP catalog filtering, Snapshot audit projection.
- `packages/core/src/session/composition.ts`: durable Snapshot MCP catalog/audit consistency checks.
- `packages/core/src/session/runner/llm.ts`: provider-turn MCP identity, health, registration, and catalog drift guard.
- `packages/core/src/location-layer.ts`: production provisioning of the single MCP connection owner.
- Tests under `packages/core/test` and `packages/schema/test` plus the Phase E facts recorded in the M3 plan documents.

## Protocol And Skills

- `CLAUDE.md` and `AGENTS.md`: Effect composition, strict Schema boundaries, package-local tests, no broad mocks, no new sleep/timer waits, and explicit layer provisioning.
- `.aigcfroge/skills/effect/SKILL.md`: typed Effect boundaries, tagged errors, scoped resources, and real service tests.
- `.aigcfroge/skills/database/SKILL.md`: migration check and no schema migration for this Phase.
- `.aigcfroge/skills/protocols/SKILL.md`: protocol references and source-of-truth routing.
- `packages/core/src/tool/AGENTS.md`: one canonical ToolRegistry/MCP registration path and captured settlement boundary.

## Security And Engineering Gates

- Catch Everything: transport, JSON, subprocess, HTTP response, and credential resolution failures remain typed or explicitly bounded at their effect boundaries.
- No Null Pointer: optional credential refs, connection facts, stale assets, missing snapshots, and absent owner services are checked before use.
- Security First: Snapshot never stores command, URL, headers, client, executor, PID, health, or credential material. Credential refs remain opaque. Profile bindings reject excess and secret-like fields before persistence/API candidate normalization.
- No Cheating: no `any`, `@ts-ignore`, parallel owner, second registry, or test-only production dependency was added.
- Reusability: the existing `McpConnection.Service`, `McpRegistration.registerServer`, `McpScope.decodeBinding`, and `ToolRegistry` paths are reused.
- Clean Logs: MCP stderr and remote headers/body use the existing scan-before-truncate redaction path.

## Red Evidence

Each safety assertion was tested by temporarily removing the production observation point, running the focused test, and restoring the change immediately. The initial report overstated item 1: it covered an unbound registered server but not the requested-server denial branches. The correction below preserves the valid catalog evidence and records the missing branch evidence separately.

1. Removed both Resolver MCP catalog filters. `resolves only profile-bound MCP registrations into Plan and Snapshot audit facts` failed because the unbound `mcp_unbound_admin` appeared in the frozen catalog. This proves that a server absent from the Profile does not leak into the frozen catalog; it does **not** prove requested-but-unusable denial behavior. Restored: focused MCP group green.
2. `2307df31f` added three requested-server denial proofs. Removing the no-fact denial makes `denies a requested MCP server that the connection owner has no fact for` fail; removing the `health !== "ready"` gate makes `denies a requested MCP server whose fact exists but is not ready` fail; weakening fact matching to server name makes `denies a connected MCP server whose live identity is not the frozen binding` fail. Each case unconditionally asserts the denial reason and the exact effective tool count, rather than optional-chaining a nonexistent catalog field.
3. Removed the Runner `verifySnapshotMcp` call. `fails before provider dispatch when MCP registration identity no longer matches the frozen binding` returned success instead of a drift failure. Restored: focused drift group green.
4. `2307df31f` replaced two incompatible audit sort implementations with `Composition.mcpAuditMatchesCatalog`. The regression tests prove that default sorting and `localeCompare` disagree for legal `mcp_git_list-files` / `mcp_git_list_files` names, while the shared helper accepts the valid catalog. Reverting the helper to default `.toSorted()` makes that valid-input test fail.
5. Removed `requestOn` binding-store revalidation. `revoking a bound credential fails the next tool admission before the server observes it` timed out waiting on the fixture, proving the call crossed admission. Restored: the test passed with typed `McpBinding.RevokedRefError`, `revoked` health, matching `Fact.health`, and no server marker.
6. Replaced the Profile MCP canonical decoder with ordinary `McpServerBinding` decoding. The secret-bearing negative test failed because `authorization` was silently stripped. Restored: schema negative test green.

## Verification

- `bun --cwd packages/schema test --timeout 30000`: **140 pass / 0 fail / 338 expect() calls**.
- `bun --cwd packages/schema typecheck`: **exit 0**.
- `bun --cwd packages/core test --timeout 30000`: **2174 pass / 2 skip / 0 fail / 6230 expect() calls**.
- `bun --cwd packages/core typecheck`: **exit 0**.
- `cd packages/core && bun run script/migration.ts --check`: **no schema changes; clean/existing migration checks completed**.
- Server-suite count in this initial record was read incorrectly and is superseded by the post-merge verification below.
- `bun run script/lint-changed.ts`: **Incremental lint passed: 15 changed files, 1053 added lines**.
- `bash .aigcfroge/skills/protocols/scripts/check-refs.sh`: **32/32 references present**.
- `git diff --check`: **exit 0**.

## Post-Merge Correction Verification

- `bun --cwd packages/schema test --timeout 30000`: **145 pass / 0 fail**.
- `bun --cwd packages/core test --timeout 30000`: **2177 pass / 2 skip / 0 fail**.
- `bun --cwd packages/schema typecheck && bun --cwd packages/core typecheck`: **exit 0**.
- `bun --cwd packages/aigcfroge test test/server/ --timeout 60000 --concurrency 1`: **379 pass / 2 skip / 0 fail, 381 tests total**.
- `bun run script/lint-changed.ts`: **Incremental lint passed: 5 changed files, 242 added lines**.

## SDK Generation Note

`bun run script/generate.ts` was started to inspect the generated surface. Its OpenAPI/SDK phase completed, but the subsequent repository skill-generation phase recursively scanned `.claude/worktrees` and continued producing unrelated formatting/type changes. It was interrupted before completion. All generator collateral was restored, and no SDK/OpenAPI generated diff is included in this Phase E commit. The server SDK tests passed against the existing generated surface. A focused SDK generation run excluding nested worktrees remains a follow-up before Phase F exposes new HTTP/SDK fields.

## Remaining Risk

- Phase E does not add Profile-start auto-connect. An explicit admission/coordinator is still required to establish connection facts before resolve/freeze.
- Revocation rejects new connection/tool admissions but does not interrupt already in-flight provider, HTTP, or child-process calls, matching ADR-21.
- `MCPAsset.configJson` remains an opaque legacy body. It is not trusted as a validated connection configuration source.
- Phase F client approval-center consumption and Phase G fault-injection coverage remain outstanding.
