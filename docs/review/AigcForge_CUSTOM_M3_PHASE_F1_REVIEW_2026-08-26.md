# AigcForge Custom Mode M3 Phase F1 Review

> Date: 2026-08-26
> Branch: `approval-center`
> Scope: responder capability alignment for PermissionV2 approval waits

## Conclusion

F1 is implemented on this branch and is ready for review. It is intentionally not merged into `main` yet. The change aligns the responder fact with what an SSE connection can actually observe:

- legacy connections can answer non-custom session approvals;
- connections carrying `product-mode-custom-v1` can answer custom approvals;
- instance SSE connections are bound to their concrete directory/workspace;
- global/root SSE connections remain wildcard across Locations;
- `PermissionV2.ask()` keeps its existing preview/queue semantics;
- `PermissionV2.assert()` applies the mode and Location responder gate before creating a real pending wait.

## Changed Files

- `packages/core/src/permission/approval-presence.ts`: responder facts now include capability and optional Location scope.
- `packages/core/src/permission.ts`: actual execution assertions query the target Session mode and Location before creating a pending wait.
- `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/event.ts`: instance SSE binds its concrete Location and capability.
- `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/global.ts`: global SSE binds wildcard Location and capability.
- `packages/aigcfroge/src/server/routes/instance/httpapi/server.ts`: root event route receives the shared presence layer.
- `packages/server/src/handlers/event.ts`: the second SSE surface records the same capability fact.
- `packages/core/test/permission-ask-bounds.test.ts` and `packages/core/test/permission.test.ts`: positive, negative, mode, Location, scope-finalizer, and regression coverage.

## Red Evidence

1. Removing the `responder.custom` condition made `rejects a custom execution ask immediately when only a legacy responder is attached` time out because the request entered the pending wait. Restoring the condition returned the typed `PermissionV2.RejectedError` with `reason: "no_responder"`.
2. Removing the Location condition made `does not let a responder from another Location answer a custom execution ask` time out because a responder from `/other-project` was accepted. Restoring the condition returned the typed `no_responder` rejection.
3. The normal-input counterpart `keeps a non-custom execution ask answerable through a legacy responder` passes, proving the fail-closed guard does not reject ordinary coding-mode approval waits.
4. The capable-input counterpart `publishes and resolves a custom ask when a capable responder is attached` passes through the real `PermissionV2.assert()` path, observes `permission.v2.asked`, replies once, and settles the fiber.

## Verification

- Core focused permission suite: **36 pass / 0 fail / 97 expect() calls**.
- Existing event isolation integration suite: **11 pass / 0 fail / 38 expect() calls**.
- Core, AigcForge, and server package typechecks: **exit 0** on the clean rerun after the final branded Location fix.
- Incremental lint and `git diff --check`: final branch gates.

## Boundaries

- This slice does not implement pending aggregation, reply/revoke HTTP endpoints, SDK generation, or approval UI. Those remain F2-F5 work.
- `ask()` remains a model/permission preview and pending-registration API; responder admission belongs to `assert()`, which is the path that can wait for a reply.
- A global SSE connection is treated as wildcard Location visibility because its event stream is cross-Location; instance SSE is Location-bound.

