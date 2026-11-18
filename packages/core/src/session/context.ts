export * as SessionContext from "./context.js"

import { Model } from "../model.js"
import { Permission } from "../permission.js"
import { PermissionEffective } from "../permission/effective.js"
import { ProductModePolicy } from "../product-mode-policy.js"
import { Context, Effect, Layer, Option, Result, Schema } from "effect"
import { Agent } from "../agent.js"
import { MetaPrompt } from "../agent/meta/meta-prompt.js"
import { App } from "../app.js"
import { Composition } from "@aigcfroge/schema/composition"
import { CompositionConsumerView } from "../composition/consumer-view.js"
import { CompositionDigest } from "../composition/digest.js"
import { CodeModeInstructions } from "../codemode/instructions.js"
import { Database } from "../database/database.js"
import { makeLocationNode } from "@aigcfroge/util/effect/app-node"
import { InstructionDiscovery } from "../instruction-discovery.js"
import { Instructions } from "../instructions/index.js"
import { InstructionBuiltIns } from "../instructions/builtins.js"
import { Location } from "../location.js"
import { AssetPlacement } from "../asset-placement.js"
import { McpInstructions } from "../mcp/instructions.js"
import { McpConnection } from "../mcp/connection.js"
import { McpTool } from "../tool/mcp.js"
import { ReferenceInstructions } from "../reference/instructions.js"
import { SkillInstructions } from "../skill/instructions.js"
import { Skill } from "../skill.js"
import { CompositionCatalog } from "../skill/composition-catalog.js"
import { AgentPlugin } from "../plugin/agent.js"
import { Tool } from "../tool.js"
import { AgentNotFoundError, ControllerConflictError, SessionErrors } from "./error.js"
import { MetaAgentService } from "../meta-agent/service.js"
import { SessionHistory } from "./history.js"
import { SessionProviderContext } from "./provider-context.js"
import { InstructionEntry } from "./instruction-entry.js"
import { SessionMessage } from "./message.js"
import { SessionModelRequest } from "./model-request.js"
import { SessionRunnerModel } from "./runner/model.js"
import { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"
import { SessionComposition } from "./composition.js"
import type { ModelGroup } from "../model-group.js"

export type Error =
  | AgentNotFoundError
  | Agent.AgentNotAllowedError
  | ControllerConflictError
  | SessionComposition.Error
  | Composition.ResolveError
  | ProductModePolicy.UnsupportedProductModeError
  | SessionErrors.NotFoundError
  | Permission.BlockedError
  | AssetPlacement.TargetMismatchError

export interface Selection {
  readonly session: SessionSchema.Info
  readonly agent: Agent.Selection & { readonly info: Agent.Info }
  readonly instructions: Instructions.List
  readonly tools: Tool.Snapshot
  readonly groupBehavior?: ModelGroup.BehaviorSnapshot
}

export interface Loaded {
  readonly session: SessionSchema.Info
  readonly agent: Agent.Selection & { readonly info: Agent.Info }
  readonly model: SessionRunnerModel.Resolved
  readonly initial: string
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly tools: Tool.Snapshot
}

/**
 * Resolves model-request state in two phases: `select` fixes the Session,
 * agent, instruction sources, and tool snapshot; `load` adds the model and
 * active history for that selection. Auxiliary operations resolve only the
 * capabilities they need; request preparation stays separate from selection.
 */
export interface Interface {
  /** Selects the Session, agent, instructions, and tools used by subsequent work. */
  readonly select: (sessionID: SessionSchema.ID) => Effect.Effect<Selection, Error>
  /** Resolves the model and active history for that selection. */
  readonly load: (
    selection: Selection,
    binding?: SessionRunnerModel.Binding,
  ) => Effect.Effect<Loaded, SessionRunnerModel.Error | ProductModePolicy.UnsupportedProductModeError>
  readonly resolveModel: (
    session: SessionSchema.Info,
    options?: Omit<SessionRunnerModel.Options, "groupBehavior">,
  ) => Effect.Effect<
    SessionRunnerModel.Resolved,
    SessionRunnerModel.Error | SessionComposition.Error | ProductModePolicy.UnsupportedProductModeError
  >
  /** Selects auxiliary title capabilities without instruction or tool preflight. */
  readonly selectTitle: (session: SessionSchema.Info) => Effect.Effect<
    | {
        readonly agent: Agent.Info
        readonly primary: SessionRunnerModel.Resolved | undefined
        readonly selected: SessionRunnerModel.Resolved
      }
    | undefined
  >
  readonly request: SessionModelRequest.Interface
}

/** Location-scoped model-context loader for durable Session Steps. */
export class Service extends Context.Service<Service, Interface>()("@aigcfroge/SessionContext") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const app = yield* App.Metadata
    const compositions = yield* SessionComposition.Service
    const connections = yield* McpConnection.Service
    const builtins = yield* InstructionBuiltIns.Service
    const model = yield* Model.Service
    const db = (yield* Database.Service).db
    const discovery = yield* InstructionDiscovery.Service
    const entries = yield* InstructionEntry.Service
    const location = yield* Location.Service
    const skills = yield* Skill.Service
    const mcpInstructions = yield* McpInstructions.Service
    const mcpTools = yield* McpTool.Service
    const models = yield* SessionRunnerModel.Service
    const request = yield* SessionModelRequest.Service
    const referenceInstructions = yield* ReferenceInstructions.Service
    const skillInstructions = yield* SkillInstructions.Service
    const store = yield* SessionStore.Service
    const metas = yield* MetaAgentService.Service
    const registry = yield* Tool.Service
    const permission = yield* Permission.Service

    const groupBehaviorFor = Effect.fnUntraced(function* (
      session: SessionSchema.Info,
      frozen?: SessionComposition.Selection,
    ) {
      const selection = session.model ?? frozen?.info.model
      if (selection === undefined || !Model.Selection.isGroup(selection)) return undefined
      const binding =
        session.controller?.kind === "child"
          ? session.controller.executor.groupBehavior
          : frozen
            ? SessionComposition.groupBehaviorFor(frozen.snapshot, frozen.info.id)
            : undefined
      if (
        (frozen !== undefined || session.controller?.kind === "child") &&
        (binding === undefined || binding.groupID !== selection.groupID)
      )
        return yield* new SessionComposition.DependencyMissingError({
          sessionID: session.id,
          reason: "model_group_behavior_missing",
        })
      return binding
    })

    const resolveModel = Effect.fn("SessionContext.resolveModel")(function* (
      session: SessionSchema.Info,
      options?: Omit<SessionRunnerModel.Options, "groupBehavior">,
    ) {
      yield* ProductModePolicy.assertRuntimeSupported(session.mode)
      if (
        session.mode !== "custom" &&
        !(session.controller?.kind === "child" && session.controller.source.kind === "workflow")
      )
        return yield* models.resolve(session, model.available, {
          ...options,
          groupBehavior: yield* groupBehaviorFor(session),
        })
      const selection = yield* SessionComposition.selectSessionAgent(compositions, session)
      return yield* models.resolve({ ...session, model: session.model ?? selection.info.model }, model.available, {
        ...options,
        groupBehavior: yield* groupBehaviorFor(session, selection),
      })
    })

    const selectTitle = Effect.fn("SessionContext.selectTitle")(function* (session: SessionSchema.Info) {
      const agent = yield* agents.get(Agent.ID.make("title"))
      if (!agent) return
      const primary = yield* resolveModel(session).pipe(Effect.orElseSucceed(() => undefined))
      if (agent.model && Model.Selection.isGroup(agent.model)) {
        const selected = yield* models
          .resolve({ ...session, model: agent.model }, model.available)
          .pipe(Effect.orElseSucceed(() => undefined))
        return selected === undefined ? undefined : { agent, primary, selected }
      }
      const titleModel = agent.model && !Model.Selection.isGroup(agent.model) ? agent.model : undefined
      const info = yield* Effect.gen(function* () {
        if (titleModel) return yield* model.get(titleModel.providerID, titleModel.id)
        if (!primary) return
        return yield* model.small(primary.ref.providerID)
      })
      const variant =
        titleModel?.variant ?? MINIMAL_REASONING_VARIANTS.find((id) => info?.variants.some((item) => item.id === id))
      const preferred =
        info &&
        (yield* resolveModel({
          ...session,
          model: Model.Ref.make({
            providerID: info.providerID,
            id: info.id,
            ...(variant ? { variant } : {}),
          }),
        }).pipe(Effect.orElseSucceed(() => undefined)))
      const selected = preferred ?? primary
      if (!selected) return
      return { agent, primary, selected }
    })

    const select = Effect.fn("SessionContext.select")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(new Error(`Session not found: ${sessionID}`))
      yield* ProductModePolicy.assertRuntimeSupported(session.mode)
      yield* metas.assertOwner(session)
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt

      yield* mcpTools.flush
      const frozen =
        session.mode === "custom" ||
        (session.controller?.kind === "child" && session.controller.source.kind === "workflow")
          ? yield* SessionComposition.selectSessionAgent(compositions, session)
          : undefined
      const agent = frozen
        ? { id: frozen.info.id, info: frozen.info }
        : yield* agents.select(session.agent, session.mode)
      if (!agent.info) return yield* new AgentNotFoundError({ sessionID: session.id, agent: session.agent ?? agent.id })
      if (frozen === undefined) yield* Agent.assertOrdinaryMode(agent.info, session.mode)
      const coordination = yield* metas.coordination(sessionID, { agent: agent.info.id })
      const placement = location.workspaceID
        ? `${location.directory}#${location.workspaceID}`
        : String(location.directory)
      const parent =
        session.controller?.kind === "child" ? yield* store.get(session.controller.rootSessionID) : undefined
      const communication = parent ? yield* metas.coordination(parent.id, { tool: "share" }) : coordination
      const registered = yield* registry.list()
      const membership = (name: string) => frozen === undefined || frozen.snapshot.data.tools.catalog.includes(name)
      const include = (name: string) =>
        membership(name) &&
        (name !== "share" || communication.available) &&
        (session.controller?.kind !== "child" ||
          (name !== "task" &&
            name !== "subagent" &&
            !PermissionEffective.whollyDenied(
              parent?.permissions ?? [],
              registered.find((tool) => tool.id === name)?.options?.permission ?? name,
            )))
      const capture = frozen ? yield* registry.snapshot(undefined, membership) : undefined
      if (frozen && capture) {
        const validation = CompositionDigest.validateCurrentTools(
          frozen.snapshot.data.tools,
          capture.catalog,
          placement,
          app.version,
        )
        if (Result.isFailure(validation))
          return yield* new SessionComposition.DependencyMissingError({ sessionID, ...validation.failure })
        const facts = yield* connections.facts()
        for (const binding of frozen.snapshot.data.mcp.bindings) {
          const fact = facts.find((item) => item.serverName === binding.serverName)
          if (
            fact === undefined ||
            fact.ref.relativePath !== binding.ref.relativePath ||
            fact.ref.revision !== binding.ref.revision ||
            fact.transportFingerprint !== binding.transportFingerprint ||
            fact.credentialRef !== binding.credentialRef ||
            fact.health !== "ready" ||
            (fact.credentialStatus !== "available" && fact.credentialStatus !== "not-required")
          )
            return yield* new SessionComposition.DependencyMissingError({
              sessionID,
              reason: "mcp_runtime_binding_unavailable",
              details: `MCP binding '${binding.serverName}' is unavailable or has changed`,
            })
          const expected = frozen.snapshot.data.mcp.tools
            .filter((tool) => tool.serverName === binding.serverName)
            .map((tool) => tool.canonicalName)
            .toSorted()
          if (CompositionDigest.computeDigest(fact.tools.toSorted()) !== CompositionDigest.computeDigest(expected))
            return yield* new SessionComposition.DependencyMissingError({
              sessionID,
              reason: "mcp_runtime_tools_mismatch",
              details: `MCP tools for '${binding.serverName}' have changed`,
            })
        }
      }
      const permissions = (yield* permission.effectiveRules(session.id, agent.id)).concat(
        session.controller?.kind === "child" && PermissionEffective.whollyDenied(parent?.permissions ?? [], "execute")
          ? [{ action: "execute", resource: "*", effect: "deny" as const }]
          : [],
      )
      const frozenSkills =
        frozen === undefined
          ? undefined
          : CompositionCatalog.frozenSkills(
              location.directory,
              CompositionConsumerView.getSkills(frozen.snapshot, frozen.scope),
            )
      if (frozenSkills !== undefined && Result.isFailure(frozenSkills)) return yield* frozenSkills.failure
      const liveMeta = frozen === undefined && coordination.available && agent.info.system !== undefined
      const liveSkills = liveMeta ? yield* skills.list() : undefined
      const loaded = yield* Effect.all(
        {
          tools: registry.snapshot(permissions, include),
          builtins: builtins.load(),
          discovery: discovery.load(),
          skills: skillInstructions.load(permissions, frozenSkills === undefined ? liveSkills : frozenSkills.success),
          references: referenceInstructions.load(),
          mcp: frozen === undefined ? mcpInstructions.load(permissions) : Effect.succeed(Instructions.empty),
          entries: entries.load(sessionID),
        },
        { concurrency: "unbounded" },
      )
      if (frozen && capture) {
        if (capture.revision !== loaded.tools.revision)
          return yield* new SessionComposition.DependencyMissingError({
            sessionID,
            reason: "tool_runtime_revision_mismatch",
            details: "the tool registry changed while selecting the frozen request",
          })
        const validation = CompositionDigest.validateCurrentTools(
          frozen.snapshot.data.tools,
          loaded.tools.catalog,
          placement,
          app.version,
          false,
        )
        if (Result.isFailure(validation))
          return yield* new SessionComposition.DependencyMissingError({ sessionID, ...validation.failure })
      }
      const pool =
        coordination.available && agent.info.system !== undefined
          ? Agent.availableForDelegation(
              frozen === undefined
                ? yield* agents.list()
                : (frozen.snapshot.data.executors ?? []).map((executor) => executor.info),
              permissions,
              loaded.tools.catalog
                .filter((tool) => tool.name === "task" || tool.name === "subagent")
                .map((tool) => tool.name),
              session.mode,
            )
          : undefined
      // Definition inventories belong to on-demand discovery, not every request.
      const assets = liveMeta
        ? [
            ...(loaded.tools.catalog.some((tool) => tool.name === "list_assets")
              ? [
                  {
                    kind: "Asset catalogs",
                    name: "Use list_assets to discover asset definitions when the task needs them.",
                  },
                ]
              : []),
            ...(loaded.tools.catalog.some((tool) => tool.name === "skill")
              ? Skill.available(liveSkills ?? [], permissions).map((skill) => ({
                  kind: "Registered skills",
                  name: JSON.stringify({
                    id: skill.id,
                    name: skill.name,
                    description: skill.description,
                    autoinvoke: skill.autoinvoke,
                    path: skill.path,
                  }),
                }))
              : []),
          ]
        : []
      return {
        session,
        groupBehavior: yield* groupBehaviorFor(session, frozen),
        agent: {
          ...agent,
          info:
            pool !== undefined && agent.info.system !== undefined
              ? {
                  ...agent.info,
                  system:
                    frozen === undefined
                      ? AgentPlugin.renderMetaSystem(agent.info.system, pool, assets)
                      : MetaPrompt.fillAssetsList(
                          MetaPrompt.fillSubagentsList(
                            agent.info.system,
                            pool.map((target) => ({ id: target.id, description: target.description ?? "" })),
                            (frozen.snapshot.data.executors ?? [])
                              .filter((executor) => executor.info.mode !== "primary")
                              .map((executor) => ({
                                id: executor.info.id,
                                description: executor.info.description ?? "",
                              })),
                          ),
                          loaded.tools.catalog.some((tool) => tool.name === "skill")
                            ? Skill.available(frozenSkills?.success ?? [], permissions).map((skill) => ({
                                kind: "skill",
                                name: skill.name,
                              }))
                            : [],
                          frozenSkills?.success.map((skill) => skill.name),
                        ),
                }
              : agent.info,
        },
        // Ordered from most to least shared across sessions so the baseline stays a reusable
        // prompt-cache prefix: user-level catalog and guidance, then project instructions, then
        // the date and environment, which vary by day and directory.
        instructions: Instructions.combine([
          CodeModeInstructions.make(loaded.tools.codeModeCatalog),
          loaded.mcp,
          loaded.references,
          loaded.skills,
          frozen === undefined ? Instructions.empty : frozenInstructions(frozen),
          loaded.discovery,
          loaded.builtins,
          loaded.entries,
        ]),
        tools: coordination.available
          ? loaded.tools
          : {
              ...loaded.tools,
              definitions: loaded.tools.definitions.map((tool) => {
                if (tool.name !== "task") return tool
                const producer = loaded.tools.catalog.find((entry) => entry.name === tool.name)?.producer
                if (producer && producer.id !== "aigcfroge.tool.task") return tool
                const properties = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))(
                  tool.inputSchema.properties,
                )
                if (Option.isNone(properties)) return tool
                return {
                  ...tool,
                  inputSchema: {
                    ...tool.inputSchema,
                    properties: Object.fromEntries(
                      Object.entries(properties.value).filter(
                        ([name]) => !["target", "delivery", "resume"].includes(name),
                      ),
                    ),
                  },
                }
              }),
            },
      }
    })

    const load = Effect.fn("SessionContext.load")(function* (
      selection: Selection,
      binding?: SessionRunnerModel.Binding,
    ) {
      yield* ProductModePolicy.assertRuntimeSupported(selection.session.mode)
      const resolved = yield* models.resolve(
        {
          ...selection.session,
          agent: selection.agent.id,
          model:
            selection.session.model ??
            (selection.session.mode === "custom" ||
            (selection.session.controller?.kind === "child" && selection.session.controller.source.kind === "workflow")
              ? selection.agent.info.model
              : undefined),
        },
        model.available,
        { binding, groupBehavior: selection.groupBehavior },
      )
      const history = yield* SessionHistory.entriesForRunner(
        db,
        selection.session.id,
        selection.instructions,
        SessionProviderContext.provenance(resolved) ?? "local",
      )
      return {
        session: selection.session,
        agent: selection.agent,
        model: resolved,
        initial: history.initial,
        messages: history.entries.map((entry) => entry.message),
        tools: selection.tools,
      }
    })

    return Service.of({ select, load, resolveModel, selectTitle, request })
  }),
)

/** Variant IDs that minimize reasoning output, in preference order. */
const MINIMAL_REASONING_VARIANTS = ["none", "minimal", "low"].map((id) => Model.VariantID.make(id))

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Agent.node,
    App.node,
    Model.node,
    Database.node,
    MetaAgentService.node,
    InstructionBuiltIns.node,
    InstructionDiscovery.node,
    InstructionEntry.node,
    Location.node,
    Skill.node,
    McpInstructions.node,
    McpConnection.node,
    McpTool.node,
    ReferenceInstructions.node,
    SessionRunnerModel.node,
    SessionModelRequest.node,
    SessionStore.node,
    SessionComposition.node,
    SkillInstructions.node,
    Tool.node,
    Permission.node,
  ],
})

function frozenInstructions(selection: SessionComposition.Selection) {
  // The model request adds the selected Agent system separately. Preserve explicit
  // prompt copies while omitting that Agent's own system in current and historical values.
  const visible = (entries: ReadonlyArray<Composition.Instruction>) =>
    entries.filter((entry) => entry.source !== `agent:${selection.info.id}` || entry.content !== selection.info.system)
  const instructions = visible(CompositionConsumerView.getInstructions(selection.snapshot, selection.scope))
  const render = (entries: ReadonlyArray<Composition.Instruction>) => {
    const text = visible(entries)
      .map((entry) => entry.content)
      .join("\n\n")
    return text.length === 0 ? undefined : text
  }
  return Instructions.make({
    key: Instructions.Key.make("core/composition"),
    codec: Schema.toCodecJson(Schema.Array(Composition.Instruction)),
    read: Effect.succeed(instructions.length === 0 ? Instructions.removed : instructions),
    render: {
      initial: render,
      changed: (_previous, entries) => render(entries),
      removed: (previous) =>
        render(previous) === undefined ? undefined : "Composition instructions are no longer available.",
    },
  })
}
