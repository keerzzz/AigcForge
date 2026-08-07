export * as Aigcfroge from "./aigcfroge"

import { Context, Effect, Layer } from "effect"
import { BackgroundJob } from "../background-job"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { LocationServiceMap } from "../location-layer"
import { ProjectV2 } from "../project"
import { SessionV2 } from "../session"
import * as SessionExecutionLocal from "../session/execution/local"
import { SessionProjector } from "../session/projector"
import { SessionStore } from "../session/store"
import { ApplicationTools } from "../tool/application-tools"
import { TaskDriverFill } from "../session/task-driver-fill"
import { Session } from "./session"
import { Tool } from "./tool"

export interface Interface {
  readonly sessions: Session.Interface
  readonly tools: Tool.Interface
}

/** Intentional public native API for Effect applications embedding Aigcfroge. */
export class Service extends Context.Service<Service, Interface>()("@aigcfroge/public/Aigcfroge") {}

const SessionsLayer = SessionV2.layer.pipe(
  Layer.provide(SessionProjector.layer),
  Layer.provide(SessionExecutionLocal.layer),
  Layer.provide(SessionStore.layer),
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(ProjectV2.defaultLayer),
  Layer.provide(LocationServiceMap.layer.pipe(Layer.provide(ApplicationTools.layer))),
  Layer.orDie,
)

// Installs the SessionV2-backed TaskDriver bridge so the `task` built-in can
// drive child Sessions. The child drain runs on a BackgroundJob fiber (never
// the caller's), so wire BackgroundJob alongside SessionV2. The fill writes
// child messages through EventV2, and a provided Session layer consumes its own
// EventV2 internally — so the fill must be given the shared EventV2.defaultLayer
// explicitly, or its `yield* EventV2.Service` dies with "Service not found".
const FillerLayer = TaskDriverFill.layer.pipe(
  Layer.provide(SessionsLayer),
  Layer.provide(BackgroundJob.defaultLayer),
  Layer.provide(EventV2.defaultLayer),
)
// TODO: Accept explicit storage so tests and embeddings can select disposable or application-owned persistence.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service
    const tools = yield* ApplicationTools.Service
    return Service.of({
      tools: { register: tools.register },
      sessions: {
        create: (input) =>
          sessions.create({
            id: input.id,
            agent: input.agent,
            model: input.model,
            location: input.location,
          }),
        get: sessions.get,
        list: sessions.list,
        switchModel: sessions.switchModel,
        interrupt: sessions.interrupt,
        prompt: (input) =>
          sessions.prompt({
            id: input.id,
            sessionID: input.sessionID,
            prompt: input.prompt,
            delivery: input.delivery,
          }),
        messages: (input) =>
          sessions.messages({
            sessionID: input.sessionID,
            limit: input.limit,
            order: input.order,
            cursor: input.cursor,
          }),
        message: (input) => sessions.message({ sessionID: input.sessionID, messageID: input.messageID }),
        context: sessions.context,
        events: (input) => sessions.events({ sessionID: input.sessionID, after: input.after }),
      },
    })
  }),
).pipe(Layer.provide(Layer.mergeAll(ApplicationTools.layer, SessionsLayer, FillerLayer)))

// TODO: Add Aigcfroge.create(...) as the Promise facade over the same native API semantics.
