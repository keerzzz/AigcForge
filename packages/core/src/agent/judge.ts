import { Effect } from "effect"
import { LLM, LLMClient, Message, SystemPart, LLMResponse } from "@aigcfroge/llm"
import { Catalog } from "../catalog"
import { fromCatalogModel } from "../session/runner/model"

const JUDGE_SYSTEM_PROMPT = `You are a Judge model in a multi-model arbitration system.
Multiple AI agents have independently attempted the same task. Your job is to review their outputs and produce the best possible final result.

Rules:
1. Compare all outputs for correctness, completeness, and quality.
2. Merge the best parts from each into a single coherent result.
3. If one output is clearly superior, return it as-is.
4. Do NOT mention that this was a multi-model evaluation in your output.
5. Output only the final merged result - no preamble, no commentary, no meta-discussion.`

/**
 * Judge merge: take N independent results from the same task prompt, call a
 * cheap Judge LLM to merge them, and return the merged text. Falls back to
 * the first result if the Judge LLM is unavailable or fails.
 */
export const judgeMerge = (prompt: string, results: readonly string[]) =>
  Effect.gen(function* () {
    if (results.length === 0) return ""
    if (results.length === 1) return results[0]

    const llm = yield* LLMClient.Service
    const catalog = yield* Catalog.Service

    yield* Effect.logDebug(
      `Judge.merge: ${results.length} results, lengths=[${results.map((r) => r.length).join(",")}]`,
    )

    const judgeModel = yield* findJudgeModel(catalog)
    if (!judgeModel) {
      yield* Effect.logWarning("Judge.merge: no cheap model available, falling back to first result")
      return results[0]
    }

    yield* Effect.logInfo(`Judge.merge: using model ${judgeModel.providerID}/${judgeModel.id}`)

    // fromCatalogModel converts ModelV2.Info to LLM.Model (AI SDK route).
    // UnsupportedApiError means no SDK route exists for this model — treat
    // as unavailable and fall back to first result.
    const model = yield* fromCatalogModel(judgeModel).pipe(
      Effect.catchTag("SessionRunnerModel.UnsupportedApiError", () => Effect.succeed(undefined as unknown as never)),
    )
    if (!(model as unknown)) {
      yield* Effect.logWarning("Judge.merge: model resolution failed, falling back to first result")
      return results[0]
    }

    const parts = results.map((r, i) => `<attempt index="${i + 1}">\n${r}\n</attempt>`)
    const formatted = [
      `[Original task]\n${prompt}\n`,
      `[Worker outputs]\n${parts.join("\n\n")}`,
    ].join("\n")

    const request = LLM.request({
      model,
      system: [SystemPart.make(JUDGE_SYSTEM_PROMPT)],
      messages: [Message.user(formatted)],
      generation: { maxTokens: 4096, temperature: 0.3 },
    })

    // LLMClient.generate returns Effect<LLMResponse, LLMError>. On any
    // LLM failure (network, rate limit, etc.), fall back to first result.
    const response: LLMResponse | undefined = yield* llm.generate(request).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
    )
    if (!response) {
      yield* Effect.logWarning("Judge.merge: LLM generate failed, falling back to first result")
      return results[0]
    }

    const text = response.text.trim()
    if (text.length <= 10) {
      yield* Effect.logWarning(`Judge.merge: merged text too short (${text.length}), falling back to first result`)
      return results[0]
    }

    yield* Effect.logDebug(`Judge.merge: success, merged length=${text.length}`)
    return text
  })

const findJudgeModel = (catalog: Catalog.Interface) =>
  Effect.gen(function* () {
    const providers = yield* catalog.provider.all()
    for (const provider of providers) {
      const model = yield* catalog.model.small(provider.id)
      if (model) return model
    }
    return undefined
  })
