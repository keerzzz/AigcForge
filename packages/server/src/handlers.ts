import { SessionV2 } from "@aigcfroge/core/session"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { PermissionSaved } from "@aigcfroge/core/permission/saved"
import { PtyTicket } from "@aigcfroge/core/pty/ticket"
import { TaskDriverFill } from "@aigcfroge/core/session/task-driver-fill"
import { BackgroundJob } from "@aigcfroge/core/background-job"
import { EventV2 } from "@aigcfroge/core/event"
import { v2RuntimeLayer, v2ShareLayer } from "@aigcfroge/core/session/v2-runtime"
import { Layer } from "effect"
import { layer as locationLayer } from "./groups/location"
import { sessionLocationLayer } from "./middleware/session-location"
import { MessageHandler } from "./handlers/message"
import { ModelHandler } from "./handlers/model"
import { ProviderHandler } from "./handlers/provider"
import { SessionHandler } from "./handlers/session"
import { PermissionHandler } from "./handlers/permission"
import { GrantHandler } from "./handlers/grant"
import { FileSystemHandler } from "./handlers/fs"
import { CommandHandler } from "./handlers/command"
import { SkillHandler } from "./handlers/skill"
import { EventHandler } from "./handlers/event"
import { AgentHandler } from "./handlers/agent"
import { HealthHandler } from "./handlers/health"
import { PtyHandler } from "./handlers/pty"
import { QuestionHandler } from "./handlers/question"
import { ReferenceHandler } from "./handlers/reference"
import { LocationHandler } from "./handlers/location"
import { IntegrationHandler } from "./handlers/integration"
import { CredentialHandler } from "./handlers/credential"
import { Credential } from "@aigcfroge/core/credential"
import { ProjectCopyHandler } from "./handlers/project-copy"

// TaskDriverFill bridge: consumes SessionV2.Service + BackgroundJob.Service.
// Uses .defaultLayer (self-contained) because Effect v4 Layer.mergeAll does not
// self-satisfy. When V2 auth is fixed + AIGCFROGE_V2_RUNTIME=true, replace
// SessionV2.defaultLayer with v2RuntimeLayer (real SessionExecutionLocal).
const fillerLayer = TaskDriverFill.layer.pipe(
  Layer.provide(SessionV2.defaultLayer),
  Layer.provide(BackgroundJob.defaultLayer),
  // The fill writes child messages through EventV2; SessionV2.defaultLayer
  // consumes its own EventV2 internally, so provide the shared default explicitly.
  Layer.provide(EventV2.defaultLayer),
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
  GrantHandler,
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
  Layer.provide(v2RuntimeLayer),
  Layer.provide(v2ShareLayer),
  Layer.provide(PermissionSaved.defaultLayer),
  Layer.provide(PtyTicket.defaultLayer),
  Layer.provide(fillerLayer),
  Layer.provide(LocationServiceMap.layer),
  Layer.provide(Credential.defaultLayer),
)
