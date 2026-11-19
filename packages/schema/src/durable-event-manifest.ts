export * as DurableEventManifest from "./durable-event-manifest.js"

import { Event } from "./event.js"
import { Worktree } from "./worktree.js"
import { SessionEvent } from "./session-event.js"
import { DelegationEvent } from "./delegation-event.js"
import { WorkflowEvent } from "./workflow-event.js"
import { SessionTaskEvent } from "./session-task-event.js"
import { Schedule } from "./schedule.js"

export const Durable = Event.durableMap([
  ...SessionEvent.DurableDefinitions,
  ...DelegationEvent.Definitions,
  ...WorkflowEvent.Definitions,
  ...SessionTaskEvent.DurableDefinitions,
  ...Schedule.DurableDefinitions,
  Worktree.Event.Resolved,
])
