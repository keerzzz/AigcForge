export * as AgentV2 from "./agent"

import { Array, Context, Effect, Layer, Option, Scope, Stream, Types } from "effect"
import { Agent } from "@aigcfroge/schema/agent"
import { State } from "./state"
import { AgentFileLoader } from "./agent/file-loader"
import { EventV2 } from "./event"
import { Flag } from "./flag/flag"
import { Watcher } from "./filesystem/watcher"

export const ID = Agent.ID
export type ID = typeof ID.Type
export const defaultID = ID.make("build")

export const Color = Agent.Color

export const Info = Agent.Info
export type Info = Agent.Info

export interface Selection {
  readonly id: ID
  readonly info: Info | undefined
}

type Data = {
  agents: Map<ID, Types.DeepMutable<Info>>
  default?: ID
}

export type Draft = {
  list: () => readonly Info[]
  get: (id: ID) => Info | undefined
  default: (id: ID | undefined) => void
  update: (id: ID, fn: (agent: Types.DeepMutable<Info>) => void) => void
  remove: (id: ID) => void
}

export interface Interface extends State.Transformable<Draft> {
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  readonly default: () => Effect.Effect<Info | undefined>
  readonly resolve: (id?: ID | string) => Effect.Effect<Info | undefined>
  readonly select: (id?: ID | string) => Effect.Effect<Selection>
  readonly all: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/Agent") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = State.create<Data, Draft>({
      initial: () => ({ agents: new Map() }),
      draft: (draft) => ({
        list: () => Array.fromIterable(draft.agents.values()) as Info[],
        get: (id) => draft.agents.get(id),
        default: (id) => {
          draft.default = id
        },
        update: (id, fn) => {
          const current = draft.agents.get(id) ?? (Info.empty(id) as Types.DeepMutable<Info>)
          if (!draft.agents.has(id)) draft.agents.set(id, current)
          fn(current)
          current.id = id
        },
        remove: (id) => {
          draft.agents.delete(id)
        },
      }),
    })
    const selectable = (agent: Info | undefined) =>
      agent && agent.mode !== "subagent" && !agent.hidden ? agent : undefined
    const metaDisabled = typeof process !== "undefined" && process.env?.AIGCFROGE_DISABLE_META_AGENT === "true"
    const selectedDefault = () => {
      const data = state.get()
      const configured = data.default ? selectable(data.agents.get(data.default)) : undefined
      if (configured) return configured
      if (!metaDisabled) {
        const metaAgent = selectable(data.agents.get(ID.make("meta")))
        if (metaAgent) return metaAgent
      }
      const build = selectable(data.agents.get(ID.make("build")))
      if (build) return build
      for (const agent of data.agents.values()) {
        const fallback = selectable(agent)
        if (fallback) return fallback
      }
      return undefined
    }

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      get: Effect.fn("AgentV2.get")(function* (id) {
        return state.get().agents.get(id)
      }),
      default: Effect.fn("AgentV2.default")(function* () {
        return selectedDefault()
      }),
      resolve: Effect.fn("AgentV2.resolve")(function* (id) {
        if (id !== undefined) return state.get().agents.get(ID.make(id))
        return selectedDefault()
      }),
      select: Effect.fn("AgentV2.select")(function* (id) {
        if (id !== undefined) {
          const selected = ID.make(id)
          return { id: selected, info: state.get().agents.get(selected) }
        }
        const info = selectedDefault()
        return { id: info?.id ?? defaultID, info }
      }),
      all: Effect.fn("AgentV2.all")(function* () {
        return Array.fromIterable(state.get().agents.values())
      }),
    })
  }),
)

export const locationLayer = layer

const registerFileAgentTransform = (agents: Interface): Effect.Effect<void, never, Scope.Scope> =>
  agents.transform((draft) =>
    Effect.gen(function* () {
      if (!Flag.AIGCFROGE_ENABLE_AGENT_FILE) return
      const fileLoader = yield* Effect.serviceOption(AgentFileLoader.Service).pipe(
        Effect.map(Option.getOrUndefined),
      )
      if (!fileLoader) return
      const fileAgents = yield* fileLoader.loadAll()
      for (const fa of fileAgents) {
        draft.update(fa.info.id, (item) => {
          Object.assign(item, fa.info)
        })
      }
    }),
  ).pipe(Effect.asVoid)

const subscribeToFileWatcher = Effect.fn("AgentV2.subscribeToFileWatcher")(function* (
  agents: Interface,
  scope: Scope.Scope,
) {
  const events = yield* EventV2.Service
  yield* events
    .subscribe(Watcher.Event.Updated)
    .pipe(
      Stream.filter((event) => event.data.event === "add" || event.data.event === "change" || event.data.event === "unlink"),
      Stream.filter((event) => event.data.file.endsWith(".agent.md")),
      Stream.runForEach(() => agents.reload()),
      Effect.forkIn(scope),
    )
})

export const fileLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agents = yield* Service
    if (Flag.AIGCFROGE_ENABLE_AGENT_FILE) {
      yield* registerFileAgentTransform(agents)
      const scope = yield* Scope.Scope
      yield* subscribeToFileWatcher(agents, scope)
    }
    return agents
  }),
).pipe(Layer.provide(layer))
