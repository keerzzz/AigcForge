export * as AgentTaskHandlers from "./agent-task"

import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { SessionTask } from "@aigcfroge/core/session/task"
import { InstanceHttpApi } from "../api"

export const agentTaskHandlers = HttpApiBuilder.group(InstanceHttpApi, "agent-task", (handlers) =>
  Effect.gen(function* () {
    const list = Effect.fn("AgentTaskHttpApi.list")(function* () {
      const v2task = yield* SessionTask.Service
      return yield* v2task.listAll()
    })
    return handlers.handle("list", list)
  }),
)
