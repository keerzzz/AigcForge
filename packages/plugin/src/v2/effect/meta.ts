import type { Hooks } from "./registration.js"

/**
 * Meta agent hook draft.
 * Plugin callbacks receive this to register meta agent extensions.
 */
export interface MetaDraft {
  /** Register a custom intent classification handler. */
  readonly intent: {
    readonly register: (name: string, classify: (input: string) => string) => void
  }
  /** Register a CLI adapter for external tool delegation. */
  readonly adapter: {
    readonly register: (name: string, execute: (input: { prompt: string }) => Promise<string>) => void
  }
  /** Register middleware that runs before/after meta agent delegation. */
  readonly middleware: {
    readonly register: (
      name: string,
      hooks: {
        before?: (input: { prompt: string }) => Promise<{ prompt: string } | undefined>
        after?: (input: { result: string }) => Promise<{ result: string } | undefined>
        /** Runs before a tool executes. Return {allow: false} to block execution. */
        preToolUse?: (input: {
          toolName: string
          args: Record<string, unknown>
          sessionID: string
        }) => Promise<{ allow: boolean; reason?: string }>
        /** Runs after a tool completes. */
        postToolUse?: (input: {
          toolName: string
          args: Record<string, unknown>
          result: unknown
          sessionID: string
        }) => Promise<void>
      },
    ) => void
  }
}

export type MetaHooks = Hooks<{
  transform: MetaDraft
}>
