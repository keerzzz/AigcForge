import { Agent } from "@omnixa/core/agent"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { response } from "../location"
import { AgentNotFoundError } from "@omnixa/protocol/errors"

export const AgentHandler = HttpApiBuilder.group(Api, "server.agent", (handlers) =>
  handlers
    .handle("agent.list", () =>
      Effect.gen(function* () {
        return yield* response(
          Agent.Service.use((agent) => agent.list()).pipe(
            Effect.map((agents) => agents.map((agent) => ({ ...agent, ordinaryModes: Agent.ordinaryModes(agent) }))),
          ),
        )
      }),
    )
    .handle(
      "agent.get",
      Effect.fn(function* (ctx) {
        const agent = yield* Agent.Service.use((service) => service.get(ctx.params.agentID))
        if (!agent)
          return yield* new AgentNotFoundError({
            agentID: ctx.params.agentID,
            message: `Agent not found: ${ctx.params.agentID}`,
          })
        return yield* response(Effect.succeed({ ...agent, ordinaryModes: Agent.ordinaryModes(agent) }))
      }),
    ),
)
