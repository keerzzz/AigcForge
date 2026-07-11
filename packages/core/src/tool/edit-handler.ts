import { Effect } from "effect"
import { type HandlerService, type Interface } from "../permission/tool-handler"

/**
 * EditHandler — per-tool permission strategy for mutating tools.
 *
 * Auto-approves edits when the target path is inside a whitelisted
 * temporary/work directory; all other edits require user confirmation.
 */
const EDIT_TOOLS = new Set(["edit", "write", "apply_patch"])

function isWhitelistedPath(input: Record<string, unknown>): boolean {
  const filePath = typeof input.filePath === "string" ? input.filePath : undefined
  const path = typeof input.path === "string" ? input.path : undefined
  const target = filePath ?? path ?? ""
  return target.startsWith("/tmp/")
}

export const EditHandler: Interface = {
  canAutoApprove: (name, input, _ctx) =>
    Effect.sync(() => {
      if (!EDIT_TOOLS.has(name)) return false
      return isWhitelistedPath(input)
    }),
  getConfirmationParams: (name, input) => {
    const filePath = typeof input.filePath === "string" ? input.filePath : undefined
    const path = typeof input.path === "string" ? input.path : undefined
    return {
      title: `${name} file`,
      description: filePath ?? path ?? "",
    }
  },
}

/** Register the EditHandler for all mutating tool names. */
export const registerEditHandler = (service: HandlerService): void => {
  for (const tool of EDIT_TOOLS) {
    service.register(tool, EditHandler)
  }
}
