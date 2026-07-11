import { Effect } from "effect"
import { type HandlerService, type Interface } from "../permission/tool-handler"

/**
 * ReadHandler — per-tool permission strategy for read-only tools.
 *
 * Auto-approves tools that only observe files or search the codebase.
 * Does not cover tools that mutate state (edit/write/apply_patch).
 */
const READ_ONLY_TOOLS = new Set(["read", "read_file", "grep", "glob", "list", "websearch", "webfetch"])

export const ReadHandler: Interface = {
  canAutoApprove: (name, _input, _ctx) => Effect.sync(() => READ_ONLY_TOOLS.has(name)),
}

/** Register the ReadHandler for all read-only tool names. */
export const registerReadHandler = (service: HandlerService): void => {
  for (const tool of READ_ONLY_TOOLS) {
    service.register(tool, ReadHandler)
  }
}
