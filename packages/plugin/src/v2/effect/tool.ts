import type { Hooks } from "./registration.js"

/**
 * Tool hook draft.
 * Plugin callbacks receive this to register custom tools and lifecycle hooks.
 */
export interface ToolDraft {
  /** Register a custom tool with name, description, and execute handler. */
  readonly register: (
    name: string,
    tool: {
      readonly description: string
      readonly inputSchema: unknown
      readonly execute: (input: unknown) => Promise<unknown>
    },
  ) => void
}

export type ToolHooks = Hooks<{
  transform: ToolDraft
}>
