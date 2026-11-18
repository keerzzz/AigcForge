export * as DoomLoop from "./doom-loop"

import { Context, Effect, Layer, Option, Ref, Schema } from "effect"
import { Config } from "../config"
import { Document, type Entry } from "@aigcfroge/schema/config"
import { Permission } from "../permission"
import { Session } from "../session"
import { SessionSchema } from "./schema"
import { Instructions } from "../instructions"
import type { Agent } from "../agent"

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
  readonly source?: Permission.Source
  readonly agent?: Agent.ID
}

export interface Interface {
  readonly check: (input: CheckInput) => Effect.Effect<void, Permission.Error | Session.NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/DoomLoop") {}

const fingerprintOf = (toolName: string, toolInput: unknown) => {
  const input = Schema.decodeUnknownOption(Schema.Json)(toolInput)
  return Option.isSome(input) ? Instructions.hash([toolName, input.value]) : undefined
}

const settings = (documents: readonly Entry[]) => {
  const configured = documents
    .filter((entry): entry is Document => entry.type === "document")
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
    const permission = yield* Permission.Service
    const config = yield* Config.Service
    // Config is a process-lifetime snapshot (Config.entries reads the configs
    // captured when its layer was built); hot reload is achieved by session
    // restart, so evaluating settings here matches the Config.Service contract.
    const configured = settings(yield* config.entries())
    const buffer = yield* Ref.make(new Map<SessionSchema.ID, string[]>())

    const check = Effect.fn("DoomLoop.check")(function* (input: CheckInput) {
      if (!configured.enabled || input.providerExecuted) return
      const fingerprint = fingerprintOf(input.toolName, input.toolInput)
      if (fingerprint === undefined) return
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
        agent: input.agent,
        metadata: { tool: input.toolName },
      })
    })

    return Service.of({ check })
  }),
)
