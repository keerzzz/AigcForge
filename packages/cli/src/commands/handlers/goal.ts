export * as GoalCommand from "./goal"

import { Omnixa, type OmnixaClient } from "@omnixa/client"
import { Service } from "@omnixa/client/effect/service"
import { SessionGoal } from "@omnixa/schema/session-goal"
import { Effect, Option, Schema } from "effect"
import { EOL } from "node:os"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"
import { errorMessage } from "../../util/error"

export const execute = Effect.fn("cli.goal.execute")(function* (
  client: OmnixaClient,
  input: {
    sessionID: string
    action: "list" | "read" | "set" | "edit" | "pause" | "resume" | "cancel" | "confirm"
    goal?: string
    data?: string
    revision?: number
  },
) {
  const session = yield* Effect.tryPromise((signal) => client.session.get({ sessionID: input.sessionID }, { signal }))
  const route = { sessionID: session.id, directory: session.location.directory }
  if (input.action === "list") return yield* Effect.tryPromise((signal) => client.sessionGoal.list(route, { signal }))
  if (input.action === "set") {
    if (input.data === undefined)
      return yield* Effect.fail(new Error("goal set requires --data with objective, conditions, and budget"))
    const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SessionGoal.CreateInput))(input.data)
    return yield* Effect.tryPromise((signal) =>
      client.sessionGoal.set({ ...route, ...Schema.encodeSync(SessionGoal.CreateInput)(payload) }, { signal }),
    )
  }
  if (!input.goal) return yield* Effect.fail(new Error(`goal ${input.action} requires --goal`))
  const ref = { ...route, goalID: input.goal }
  if (input.action === "read") return yield* Effect.tryPromise((signal) => client.sessionGoal.get(ref, { signal }))
  if (input.action === "edit") {
    if (input.data === undefined)
      return yield* Effect.fail(new Error("goal edit requires --data with expectedRevision and the changes"))
    const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SessionGoal.EditInput))(input.data)
    return yield* Effect.tryPromise((signal) =>
      client.sessionGoal.edit({ ...ref, ...Schema.encodeSync(SessionGoal.EditInput)(payload) }, { signal }),
    )
  }
  if (input.action === "confirm") {
    if (input.data === undefined)
      return yield* Effect.fail(
        new Error(
          "goal confirm requires --data with the reviewed expectedRevision, evidenceIDs, and evidenceSetDigest",
        ),
      )
    const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SessionGoal.ConfirmInput))(input.data)
    return yield* Effect.tryPromise((signal) =>
      client.sessionGoal.confirm({ ...ref, ...Schema.encodeSync(SessionGoal.ConfirmInput)(payload) }, { signal }),
    )
  }
  if (input.revision === undefined)
    return yield* Effect.fail(new Error(`goal ${input.action} requires --revision from the saved Goal`))
  const payload = yield* Schema.decodeUnknownEffect(SessionGoal.RevisionInput)({ expectedRevision: input.revision })
  const request = { ...ref, ...payload }
  if (input.action === "pause")
    return yield* Effect.tryPromise((signal) => client.sessionGoal.pause(request, { signal }))
  if (input.action === "cancel")
    return yield* Effect.tryPromise((signal) => client.sessionGoal.cancel(request, { signal }))
  return yield* Effect.tryPromise((signal) => client.sessionGoal.resume(request, { signal }))
})

export default Runtime.handler(Commands.commands.goal, (input) =>
  Effect.gen(function* () {
    const server = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    })
    const client = Omnixa.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
    const result = yield* execute(client, {
      sessionID: input.sessionID,
      action: Option.getOrElse(input.action, () => "list"),
      goal: Option.getOrUndefined(input.goal),
      data: Option.getOrUndefined(input.data),
      revision: Option.getOrUndefined(input.revision),
    })
    process.stdout.write(JSON.stringify(result, null, 2) + EOL)
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)
