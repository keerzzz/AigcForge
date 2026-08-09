export * as DoomLoop from "./doom-loop"

import { createHash } from "crypto"
import { Context, Effect, Layer, Ref } from "effect"
import { Config } from "../config"
import { PermissionV2 } from "../permission"
import { SessionV2 } from "../session"
import { SessionSchema } from "./schema"

const DEFAULT_THRESHOLD = 3

// Bound on the number of sessions whose recent-call fingerprints are retained.
// The buffer is a plain Map with insertion order: Map.set on an existing key
// does not refresh its position, so the evicted entry is the earliest-inserted
// session (FIFO, not LRU). Without a cap, one entry per ever-seen session
// would leak for the lifetime of the layer.
const MAX_TRACKED_SESSIONS = 32

type Settings = {
  readonly enabled: boolean
  readonly threshold: number
}

type CheckInput = {
  readonly sessionID: SessionSchema.ID
  readonly toolName: string
  readonly toolInput: unknown
  readonly providerExecuted: boolean
  readonly source?: PermissionV2.Source
}

export interface Interface {
  readonly check: (input: CheckInput) => Effect.Effect<void, PermissionV2.Error | SessionV2.NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/DoomLoop") {}

// Self-contained sha256 fingerprint so the detector does not depend on the
// private CacheShape.shortHash helper. Input = tool name + stable JSON.
const fingerprintOf = (toolName: string, toolInput: unknown) =>
  createHash("sha256")
    .update(`${toolName}${JSON.stringify(toolInput)}`)
    .digest("hex")
    .slice(0, 16)

const settings = (documents: readonly Config.Entry[]) => {
  const configured = documents
    .filter((entry): entry is Config.Document => entry.type === "document")
    .flatMap((entry) => (entry.info.meta?.doom_loop ? [entry.info.meta.doom_loop] : []))
  return configured.reduce<Settings>(
    (result, current) => ({
      enabled: current.enabled ?? result.enabled,
      threshold: current.threshold ?? result.threshold,
    }),
    { enabled: true, threshold: DEFAULT_THRESHOLD },
  )
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const permission = yield* PermissionV2.Service
    const config = yield* Config.Service
    // Config is a process-lifetime snapshot (Config.entries reads the configs
    // captured when its layer was built); hot reload is achieved by session
    // restart, so evaluating settings here matches the Config.Service contract.
    const configured = settings(yield* config.entries())
    const buffer = yield* Ref.make(new Map<SessionSchema.ID, string[]>())

    const check = Effect.fn("DoomLoop.check")(function* (input: CheckInput) {
      if (!configured.enabled || input.providerExecuted) return
      const fingerprint = fingerprintOf(input.toolName, input.toolInput)
      const recent = yield* Ref.modify(buffer, (map) => {
        // Evicting the oldest session also cools it down: a session that was
        // evicted and later returns restarts its fingerprint count from zero,
        // so it cannot trigger a doom_loop approval immediately after eviction.
        if (map.size >= MAX_TRACKED_SESSIONS && !map.has(input.sessionID)) {
          const oldest = map.keys().next().value
          if (oldest !== undefined) map.delete(oldest)
        }
        const next = [...(map.get(input.sessionID) ?? []), fingerprint].slice(-configured.threshold)
        return [next, map.set(input.sessionID, next)]
      })
      if (recent.length < configured.threshold || !recent.every((item) => item === fingerprint)) return
      yield* permission.assert({
        action: "doom_loop",
        resources: [input.toolName],
        save: [input.toolName],
        sessionID: input.sessionID,
        source: input.source,
        metadata: { tool: input.toolName },
      })
    })

    return Service.of({ check })
  }),
)
