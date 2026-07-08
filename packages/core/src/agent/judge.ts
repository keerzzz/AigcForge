import { Effect } from "effect"
import { LLM, LLMClient, Message, SystemPart } from "@aigcfroge/llm"
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

    const judgeModel = yield* findJudgeModel(catalog)
    if (!judgeModel) return results[0]

    const model = yield* fromCatalogModel(judgeModel).pipe(
      Effect.catch(() => Effect.succeed(undefined as unknown as never)),
    )
    if (!(model as unknown)) return results[0]

    const parts = results.map((r, i) => `<attempt index="${i + 1}">\n${r}\n</attempt>`)
    const formatted = [
      `[Original task]\n${prompt}\n`,
      `[Worker outputs]\n${parts.join("\n\n")}`,
    ].join("\n")

    const request = LLM.request({
      model: model as unknown as Parameters<typeof LLM.request>[0]["model"],
      system: [SystemPart.make(JUDGE_SYSTEM_PROMPT)],
      messages: [Message.user(formatted)],
      generation: { maxTokens: 4096, temperature: 0.3 },
    })

    const response = yield* llm.generate(request).pipe(
      Effect.catch(() => Effect.succeed(undefined as unknown as never)),
    )
    if (!(response as unknown)) return results[0]

    const text = (response as unknown as { text: string }).text.trim()
    return text.length > 10 ? text : results[0]
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
