export * as Agent from "./agent.js"

import { makeLocationNode } from "@omnixa/util/effect/app-node"
import { Array, Context, Effect, Layer, Option, Scope, Stream, Types } from "effect"
import { Agent } from "@omnixa/schema/agent"
import type { Permission } from "@omnixa/schema/permission"
import { ProductMode } from "@omnixa/schema/product-mode"
import { AgentFileLoader } from "./agent/file-loader.js"
import { AgentProtocol } from "./agent/protocol.js"
import { Bus } from "./bus.js"
import { Flag } from "./flag/flag.js"
import { PermissionEffective } from "./permission/effective.js"
import { Watcher } from "./filesystem/watcher.js"
import { State } from "./state.js"
import { AgentNotAllowedError } from "./product-mode-agent-policy.js"

export { AgentNotAllowedError } from "./product-mode-agent-policy.js"

export const ID = Agent.ID
export type ID = typeof ID.Type
export const Name = Agent.Name
export type Name = Agent.Name
export const defaultID = ID.make("build")

export const Color = Agent.Color

export const Info = Agent.Info
export type Info = Agent.Info

export { Event } from "@omnixa/schema/agent"

export interface Selection {
  readonly id: ID
  readonly info: Info | undefined
}

type Data = {
  agents: Map<ID, Types.DeepMutable<Info>>
  default?: ID
}

export type Editor = {
  list: () => readonly Info[]
  get: (id: ID) => Info | undefined
  default: (id: ID | undefined) => void
  update: (id: ID, fn: (agent: Types.DeepMutable<Info>) => void) => void
  remove: (id: ID) => void
}

export interface Interface extends State.Transformable<Editor> {
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  readonly resolve: (id?: ID | string, mode?: ProductMode.ID) => Effect.Effect<Info | undefined>
  readonly select: (id?: ID | string, mode?: ProductMode.ID) => Effect.Effect<Selection>
  readonly list: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@omnixa/Agent") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const state = State.create<Data, Editor>({
      name: "agent",
      initial: () => ({ agents: new Map() }),
      editor: (editor) => ({
        list: () => Array.fromIterable(editor.agents.values()) as Info[],
        get: (id) => editor.agents.get(id),
        default: (id) => {
          editor.default = id
        },
        update: (id, fn) => {
          const current = editor.agents.get(id) ?? (Info.default(id) as Types.DeepMutable<Info>)
          if (!editor.agents.has(id)) {
            current.originKind = "user"
            editor.agents.set(id, current)
          }
          fn(current)
          current.id = id
          if (current.card !== undefined)
            Object.assign(current, { card: AgentProtocol.normalizeDefinition({ card: current.card }).card })
        },
        remove: (id) => {
          editor.agents.delete(id)
        },
      }),
      notify: () => bus.publish(Agent.Event.Updated, {}).pipe(Effect.asVoid),
    })
    const selectable = (agent: Info | undefined, mode?: ProductMode.ID) =>
      agent && agent.mode !== "subagent" && !agent.hidden && (mode === undefined || ordinaryModes(agent).includes(mode))
        ? agent
        : undefined
    const selectedDefault = (mode?: ProductMode.ID) => {
      const data = state.get()
      const configured = data.default ? selectable(data.agents.get(data.default), mode) : undefined
      if (configured) return configured
      const build = selectable(data.agents.get(ID.make("build")), mode)
      if (build) return build
      for (const agent of data.agents.values()) {
        const fallback = selectable(agent, mode)
        if (fallback) return fallback
      }
    }

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      get: Effect.fn("Agent.get")(function* (id) {
        return state.get().agents.get(id)
      }),
      resolve: Effect.fnUntraced(function* (id, mode) {
        if (id !== undefined) return state.get().agents.get(ID.make(id))
        return selectedDefault(mode)
      }),
      select: Effect.fn("Agent.select")(function* (id, mode) {
        if (id !== undefined) {
          const selected = ID.make(id)
          return { id: selected, info: state.get().agents.get(selected) }
        }
        const info = selectedDefault(mode)
        return { id: info?.id ?? defaultID, info }
      }),
      list: Effect.fn("Agent.list")(function* () {
        const agents = Array.fromIterable(state.get().agents.values())
        const selected = selectedDefault()
        if (!selected) return agents
        return [selected, ...agents.filter((agent) => agent.id !== selected.id)]
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Bus.node] })

export function availableForDelegation(
  pool: ReadonlyArray<Info>,
  rules: Permission.Ruleset,
  actions: ReadonlyArray<string>,
  mode?: ProductMode.ID,
) {
  return pool.filter(
    (agent) =>
      agent.mode !== "primary" &&
      !agent.hidden &&
      (mode === undefined || ordinaryModes(agent).includes(mode)) &&
      actions.some((action) => PermissionEffective.evaluate(rules, action, agent.id) !== "deny"),
  )
}

export function ordinaryModes(agent: Pick<Info, "originKind">) {
  return ProductMode.ID.literals.filter((mode) => mode === "custom" || agent.originKind !== "user")
}

export const assertOrdinaryMode = Effect.fn("Agent.assertOrdinaryMode")(function* (agent: Info, mode: ProductMode.ID) {
  if (ordinaryModes(agent).includes(mode)) return
  return yield* new AgentNotAllowedError({
    mode,
    agent: agent.id,
    reason: "User-defined agents require an adopted Custom composition",
  })
})

const registerFileAgentTransform = (agents: Interface): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const fileLoader = Option.getOrUndefined(yield* Effect.serviceOption(AgentFileLoader.Service))
    if (!fileLoader) return
    yield* agents.transform((draft) => {
      if (!Flag.OMNIXA_ENABLE_AGENT_FILE) return
      // Base State transforms are synchronous; the loader's list is an in-memory
      // snapshot over already-parsed files, so runSync keeps rebuild semantics.
      const fileAgents = Effect.runSync(fileLoader.loadAll())
      for (const fileAgent of fileAgents) {
        draft.update(fileAgent.info.id, (item) => {
          Object.assign(item, fileAgent.info)
          item.originKind = "user"
        })
      }
    })
  })

const subscribeToFileWatcher = Effect.fn("Agent.subscribeToFileWatcher")(function* (
  agents: Interface,
  scope: Scope.Scope,
) {
  const events = yield* Bus.Service
  yield* events.subscribe(Watcher.Event.Updated).pipe(
    Stream.filter(
      (event) => event.data.event === "add" || event.data.event === "change" || event.data.event === "unlink",
    ),
    Stream.filter((event) => event.data.file.endsWith(".agent.md")),
    Stream.runForEach(() => agents.reload()),
    Effect.forkIn(scope),
  )
})

/** Adds file-agent transform registration and `.agent.md` watcher refresh on top of the base layer. */
export const fileLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agents = yield* Service
    if (Flag.OMNIXA_ENABLE_AGENT_FILE) {
      yield* registerFileAgentTransform(agents)
      const scope = yield* Scope.Scope
      yield* subscribeToFileWatcher(agents, scope)
    }
    return agents
  }),
).pipe(Layer.provide(layer))
