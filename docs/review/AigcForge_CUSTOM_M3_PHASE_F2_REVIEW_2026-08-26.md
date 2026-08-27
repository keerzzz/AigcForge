# AigcForge Custom Mode M3 Phase F2 Review

> Date: 2026-08-26
> Branch: `approval-client`
> Scope: reuse existing PermissionV2 pending/list/reply HTTP+SDK surfaces in the App approval flow

## Review Conclusion

F2 is ready for review on `approval-client`; it is deliberately **not merged into local `main` and not pushed**.

The implementation reuses the existing server contracts rather than recreating endpoints:

- global pending: `client.v2.permission.request.list()` → `GET /api/permission/request`;
- session pending: `client.v2.session.permission.list({ sessionID })` remains the existing session-scoped API;
- reply: `client.v2.session.permission.reply({ sessionID, requestID, reply })` → `POST /api/session/:sessionID/permission/:requestID/reply`.

The root cause was client-side, not HTTP-side: App previously consumed only legacy `permission.asked` / `permission.replied`, legacy `PermissionRequest`, and the deprecated legacy respond route. V2 events already reached the app global stream at runtime, but the reducer discarded them.

## Implementation Facts

- `packages/app/src/context/global-sync/permission-pending.ts` defines a strict, explicit V1/V2 pending model. V2 is never cast to legacy `PermissionRequest`.
- App maintains `permission_v2` separately from legacy `permission`; the legacy browser auto-accept logic only receives legacy requests.
- The V2 adapter retains only safe display data: request identity, action/resources/save, the three allow-listed metadata keys (`description`, `cli_target`, `execution_type`), and tool source identity. Unknown metadata, including a fixture `credentialRef`, is not stored in app state.
- `permission.v2.asked` and `permission.v2.replied` now update this V2 state. Malformed V2 asked/replied payloads are ignored; `reply` must be exactly `once`, `always`, or `reject` before an event can remove a request.
- Bootstrap correctly unwraps the generated SDK's nested response (`result.data?.data`), then merges the snapshot with V2 SSE deltas observed since the read began. A per-directory load epoch prevents an older overlapping bootstrap from overwriting a newer reconciliation.
- The Composer selects the explicit pending union, renders a normalized presentation model, and dispatches by discriminator: legacy requests retain `client.permission.respond`, V2 requests use the session-owned V2 reply API.
- Pending V2 requests keep child sessions from being trimmed and are cleared with session caches.

## HTTP / SDK Contract Evidence

The existing, non-duplicate V2 route exerciser scenarios were strengthened to create an actual V2 pending request through `PermissionV2.Service.ask()` and then verify observable endpoint behavior:

1. `v2.permission.request.list` returns the pending request in the Location-scoped aggregate response.
2. `v2.session.permission.list` returns the request for its owner Session.
3. `v2.session.permission.reply` consumes a real pending request.
4. The foreign-session reply negative case returns `404` and leaves the owner request pending, proving request ownership is not bypassed.

## Red Evidence

Each safety claim was tested by removing the corresponding production behavior, running the focused test, and restoring it immediately:

1. Removing V2 asked/replied replay from bootstrap made both overlap tests fail: an SSE `asked` request disappeared from the reconciled snapshot and a `replied` request was revived. Restored: snapshot plus live deltas preserve the live request and keep the replied request absent.
2. Removing the `permission.v2.asked` reducer branch made the V2 lifecycle test fail because the second V2 request never entered `permission_v2`. Restored: V2 insert/update/reply lifecycle is green while the legacy state remains unchanged.
3. Routing V2 replies through deprecated legacy `client.permission.respond` made the transport test fail: the call had `permissionID` / `response` and hit the legacy route rather than V2 `requestID` / `reply`. Restored: the V2 session-owned endpoint is called.
4. Reading the V2 global response as `result.data ?? []` made the bootstrap test fail because the generated response body is `{ location, data }`, not the array itself. Restored: nested `result.data?.data` is consumed.

Normal-input counterparts include V2 presentation normalization, V2 request selection without legacy auto-accept filtering, safe-metadata projection, real reply-route dispatch, and the real endpoint exerciser cases above.

## Verification

- `bun run script/lint-changed.ts`: passed; **22 changed files, 909 added lines**.
- `bun --cwd packages/app typecheck`: passed.
- `bun --cwd packages/aigcfroge typecheck`: passed.
- Focused App tests: **53 pass / 0 fail / 160 expect() calls**.
- The app package's default full test command was attempted. One pre-existing boundary-walker test exceeded its own 5-second per-test threshold under this host load; rerunning that exact test with the repository's normal 30-second command timeout passed (**2 pass**), followed by the focused F2 app suite green.
- Focused real HttpApi exerciser, final state:
  - `v2.permission.request.list`: **1 pass / 0 fail**;
  - `v2.session.permission.list`: **1 pass / 0 fail**;
  - `v2.session.permission.reply` plus foreign-owner negative: **2 pass / 0 fail**.
- `git diff --check`: passed.

## Boundaries / Remaining Work

- F2 does not add a duplicate server route, grant issuance UI, revoke UI, Builder health UI, or browser auto-accept redesign. Those remain F3-F5 scope.
- Existing `PermissionV2.ask()` retains its established pending-registration semantics and is not responder-gated; production execution waits continue through `PermissionV2.assert()`, whose responder gate was delivered in F1. The exerciser uses `ask()` only to seed real pending state for existing HTTP contracts.
- The V2 delta journal is in-memory per app directory store and is cleared after a successful reconciliation. It is a snapshot/SSE ordering bridge, not durable server authorization state.
