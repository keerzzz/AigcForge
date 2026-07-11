export * as ToolPermissionHandler from "./tool-handler"

import { Context, Effect, Layer } from "effect"

/**
 * ToolPermissionHandler — per-tool permission strategy.
 *
 * Each handler implements one or more of the three methods below.
 * The registry resolves the most specific matching handler for a tool call.
 * When no handler matches, the system falls back to the standard PermissionV2 ruleset.
 */

export type PermissionResult =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: string }
  | { readonly allow: "ask" }

export interface ToolHandlerContext {
  readonly sessionID: string
}

export interface Interface {
  /**
   * Check if a tool call can be auto-approved without user confirmation.
   * Return `true` to skip the permission dialog entirely.
   */
  readonly canAutoApprove?: (
    name: string,
    input: Record<string, unknown>,
    ctx: ToolHandlerContext,
  ) => Effect.Effect<boolean>

  /**
   * Custom confirmation parameters for the permission dialog.
   * Only called when `canAutoApprove` returns `false` or is not defined.
   */
  readonly getConfirmationParams?: (
    name: string,
    input: Record<string, unknown>,
  ) => { readonly title?: string; readonly description?: string }

  /**
   * Fully custom permission resolution.
   * When defined, this takes precedence over `canAutoApprove` + `getConfirmationParams`.
   */
  readonly handle?: (
    name: string,
    input: Record<string, unknown>,
    ctx: ToolHandlerContext,
  ) => Effect.Effect<PermissionResult>
}

export interface HandlerService {
  readonly register: (toolName: string, handler: Interface) => void
  readonly resolve: (name: string) => Interface | undefined
  readonly resolvePermission: (
    name: string,
    input: Record<string, unknown>,
    ctx: ToolHandlerContext,
  ) => Effect.Effect<PermissionResult | undefined>
}

export class Service extends Context.Service<Service, HandlerService>()("@aigcfroge/v2/ToolPermissionHandler") {}

const make = Effect.gen(function* () {
  const entries = new Map<string, Interface>()

  const register = (toolName: string, handler: Interface): void => {
    entries.set(toolName, handler)
  }

  const resolve = (name: string): Interface | undefined => {
    const exact = entries.get(name)
    if (exact) return exact
    for (const [pattern, handler] of entries) {
      if (pattern.endsWith("*")) {
        const prefix = pattern.slice(0, -1)
        if (name.startsWith(prefix)) return handler
      }
    }
    return undefined
  }

  const resolvePermission = (
    name: string,
    input: Record<string, unknown>,
    ctx: ToolHandlerContext,
  ): Effect.Effect<PermissionResult | undefined> =>
    Effect.gen(function* () {
      const handler = resolve(name)
      if (!handler) return undefined

      if (handler.handle) return yield* handler.handle(name, input, ctx)

      if (handler.canAutoApprove) {
        const approved = yield* handler.canAutoApprove(name, input, ctx)
        if (approved) return { allow: true }
      }

      return { allow: "ask" }
    })

  return Service.of({ register, resolve, resolvePermission })
})

export const layer = Layer.effect(Service, make)

/** Test helper: create an isolated HandlerService with fresh state. */
export const testDouble = (): HandlerService => {
  const entries = new Map<string, Interface>()

  const resolve = (name: string): Interface | undefined => {
    const exact = entries.get(name)
    if (exact) return exact
    for (const [pattern, handler] of entries) {
      if (pattern.endsWith("*")) {
        const prefix = pattern.slice(0, -1)
        if (name.startsWith(prefix)) return handler
      }
    }
    return undefined
  }

  return Service.of({
    resolve,
    register: (toolName, handler) => { entries.set(toolName, handler) },
    resolvePermission: (
      name: string,
      input: Record<string, unknown>,
      ctx: ToolHandlerContext,
    ): Effect.Effect<PermissionResult | undefined> =>
      Effect.gen(function* () {
        const handler = resolve(name)
        if (!handler) return undefined
        if (handler.handle) return yield* handler.handle(name, input, ctx)
        if (handler.canAutoApprove) {
          const approved = yield* handler.canAutoApprove(name, input, ctx)
          if (approved) return { allow: true }
        }
        return { allow: "ask" }
      }),
  })
}
