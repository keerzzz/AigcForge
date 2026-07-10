import { Layer } from "effect"
import { SessionV2 } from "../session"
import { SessionStore } from "./store"
import * as SessionExecutionLocal from "./execution/local"
import { LocationServiceMap } from "../location-layer"
import { SessionShareV2 } from "./share-v2"
import { ProjectV2 } from "../project"
import { Database } from "../database/database"
import { EventV2 } from "../event"

/**
 * V2 session runtime: SessionV2 with REAL SessionExecutionLocal (not
 * noopLayer). Self-contained via Layer.provide chains because Effect v4
 * Layer.mergeAll does NOT self-satisfy internal dependencies.
 */
const sessionExecutionLive = SessionExecutionLocal.layer.pipe(
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(LocationServiceMap.layer),
)

export const v2RuntimeLayer = SessionV2.layer.pipe(
  Layer.provide(sessionExecutionLive),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(ProjectV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(EventV2.defaultLayer),
)

export const v2ShareLayer = SessionShareV2.layer.pipe(
  Layer.provide(v2RuntimeLayer),
  Layer.provide(EventV2.defaultLayer),
)
