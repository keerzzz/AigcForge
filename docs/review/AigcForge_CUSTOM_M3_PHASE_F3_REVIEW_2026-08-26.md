# AigcForge Custom Mode M3 Phase F3 Review

> Date: 2026-08-26
> Branch: `ceiling-display`
> Scope: attended custom ceiling regression evidence and approval presentation

## Conclusion

F3 does **not** rewrite the already-delivered attended custom ceiling. The Core owner remains `PermissionEffective.compute()`.

This slice makes the resulting approval request identifiable in the existing Composer dock: every pending request now renders its canonical `action`, even if no localized tool description exists. The existing V1/V2 presentation adapter remains the only UI shape boundary; no new request schema, endpoint, grant scope, or auto-approval behavior is introduced.

## Implementation Facts

- `packages/core/src/permission/effective.ts` already implements the custom-mode asset rule rewrite: non-readonly asset `allow` becomes `ask`; the readonly allowlist remains `allow`; saved approvals are appended independently; explicit non-fallback deny is applied last.
- Existing `packages/core/test/permission-effective.test.ts` covers the four F3 rule contracts:
  1. asset execution `allow` becomes `ask` while readonly `read` remains `allow`;
  2. explicit resource deny defeats wildcard and saved approval;
  3. saved approval remains `allow` and is not rewritten as asset policy;
  4. non-custom behavior remains unchanged.
- Existing `packages/core/test/permission-ask-bounds.test.ts` composes the actual runtime chain: custom asset `bash allow` reaches the real V2 pending prompt when a capable responder is attached; readonly `read allow` completes without a prompt; without a responder, the rewritten ask fails typed without creating pending state.
- `packages/app/src/pages/session/composer/session-permission-dock.tsx` now renders `request().action` in a stable `permission-action` slot. Localized descriptions remain supplemental text, never the only action identity.

## Red Evidence

All red proofs were run by temporarily removing the actual production guard, executing the focused test, and restoring the source immediately.

1. Removing the custom `allow -> ask` rewrite caused the composed runtime test `a rewritten allow reaches a real prompt while a responder is attached` to fail: `PermissionV2.ask()` returned `allow` instead of `ask`; the no-responder counterpart also failed because no prompt-equivalent rejection occurred. Restored behavior: the execution action reaches the V2 approval path.
2. Removing `!readonlyCeilingAction.has(rule.action)` caused `attended custom：非白名单资产 allow 全部重写为 ask，白名单保持 allow` to fail: `read` incorrectly became `ask`. Restored behavior: readonly is not over-blocked.
3. Removing final explicit-deny replay caused `attended custom：显式资源级 deny 仍压过通配 allow 与 saved（位序不变）` to fail: `.env` became `allow`. Restored behavior: explicit deny remains final.
4. Removing saved-approval replay caused `attended custom：saved 追加来源不被天花板削掉` to fail: the saved `grep logs/*` approval became `ask`. Restored behavior: a user’s explicit saved approval is not treated as an asset allow.
5. Before the UI change, the new Dock contract test failed because `data-slot="permission-action"` was absent. Restored behavior: the action slot renders `request().action` independently of localization.

## Verification

- Core focused suites:
  - `bun test --timeout 30000 ./test/permission-effective.test.ts ./test/permission-ask-bounds.test.ts`
  - **41 pass / 0 fail / 263 expect() calls**.
- App focused UI structural contract:
  - `bun test --timeout 30000 --preload ./happydom.ts ./src/pages/session/composer/session-permission-dock.test.tsx`
  - **3 pass / 0 fail / 8 expect() calls**.
  - This follows the existing source-level Dock contract style; it is not DOM or Playwright evidence.
- `bun --cwd packages/core typecheck`: passed.
- `bun --cwd packages/app typecheck`: passed.
- `bun run script/lint-changed.ts`: passed.
- `git diff --check`: passed.

## Boundaries / Remaining Work

- F3 neither changes the effective permission policy nor introduces an action/provenance field into the V2 request contract.
- F3 does not implement a global pending indicator/dialog, scope selection, grant issuance/revocation, or Builder health: those are F4.
- F3 does not change browser auto-accept, including the directory wildcard and parent-session inheritance. F5 remains blocked on the required human product/security choice: remove it, reduce it to non-authoritative UI convenience, or migrate it to an auditable `ScopedGrant`.
- Phase G remains after F3-F5 completion and their reviews.
