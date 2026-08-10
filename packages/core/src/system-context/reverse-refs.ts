export * as ReverseRefs from "./reverse-refs"

import { Context, Effect, Option, Schema } from "effect"
import { Config } from "../config"
import { Verifier } from "../session/verifier"
import { SystemContext } from "./index"

const DEFAULT_ENABLED = false

type Settings = {
  readonly enabled: boolean
}

const settings = (documents: readonly Config.Entry[]) => {
  const configured = documents
    .filter((entry): entry is Config.Document => entry.type === "document")
    .flatMap((entry) => (entry.info.meta?.reverse_refs ? [entry.info.meta.reverse_refs] : []))
  return configured.reduce<Settings>(
    (result, current) => ({ enabled: current.enabled ?? result.enabled }),
    { enabled: DEFAULT_ENABLED },
  )
}

export class CodegraphError extends Schema.TaggedErrorClass<CodegraphError>()("ReverseRefs.CodegraphError", {
  reason: Schema.String,
}) {
  override get message() {
    return `Codegraph query failed: ${this.reason}`
  }
}

export interface CodegraphInterface {
  readonly callers: (module: string) => Effect.Effect<readonly string[], CodegraphError>
}

/**
 * Optional codegraph service seam (research §5.2). Core ships without a
 * codegraph MCP client; the source degrades to no-injection when this service
 * is absent (L2 兜底矩阵: 无 codegraph MCP -> 不注入，基线不变).
 */
export class Codegraph extends Context.Service<Codegraph, CodegraphInterface>()("@aigcfroge/v2/Codegraph") {}

const renderCallers = (callers: readonly string[]) =>
  callers.length === 0
    ? "No reverse references."
    : ["Modules referenced by changed files:", ...callers.map((caller) => `- ${caller}`)].join("\n")

/**
 * Per-session reverse-references SystemContext source.
 *
 * Composed per session by the runner (not registered in the Location-scoped
 * registry) because the changed-file set is session-scoped. Returns `undefined`
 * when disabled or when codegraph is unavailable, so the baseline (and the
 * prompt-cache prefix hash) is byte-identical to the pre-feature state.
 */
export const source = (files: readonly string[]): Effect.Effect<SystemContext.SystemContext | undefined> =>
  Effect.gen(function* () {
    const config = yield* Effect.serviceOption(Config.Service)
    if (Option.isNone(config) || !settings(yield* config.value.entries()).enabled) return undefined
    const codegraph = yield* Effect.serviceOption(Codegraph)
    if (Option.isNone(codegraph)) return undefined
    const modules = [...new Set(files.map((file) => Verifier.packageDirectory(file)).filter((m) => m !== undefined))]
    const callers = yield* Effect.forEach(modules, (module) => codegraph.value.callers(module), {
      concurrency: "unbounded",
    }).pipe(
      Effect.map((results) => [...new Set(results.flat())]),
      Effect.catchTag("ReverseRefs.CodegraphError", () => Effect.succeed([] as readonly string[])),
    )
    return SystemContext.make({
      key: SystemContext.Key.make("core/reverse-refs"),
      codec: Schema.toCodecJson(Schema.Array(Schema.String)),
      load: Effect.succeed(callers),
      baseline: renderCallers,
      update: (_previous, current) => renderCallers(current),
    })
  })
