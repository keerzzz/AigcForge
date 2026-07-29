import { Config, ConfigProvider, Context, Effect, Layer, Option } from "effect"
import { ConfigService } from "@/effect/config-service"

const bool = (name: string) => Config.boolean(name).pipe(Config.withDefault(false))
const positiveInteger = (name: string) =>
  Config.number(name).pipe(
    Config.map((value) => (Number.isInteger(value) && value > 0 ? value : undefined)),
    Config.orElse(() => Config.succeed(undefined)),
  )
const experimental = bool("AIGCFROGE_EXPERIMENTAL")
const enabledByExperimental = (name: string) =>
  Config.all({ experimental, enabled: Config.boolean(name).pipe(Config.option) }).pipe(
    Config.map((flags) => Option.getOrElse(flags.enabled, () => flags.experimental)),
  )

export class Service extends ConfigService.Service<Service>()("@aigcfroge/RuntimeFlags", {
  autoShare: bool("AIGCFROGE_AUTO_SHARE"),
  pure: bool("AIGCFROGE_PURE"),
  disableDefaultPlugins: bool("AIGCFROGE_DISABLE_DEFAULT_PLUGINS"),
  disableEmbeddedWebUi: bool("AIGCFROGE_DISABLE_EMBEDDED_WEB_UI"),
  disableExternalSkills: bool("AIGCFROGE_DISABLE_EXTERNAL_SKILLS"),
  disableLspDownload: bool("AIGCFROGE_DISABLE_LSP_DOWNLOAD"),
  disableClaudeCodePrompt: Config.all({
    broad: bool("AIGCFROGE_DISABLE_CLAUDE_CODE"),
    direct: bool("AIGCFROGE_DISABLE_CLAUDE_CODE_PROMPT"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  disableClaudeCodeSkills: Config.all({
    broad: bool("AIGCFROGE_DISABLE_CLAUDE_CODE"),
    direct: bool("AIGCFROGE_DISABLE_CLAUDE_CODE_SKILLS"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  enableExa: Config.all({
    experimental,
    enabled: bool("AIGCFROGE_ENABLE_EXA"),
    legacy: bool("AIGCFROGE_EXPERIMENTAL_EXA"),
  }).pipe(Config.map((flags) => flags.experimental || flags.enabled || flags.legacy)),
  enableParallel: Config.all({
    enabled: bool("AIGCFROGE_ENABLE_PARALLEL"),
    legacy: bool("AIGCFROGE_EXPERIMENTAL_PARALLEL"),
  }).pipe(Config.map((flags) => flags.enabled || flags.legacy)),
  enableExperimentalModels: bool("AIGCFROGE_ENABLE_EXPERIMENTAL_MODELS"),
  enableQuestionTool: bool("AIGCFROGE_ENABLE_QUESTION_TOOL"),
  experimentalReferences: enabledByExperimental("AIGCFROGE_EXPERIMENTAL_REFERENCES"),
  experimentalBackgroundSubagents: enabledByExperimental("AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS"),
  experimentalChatAsset: Config.all({
    experimental,
    enabled: Config.boolean("AIGCFROGE_EXPERIMENTAL_CHAT_ASSET").pipe(Config.option),
    legacy: Config.boolean("AIGCFROGE_EXPERIMENTAL_CHAT_PROMPT_ASSET").pipe(Config.option),
  }).pipe(
    Config.map((flags) =>
      Option.getOrElse(flags.enabled, () => Option.getOrElse(flags.legacy, () => flags.experimental || true)),
    ),
  ),
  experimentalLspTy: bool("AIGCFROGE_EXPERIMENTAL_LSP_TY"),
  experimentalLspTool: enabledByExperimental("AIGCFROGE_EXPERIMENTAL_LSP_TOOL"),
  experimentalOxfmt: enabledByExperimental("AIGCFROGE_EXPERIMENTAL_OXFMT"),
  experimentalPlanMode: enabledByExperimental("AIGCFROGE_EXPERIMENTAL_PLAN_MODE"),
  experimentalEventSystem: enabledByExperimental("AIGCFROGE_EXPERIMENTAL_EVENT_SYSTEM"),
  experimentalWorkspaces: enabledByExperimental("AIGCFROGE_EXPERIMENTAL_WORKSPACES"),
  experimentalIconDiscovery: enabledByExperimental("AIGCFROGE_EXPERIMENTAL_ICON_DISCOVERY"),
  outputTokenMax: positiveInteger("AIGCFROGE_EXPERIMENTAL_OUTPUT_TOKEN_MAX"),
  bashDefaultTimeoutMs: positiveInteger("AIGCFROGE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
  experimentalNativeLlm: bool("AIGCFROGE_EXPERIMENTAL_NATIVE_LLM"),
  experimentalWebSockets: bool("AIGCFROGE_EXPERIMENTAL_WEBSOCKETS"),
  client: Config.string("AIGCFROGE_CLIENT").pipe(Config.withDefault("cli")),
}) {}

export type Info = Context.Service.Shape<typeof Service>

const emptyConfigLayer = Service.defaultLayer.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
  Layer.orDie,
)

export const layer = (overrides: Partial<Info> = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const flags = yield* Service
      return Service.of({ ...flags, ...overrides })
    }),
  ).pipe(Layer.provide(emptyConfigLayer))

export const defaultLayer = Service.defaultLayer.pipe(Layer.orDie)

export const node = LayerNode.make(defaultLayer, [])

export * as RuntimeFlags from "./runtime-flags"
import { LayerNode } from "@aigcfroge/core/effect/layer-node"
