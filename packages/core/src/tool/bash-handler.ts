import { Effect } from "effect"
import { type HandlerService, type Interface } from "../permission/tool-handler"

/**
 * BashHandler — per-tool permission strategy for the `bash` tool.
 *
 * Auto-approves commands running in whitelisted directory paths;
 * all other commands require user confirmation (delegated to PermissionV2).
 */
export const BashHandler: Interface = {
  canAutoApprove: (name, input, _ctx) =>
    Effect.sync(() => {
      if (name !== "bash") return false
      const workdir = (input as { workdir?: string }).workdir
      if (!workdir) return false
      // Whitelist: /tmp/* paths
      return workdir.startsWith("/tmp/")
    }),
}

/** Register the BashHandler for the `bash` tool name. */
export const registerBashHandler = (service: HandlerService): void => {
  service.register("bash", BashHandler)
}
