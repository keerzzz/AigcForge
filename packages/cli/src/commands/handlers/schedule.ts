export * as ScheduleCommand from "./schedule"

import { AigcForge, type AigcForgeClient } from "@aigcfroge/client"
import { Service } from "@aigcfroge/client/effect/service"
import { Schedule } from "@aigcfroge/schema/schedule"
import { SessionID } from "@aigcfroge/schema/session-id"
import { Effect, Option, Schema } from "effect"
import { EOL } from "node:os"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"
import { errorMessage } from "../../util/error"

const CreateInput = Schema.Struct({
  ...Schedule.Create.fields,
  sessionID: Schema.optional(Schedule.Create.fields.sessionID),
})

export const execute = Effect.fn("cli.schedule.execute")(function* (
  client: AigcForgeClient,
  input: {
    sessionID: string
    action: "list" | "read" | "create" | "edit" | "pause" | "resume" | "cancel" | "run" | "history" | "cancel-run"
    id?: string
    occurrence?: string
    data?: string
    revision?: number
  },
) {
  const session = yield* Effect.tryPromise((signal) => client.session.get({ sessionID: input.sessionID }, { signal }))
  const route = { directory: session.location.directory }
  if (input.action === "list")
    return yield* Effect.tryPromise((signal) => client.schedule.rules({ ...route, sessionID: session.id }, { signal }))
  if (input.action === "create") {
    if (input.data === undefined)
      return yield* Effect.fail(
        new Error("schedule create requires --data with kind, content, timezone, trigger, and target"),
      )
    const content = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(CreateInput))(input.data)
    const payload = new Schedule.Create({ ...content, sessionID: SessionID.make(session.id) })
    return yield* Effect.tryPromise((signal) =>
      client.schedule.create({ ...route, payload: Schema.encodeSync(Schedule.Create)(payload) }, { signal }),
    )
  }
  if (input.action === "cancel-run") {
    if (!input.occurrence) return yield* Effect.fail(new Error("schedule cancel-run requires --occurrence"))
    const occurrenceID = input.occurrence
    const rules = yield* Effect.tryPromise((signal) =>
      client.schedule.rules({ ...route, sessionID: session.id }, { signal }),
    )
    const occurrences = yield* Effect.forEach(rules, (rule) =>
      Effect.tryPromise((signal) => client.schedule.runs({ ...route, id: rule.id }, { signal })),
    )
    if (!occurrences.some((runs) => runs.some((run) => run.id === occurrenceID)))
      return yield* Effect.fail(new Error("Occurrence does not belong to the selected Session"))
    return yield* Effect.tryPromise((signal) => client.schedule.cancelRun({ ...route, occurrenceID }, { signal }))
  }
  if (!input.id) return yield* Effect.fail(new Error(`schedule ${input.action} requires --id`))
  const id = input.id
  const rule = yield* Effect.tryPromise((signal) => client.schedule.rule({ ...route, id }, { signal }))
  if (rule.sessionID !== session.id)
    return yield* Effect.fail(new Error("Schedule does not belong to the selected Session"))
  const ref = { ...route, id: rule.id }
  if (input.action === "read") return rule
  if (input.action === "history") return yield* Effect.tryPromise((signal) => client.schedule.runs(ref, { signal }))
  if (input.action === "edit") {
    if (input.data === undefined)
      return yield* Effect.fail(new Error("schedule edit requires --data with expectedRevision and the changes"))
    const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schedule.Edit))(input.data)
    return yield* Effect.tryPromise((signal) =>
      client.schedule.edit({ ...ref, payload: Schema.encodeSync(Schedule.Edit)(payload) }, { signal }),
    )
  }
  if (input.revision === undefined)
    return yield* Effect.fail(new Error(`schedule ${input.action} requires --revision from the saved rule`))
  const payload = yield* Schema.decodeUnknownEffect(Schedule.Mutation)({ expectedRevision: input.revision })
  const request = { ...ref, payload: Schema.encodeSync(Schedule.Mutation)(payload) }
  if (input.action === "pause") return yield* Effect.tryPromise((signal) => client.schedule.pause(request, { signal }))
  if (input.action === "resume")
    return yield* Effect.tryPromise((signal) => client.schedule.resume(request, { signal }))
  if (input.action === "cancel")
    return yield* Effect.tryPromise((signal) => client.schedule.cancelRule(request, { signal }))
  return yield* Effect.tryPromise((signal) => client.schedule.runOnce(request, { signal }))
})

export default Runtime.handler(Commands.commands.schedule, (input) =>
  Effect.gen(function* () {
    const server = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    })
    const client = AigcForge.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
    const result = yield* execute(client, {
      sessionID: input.sessionID,
      action: Option.getOrElse(input.action, () => "list"),
      id: Option.getOrUndefined(input.id),
      occurrence: Option.getOrUndefined(input.occurrence),
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
