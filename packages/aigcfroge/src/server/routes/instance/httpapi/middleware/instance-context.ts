import { existsSync } from "node:fs"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import { Effect, Layer } from "effect"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { ApiNotFoundError, notFound } from "../errors"
import { WorkspaceRouteContext } from "./workspace-routing"

export class InstanceContextMiddleware extends HttpApiMiddleware.Service<
  InstanceContextMiddleware,
  {
    requires: WorkspaceRouteContext
  }
>()("@aigcfroge/ExperimentalHttpApiInstanceContext", { error: ApiNotFoundError }) {}

function decode(input: string): string {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

export const instanceContextLayer = Layer.effect(
  InstanceContextMiddleware,
  Effect.gen(function* () {
    const store = yield* InstanceStore.Service
    return InstanceContextMiddleware.of((effect) =>
      Effect.gen(function* () {
        const route = yield* WorkspaceRouteContext
        const directory = FSUtil.resolve(decode(route.directory))
        // A stale remembered directory (deleted, renamed, mid-worktree-reset, or
        // migrated to a new machine) must not reach InstanceStore.load: Project /
        // Git resolution against a missing path can surface as an untyped defect
        // further down (e.g. mid-flight with Worktree.remove/reset, which disposes
        // the cached instance before the directory is gone from disk), and this
        // legacy surface has no boundary layer to translate that into a typed
        // response the way LocationMiddleware does for the V2 surface. Fail fast
        // with the same typed 404 every other handler on this API uses. Resolve
        // first (InstanceStore.load resolves internally too) so a relative input
        // is checked and reported the same way it will be loaded.
        //
        // Deliberately synchronous (node:fs existsSync, not the Effect
        // FileSystem service's async existsSafe): this middleware also guards
        // PtyConnectApi.connect, a `handleRaw` WebSocket upgrade route. Routing
        // the check through `yield* fs.exists` (Effect FileSystem -> node:fs/
        // promises access) left the fiber not resuming in time under repeated
        // upgrade/reject cycles on the same connection (reproduced in isolation:
        // packages/aigcfroge/test/server/httpapi-listen.test.ts "rejects unsafe
        // PTY ticket mint and connect requests" hung waiting for a WebSocket
        // rejection in 3/3 runs with the async check, and passed 3/3 with this
        // synchronous one). A plain existsSync avoids scheduling this check on
        // the Effect fiber runtime altogether.
        const exists = existsSync(directory)
        if (!exists) return yield* notFound(`Directory not found: ${directory}`)
        const ctx = yield* store.load({ directory })
        return yield* effect.pipe(
          Effect.provideService(InstanceRef, ctx),
          Effect.provideService(WorkspaceRef, route.workspaceID),
        )
      }),
    )
  }),
)
