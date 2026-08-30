import { LayerNode } from "@aigcfroge/core/effect/layer-node"
import { PermissionV1 } from "@aigcfroge/core/v1/permission"
import { Config } from "@/config/config"
import { serviceUse } from "@aigcfroge/core/effect/service-use"
import { Provider } from "@/provider/provider"

import { generateObject, streamObject, type ModelMessage } from "ai"
import { Truncate } from "@/tool/truncate"
import { Auth } from "../auth"
import { ProviderTransform } from "@/provider/transform"

import PROMPT_GENERATE from "./generate.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import { MetaAgent } from "./meta-agent"
import { CliAdapterRegistry } from "@/agent/meta/adapters/registry"
import { Permission } from "@/permission"
import { mergeDeep, pipe, sortBy } from "remeda"
import { Global } from "@aigcfroge/core/global"
import path from "path"
import { Plugin } from "@/plugin"
import { Skill } from "../skill"
import { Effect, Context, Layer, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import * as Option from "effect/Option"
import * as OtelTracer from "@effect/opentelemetry/Tracer"
import { AbsolutePath, type DeepMutable } from "@aigcfroge/core/schema"
import { ProviderV2 } from "@aigcfroge/core/provider"
import { ModelV2 } from "@aigcfroge/core/model"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { Reference } from "@aigcfroge/core/reference"
import { Location } from "@aigcfroge/core/location"
import { PluginV2 } from "@aigcfroge/core/plugin"
import { MetaPrompt } from "@aigcfroge/core/agent/meta/meta-prompt"
import { Handoff } from "@aigcfroge/schema/handoff"
import { ChatOrchestratorPrompt } from "@aigcfroge/core/agent/prompt/chat-orchestrator"
import { WorkOrchestratorPrompt } from "@aigcfroge/core/agent/prompt/work-orchestrator"
import { scanAssets } from "./meta/assets-loader"

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  source: Schema.optional(Schema.Literals(["native", "external-cli"])),
  native: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
  topP: Schema.optional(Schema.Finite),
  temperature: Schema.optional(Schema.Finite),
  color: Schema.optional(Schema.String),
  permission: PermissionV1.Ruleset,
  model: Schema.optional(
    Schema.Struct({
      modelID: ModelV2.ID,
      providerID: ProviderV2.ID,
    }),
  ),
  variant: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Unknown),
  steps: Schema.optional(Schema.Finite),
  handoffs: Schema.optional(Schema.mutable(Schema.Array(Handoff))),
}).annotate({ identifier: "Agent" })
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>

const GeneratedAgent = Schema.Struct({
  identifier: Schema.String,
  whenToUse: Schema.String,
  systemPrompt: Schema.String,
})

export interface Interface {
  readonly get: (agent: string) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Info[]>
  readonly defaultInfo: () => Effect.Effect<Info>
  readonly defaultAgent: () => Effect.Effect<string>
  readonly generate: (input: {
    description: string
    model?: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
  }) => Effect.Effect<
    {
      identifier: string
      whenToUse: string
      systemPrompt: string
    },
    Provider.DefaultModelError
  >
}

type State = Omit<Interface, "generate">

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/Agent") {}

export const use = serviceUse(Service)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const auth = yield* Auth.Service
    const plugin = yield* Plugin.Service
    const skill = yield* Skill.Service
    const provider = yield* Provider.Service
    const locations = yield* LocationServiceMap
    const cliAdapterRegistry = yield* CliAdapterRegistry.AdapterRegistry

    const state = yield* InstanceState.make<State>(
      Effect.fn("Agent.state")(function* (ctx) {
        const cfg = yield* config.get()
        const skillDirs = yield* skill.dirs()
        const referenceDirs = Object.keys(cfg.references ?? cfg.reference ?? {}).length
          ? yield* Effect.gen(function* () {
              yield* (yield* PluginV2.Service).wait(PluginV2.ID.make("core/config-reference"))
              return (yield* (yield* Reference.Service).list()).map((reference) => reference.path)
            }).pipe(Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx.directory) }))))
          : []
        const whitelistedDirs = [
          Truncate.GLOB,
          path.join(Global.Path.tmp, "*"),
          ...skillDirs.map((dir) => path.join(dir, "*")),
          ...referenceDirs.map((dir) => path.join(dir, "*")),
        ]
        const readonlyExternalDirectory = {
          "*": "ask",
          ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
        } satisfies Record<string, "allow" | "ask" | "deny">

        const defaults = Permission.fromConfig({
          "*": "allow",
          doom_loop: "ask",
          external_directory: {
            "*": "ask",
            ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
          },
          question: "deny",
          plan_enter: "deny",
          plan_exit: "deny",
          // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
          read: {
            "*": "allow",
            "*.env": "ask",
            "*.env.*": "ask",
            "*.env.example": "allow",
          },
        })

        const user = Permission.fromConfig(cfg.permission ?? {})

        const buildDefaults = Permission.merge(
          defaults,
          Permission.fromConfig({
            question: "allow",
            plan_enter: "allow",
          }),
        )

        // meta 专属 deny-first 基线（V1/V2 同构，见 core plugin/agent.ts metaDefaults）：
        // 未知 action 默认 deny，不产生 wildcard allow；read/propose/领域工具显式白名单。
        const metaDefaults = Permission.merge(
          Permission.fromConfig({
            "*": "deny",
            doom_loop: "ask",
            external_directory: {
              "*": "ask",
              ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
            },
            // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
            read: {
              "*": "allow",
              "*.env": "ask",
              "*.env.*": "ask",
              "*.env.example": "allow",
            },
            glob: "allow",
            grep: "allow",
            webfetch: "allow",
            websearch: "allow",
            question: "allow",
            list_assets: "allow",
            plan_enter: "allow",
            // 资产落盘通道（propose → 用户确认 → 受校验的 apply/delete 事务）。
            propose_prompt_asset: "allow",
            propose_skill_asset: "allow",
            propose_mcp_asset: "allow",
            propose_command_asset: "allow",
            propose_agent_asset: "allow",
            propose_workflow_asset: "allow",
            propose_plugin_asset: "allow",
            // meta 是非 coding 模式的 build 等价体（用户 2026-08-15 裁决）：
            // bash/edit/write 与 build 对齐可用，但危险操作走 ask 审批，
            // 非静默 allow 也非 deny（ADR-13 Amendment-2 §1c）。
            bash: "ask",
            edit: "ask",
            write: "ask",
            task: "allow",
          }),
        )

        // Fill {{CLI_LIST}} and {{ASSETS_LIST}} in the meta agent prompt
        const cliAdapters = yield* cliAdapterRegistry.available()
        const cliNames = cliAdapters.map((a) => a.name)
        let assets: readonly { kind: string; name: string }[] = []
        try {
          assets = yield* Effect.promise(() => scanAssets(ctx.directory))
        } catch {
          // Silently fall back to empty list
        }
        const metaPrompt = MetaAgent.prompt.includes("{{ASSETS_LIST}}")
          ? MetaPrompt.fillAssetsList(MetaPrompt.fillCliList(MetaAgent.prompt, cliNames), assets)
          : MetaPrompt.fillCliList(MetaAgent.prompt, cliNames)

        const agents: Record<string, Info> = {
          "chat-orchestrator": {
            name: "chat-orchestrator",
            description: "Chat mode agent. Orchestrates chat asset creation in chat mode.",
            options: {},
            permission: Permission.fromConfig({
              "*": "deny",
              read: "allow",
              glob: "allow",
              grep: "allow",
              question: "allow",
              propose_prompt_asset: "allow",
              propose_skill_asset: "allow",
              propose_mcp_asset: "allow",
              propose_command_asset: "allow",
              propose_agent_asset: "allow",
              propose_workflow_asset: "allow",
              propose_plugin_asset: "allow",
            }),
            mode: "primary",
            native: true,
            prompt: ChatOrchestratorPrompt.SYSTEM_PROMPT,
          },
          "work-orchestrator": {
            name: "work-orchestrator",
            description: "Work mode agent. Orchestrates preset-driven document drafting in work mode.",
            options: {},
            permission: Permission.fromConfig({
              "*": "deny",
              read: {
                "*": "allow",
                // read * allow 会覆盖 defaults 的 .env ask，须以后序规则恢复（last-match-wins）
                "*.env": "ask",
                "*.env.*": "ask",
                "*.env.example": "allow",
              },
              glob: "allow",
              grep: "allow",
              question: "allow",
              "work-preset": "allow",
            }),
            mode: "primary",
            native: true,
            prompt: WorkOrchestratorPrompt.SYSTEM_PROMPT,
          },
          build: {
            name: "build",
            description: "The default agent. Executes tools based on configured permissions.",
            options: {},
            permission: Permission.merge(buildDefaults, user),
            mode: "primary",
            native: true,
          },
          meta: {
            name: "meta",
            description: MetaAgent.description,
            permission: Permission.merge(metaDefaults, user),
            mode: MetaAgent.mode,
            native: true,
            options: MetaAgent.options ?? {},
            prompt: metaPrompt,
          },
          plan: {
            name: "plan",
            description: "Plan mode. Disallows all edit tools.",
            options: {},
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                plan_exit: "allow",
                task: {
                  general: "deny",
                },
                external_directory: {
                  [path.join(Global.Path.data, "plans", "*")]: "allow",
                },
                edit: {
                  "*": "deny",
                  [path.join(".aigcfroge", "plans", "*.md")]: "allow",
                  [path.relative(ctx.worktree, path.join(Global.Path.data, path.join("plans", "*.md")))]: "allow",
                },
              }),
              user,
            ),
            mode: "primary",
            native: true,
          },
          general: {
            name: "general",
            description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                todowrite: "deny",
                task_schedule: "deny",
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
          },
          explore: {
            name: "explore",
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                grep: "allow",
                glob: "allow",
                list: "allow",
                bash: "allow",
                webfetch: "allow",
                websearch: "allow",
                read: "allow",
                external_directory: readonlyExternalDirectory,
              }),
              user,
            ),
            description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
            prompt: PROMPT_EXPLORE,
            options: {},
            mode: "subagent",
            native: true,
          },
          compaction: {
            name: "compaction",
            mode: "primary",
            native: true,
            hidden: true,
            prompt: PROMPT_COMPACTION,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            options: {},
          },
          title: {
            name: "title",
            mode: "primary",
            options: {},
            native: true,
            hidden: true,
            temperature: 0.5,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            prompt: PROMPT_TITLE,
          },
          summary: {
            name: "summary",
            mode: "primary",
            options: {},
            native: true,
            hidden: true,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            prompt: PROMPT_SUMMARY,
          },
        }

        for (const [key, value] of Object.entries(cfg.agent ?? {})) {
          if (value.disable) {
            delete agents[key]
            continue
          }
          let item = agents[key]
          if (!item)
            item = agents[key] = {
              name: key,
              mode: "all",
              permission: Permission.merge(defaults, user),
              options: {},
              native: false,
            }
          if (value.model) item.model = Provider.parseModel(value.model)
          item.variant = value.variant ?? item.variant
          item.prompt = value.prompt ?? item.prompt
          item.description = value.description ?? item.description
          item.temperature = value.temperature ?? item.temperature
          item.topP = value.top_p ?? item.topP
          item.mode = value.mode ?? item.mode
          item.color = value.color ?? item.color
          item.hidden = value.hidden ?? item.hidden
          item.name = value.name ?? item.name
          item.steps = value.steps ?? item.steps
          item.options = mergeDeep(item.options, value.options ?? {})
          item.permission = Permission.merge(item.permission, Permission.fromConfig(value.permission ?? {}))
          if (value.handoffs) item.handoffs = [...(item.handoffs ?? []), ...value.handoffs]
        }

        // Ensure Truncate.GLOB is allowed unless explicitly configured
        for (const name in agents) {
          const agent = agents[name]
          const explicit = agent.permission.some((r) => {
            if (r.permission !== "external_directory") return false
            if (r.action !== "deny") return false
            return r.pattern === Truncate.GLOB
          })
          if (explicit) continue

          agents[name].permission = Permission.merge(
            agents[name].permission,
            Permission.fromConfig({ external_directory: { [Truncate.GLOB]: "allow" } }),
          )
        }

        const get = Effect.fnUntraced(function* (agent: string) {
          return agents[agent]
        })

        const list = Effect.fnUntraced(function* () {
          const cfg = yield* config.get()
          const cliAdapters = yield* cliAdapterRegistry.available()
          const cliAgents = cliAdapters.map((adapter) => ({
            name: adapter.name,
            description: adapter.description,
            mode: "subagent" as const,
            source: "external-cli" as const,
            native: false,
            hidden: false,
            permission: [],
            options: {},
          }))

          return pipe(
            [...Object.values(agents), ...cliAgents],
            sortBy(
              [
                (x) =>
                  cfg.default_agent
                    ? x.name === cfg.default_agent
                    : process.env.AIGCFROGE_DISABLE_META_AGENT === "true"
                      ? x.name === "build"
                      : x.name === "meta",
                "desc",
              ],
              [(x) => x.name, "asc"],
            ),
          )
        })

        const defaultInfo = Effect.fnUntraced(function* () {
          if (process.env.AIGCFROGE_DISABLE_META_AGENT === "true") {
            const fallback = agents["build"]?.hidden
              ? Object.values(agents).find((a) => a.mode !== "subagent" && a.hidden !== true)
              : agents["build"]
            if (!fallback) throw new Error("no primary visible agent found")
            return fallback
          }
          const c = yield* config.get()
          if (c.default_agent) {
            const agent = agents[c.default_agent]
            if (!agent) throw new Error(`default agent "${c.default_agent}" not found`)
            if (agent.mode === "subagent") throw new Error(`default agent "${c.default_agent}" is a subagent`)
            if (agent.hidden === true) throw new Error(`default agent "${c.default_agent}" is hidden`)
            return agent
          }
          const metaAgent = agents["meta"]
          const visible = !metaAgent?.hidden ? metaAgent : agents["build"]?.hidden ? undefined : agents["build"]
          if (!visible) {
            const fallback = Object.values(agents).find((a) => a.mode !== "subagent" && a.hidden !== true)
            if (!fallback) throw new Error("no primary visible agent found")
            return fallback
          }
          return visible
        })

        const defaultAgent = Effect.fnUntraced(function* () {
          return (yield* defaultInfo()).name
        })

        return {
          get,
          list,
          defaultInfo,
          defaultAgent,
        } satisfies State
      }),
    )

    return Service.of({
      get: Effect.fn("Agent.get")(function* (agent: string) {
        return yield* InstanceState.useEffect(state, (s) => s.get(agent))
      }),
      list: Effect.fn("Agent.list")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.list())
      }),
      defaultInfo: Effect.fn("Agent.defaultInfo")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.defaultInfo())
      }),
      defaultAgent: Effect.fn("Agent.defaultAgent")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.defaultAgent())
      }),
      generate: Effect.fn("Agent.generate")(function* (input: {
        description: string
        model?: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
      }) {
        const cfg = yield* config.get()
        const model = input.model ?? (yield* provider.defaultModel())
        const resolved = yield* provider.getModel(model.providerID, model.modelID)
        const language = yield* provider.getLanguage(resolved)
        const tracer = cfg.experimental?.openTelemetry
          ? Option.getOrUndefined(yield* Effect.serviceOption(OtelTracer.OtelTracer))
          : undefined

        const system = [PROMPT_GENERATE]
        yield* plugin.trigger("experimental.chat.system.transform", { model: resolved }, { system })
        const existing = yield* InstanceState.useEffect(state, (s) => s.list())

        // TODO: clean this up so provider specific logic doesnt bleed over
        const authInfo = yield* auth.get(model.providerID).pipe(Effect.orDie)
        const isOpenaiOauth = model.providerID === "openai" && authInfo?.type === "oauth"

        const params = {
          experimental_telemetry: {
            isEnabled: cfg.experimental?.openTelemetry,
            tracer,
            metadata: {
              userId: cfg.username ?? "unknown",
            },
          },
          temperature: 0.3,
          messages: [
            ...(isOpenaiOauth
              ? []
              : system.map(
                  (item): ModelMessage => ({
                    role: "system",
                    content: item,
                  }),
                )),
            {
              role: "user",
              content: `Create an agent configuration based on this request: "${input.description}".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
            },
          ],
          model: language,
          schema: Object.assign(
            Schema.toStandardSchemaV1(GeneratedAgent),
            Schema.toStandardJSONSchemaV1(GeneratedAgent),
          ),
        } satisfies Parameters<typeof generateObject>[0]

        if (isOpenaiOauth) {
          return yield* Effect.promise(async () => {
            const result = streamObject({
              ...params,
              providerOptions: ProviderTransform.providerOptions(resolved, {
                instructions: system.join("\n"),
                store: false,
              }),
              onError: () => {},
            })
            for await (const part of result.fullStream) {
              if (part.type === "error") throw part.error
            }
            return result.object
          })
        }

        return yield* Effect.promise(() => generateObject(params).then((r) => r.object))
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Plugin.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Skill.defaultLayer),
  Layer.provide(LocationServiceMap.layer),
  Layer.provide(CliAdapterRegistry.defaultLayer),
)

const locationServiceMapNode = LayerNode.make(LocationServiceMap.layer, [])

export const node = LayerNode.make(layer, [
  Config.node,
  Auth.node,
  Plugin.node,
  Skill.node,
  Provider.node,
  locationServiceMapNode,
  CliAdapterRegistry.node,
])

export * as Agent from "./agent"
