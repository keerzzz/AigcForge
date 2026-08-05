import { PermissionV1 } from "@aigcfroge/core/v1/permission"
import type { Agent } from "./agent"

/**
 * Build the `permission` ruleset for a subagent's session when it's spawned
 * via the task tool. Combines:
 *
 * 1. The parent session's deny rules and external_directory rules.
 *    Parent agent restrictions only govern that agent; the subagent's own
 *    permissions determine its capabilities.
 * 2. Default `todowrite`, `taskwrite`, `task`, `task_schedule`, and
 *    `task_spawn` denies if the subagent's own ruleset doesn't already permit
 *    them.
 */
export function deriveSubagentSessionPermission(input: {
  parentSessionPermission: PermissionV1.Ruleset
  subagent: Agent.Info
}): PermissionV1.Ruleset {
  const canTask = input.subagent.permission.some((rule) => rule.permission === "task")
  const canTaskwrite = input.subagent.permission.some((rule) => rule.permission === "taskwrite")
  const canTaskSchedule = input.subagent.permission.some((rule) => rule.permission === "task_schedule")
  const canTaskSpawn = input.subagent.permission.some((rule) => rule.permission === "task_spawn")
  const canTodo = input.subagent.permission.some((rule) => rule.permission === "todowrite")
  return [
    ...input.parentSessionPermission.filter(
      (rule) => rule.permission === "external_directory" || rule.action === "deny",
    ),
    ...(canTodo ? [] : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(canTaskwrite ? [] : [{ permission: "taskwrite" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(canTask ? [] : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(canTaskSchedule
      ? []
      : [{ permission: "task_schedule" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(canTaskSpawn
      ? []
      : [{ permission: "task_spawn" as const, pattern: "*" as const, action: "deny" as const }]),
  ]
}
