import { SessionV2 } from "@aigcfroge/core/session"
import { SessionShareV2 } from "@aigcfroge/core/session/share-v2"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { PermissionSaved } from "@aigcfroge/core/permission/saved"
import { PtyTicket } from "@aigcfroge/core/pty/ticket"
import { TaskDriverFill } from "@aigcfroge/core/session/task-driver-fill"
import { BackgroundJob } from "@aigcfroge/core/background-job"
import { Layer } from "effect"
import { layer as locationLayer } from "./groups/location"
import { sessionLocationLayer } from "./middleware/session-location"
import { MessageHandler } from "./handlers/message"
import { ModelHandler } from "./handlers/model"
import { ProviderHandler } from "./handlers/provider"
import { SessionHandler } from "./handlers/session"
import { PermissionHandler } from "./handlers/permission"
import { FileSystemHandler } from "./handlers/fs"
import { CommandHandler } from "./handlers/command"
import { SkillHandler } from "./handlers/skill"
import { EventHandler } from "./handlers/event"
import { AgentHandler } from "./handlers/agent"
import { HealthHandler } from "./handlers/health"
import { PtyHandler } from "./handlers/pty"
import { QuestionHandler } from "./handlers/question"
import { ReferenceHandler } from "./handlers/reference"
import * as SessionExecutionLocal from "@aigcfroge/core/session/execution/local"
import { LocationHandler } from "./handlers/location"
import { IntegrationHandler } from "./handlers/integration"
import { CredentialHandler } from "./handlers/credential"
import { Credential } from "@aigcfroge/core/credential"
import { ProjectCopyHandler } from "./handlers/project-copy"

// Install the SessionV2-backed TaskDriver bridge so the `task` built-in can
// drive child Sessions. The bridge is a plain module singleton (see
// tool/task-driver.ts), so this only needs SessionV2 + BackgroundJob — no Layer
// wiring bubbles out to the handler graph. BackgroundJob runs child drains off
// the caller's fiber.
const fillerLayer = TaskDriverFill.layer.pipe(
  Layer.provide(SessionV2.defaultLayer),
  Layer.provide(BackgroundJob.defaultLayer),
)

export const handlers = Layer.mergeAll(
  HealthHandler,
  LocationHandler,
  AgentHandler,
  SessionHandler,
  MessageHandler,
  ModelHandler,
  ProviderHandler,
  IntegrationHandler,
  CredentialHandler,
  PermissionHandler,
  FileSystemHandler,
  CommandHandler,
  SkillHandler,
  EventHandler,
  PtyHandler,
  QuestionHandler,
  ReferenceHandler,
  ProjectCopyHandler,
).pipe(
  Layer.provide(sessionLocationLayer),
  Layer.provide(locationLayer),
  Layer.provide(SessionV2.defaultLayer),
  Layer.provide(SessionExecutionLocal.defaultLayer),
  Layer.provide(SessionShareV2.defaultLayer),
  Layer.provide(PermissionSaved.defaultLayer),
  Layer.provide(PtyTicket.defaultLayer),
  Layer.provide(fillerLayer),
  Layer.provide(LocationServiceMap.layer),
  Layer.provide(Credential.defaultLayer),
)
