import PROMPT_META from "./prompt/meta.txt"

export const description = "The meta agent — unified orchestration entry point."

export const prompt = PROMPT_META

export const mode = "primary" as const

export const hidden = false

export const options = { cache_mode: "three-zone" } as const

export * as MetaAgent from "./meta-agent"
