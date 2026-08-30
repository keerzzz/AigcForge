import { Effect } from "effect"

export type PreToolUseInput = {
  readonly toolName: string
  readonly args: Record<string, unknown>
  readonly sessionID: string
}

export type PostToolUseInput = {
  readonly toolName: string
  readonly args: Record<string, unknown>
  readonly result: unknown
  readonly sessionID: string
}

export type PreToolUseHook = (
  input: PreToolUseInput,
) => Effect.Effect<{ readonly allow: boolean; readonly reason?: string }>

export type PostToolUseHook = (input: PostToolUseInput) => Effect.Effect<void>

type HookEntry<H> = { readonly hook: H }

const preToolUseHooks: Array<HookEntry<PreToolUseHook>> = []
const postToolUseHooks: Array<HookEntry<PostToolUseHook>> = []

/** Register a PreToolUse hook. Returns an unregister function. */
export const registerPreToolUse = (hook: PreToolUseHook): (() => void) => {
  const entry: HookEntry<PreToolUseHook> = { hook }
  preToolUseHooks.push(entry)
  return () => {
    const idx = preToolUseHooks.indexOf(entry)
    if (idx >= 0) preToolUseHooks.splice(idx, 1)
  }
}

/** Register a PostToolUse hook. Returns an unregister function. */
export const registerPostToolUse = (hook: PostToolUseHook): (() => void) => {
  const entry: HookEntry<PostToolUseHook> = { hook }
  postToolUseHooks.push(entry)
  return () => {
    const idx = postToolUseHooks.indexOf(entry)
    if (idx >= 0) postToolUseHooks.splice(idx, 1)
  }
}

/** Run all registered PreToolUse hooks. Returns the first deny, or allow if all pass. */
export const runPreToolUse = (
  input: PreToolUseInput,
): Effect.Effect<{ readonly allow: boolean; readonly reason?: string }> =>
  preToolUseHooks.length === 0
    ? Effect.succeed({ allow: true })
    : Effect.gen(function* () {
        for (const entry of preToolUseHooks) {
          const result = yield* entry.hook(input)
          if (!result.allow) return result
        }
        return { allow: true }
      })

/**
 * Run all registered PostToolUse hooks.
 * Each hook runs independently: a failure in one does not prevent others from running.
 */
export const runPostToolUse = (input: PostToolUseInput): Effect.Effect<void> =>
  Effect.forEach(postToolUseHooks, (entry) => entry.hook(input).pipe(Effect.ignore), { discard: true })
