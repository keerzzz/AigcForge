import { describe, expect } from "bun:test"
import { DateTime, Effect, Layer, Schema } from "effect"
import { AgentV2 } from "@aigcfroge/core/agent"
import { Location } from "@aigcfroge/core/location"
import { ModelV2 } from "@aigcfroge/core/model"
import { Project } from "@aigcfroge/core/project"
import { ProviderV2 } from "@aigcfroge/core/provider"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { ScheduledJob } from "@aigcfroge/core/session/scheduled-job"
import { ScheduledJobExecutor } from "@aigcfroge/core/session/scheduled-job-executor"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { TaskDriver } from "@aigcfroge/core/tool/task-driver"
import { testEffect } from "./lib/effect"

const parentID = SessionV2.ID.make("ses_scheduled_parent")
const childID = SessionV2.ID.make("ses_scheduled_child")

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const childInfo = Schema.decodeUnknownSync(SessionSchema.Info)({
  id: childID,
  slug: "scheduled-child",
  version: "test",
  parentID,
  projectID: Project.ID.global,
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
  title: "scheduled child",
  location: { directory: "/project" },
})
const childResult = SessionMessage.Assistant.make({
  id: SessionMessage.ID.make("msg_scheduled_result"),
  type: "assistant",
  agent: "build",
  model: {
    id: ModelV2.ID.make("test-model"),
    providerID: ProviderV2.ID.make("test-provider"),
  },
  content: [
    SessionMessage.AssistantText.make({
      type: "text",
      id: "text_scheduled_result",
      text: "Scheduled child completed",
    }),
  ],
  time: { created: DateTime.makeUnsafe(0), completed: DateTime.makeUnsafe(0) },
})

type WaitOutcome = TaskDriver.BackgroundOutcome
const state: {
  createChild: Array<{ parentID: SessionSchema.ID; agent?: AgentV2.ID; attended?: boolean }>
  prompts: string[]
  wait: WaitOutcome
  getDies: boolean
} = {
  createChild: [],
  prompts: [],
  wait: { status: "completed" },
  getDies: false,
}

// Explicit test runtime: createChild/delegate capture their inputs, while
// background.wait steers the delegation outcome (completed / error / cancelled).
const installStub = () =>
  TaskDriver.installForTesting(
    {
      get: () =>
        state.getDies ? Effect.die("facade unavailable") : Effect.succeed({ location }),
      create: (input) =>
        Effect.sync(() => {
          state.createChild.push(input)
          return childInfo
        }),
      prompt: (input) =>
        Effect.sync(() => {
          state.prompts.push(input.prompt.text)
        }),
      resume: () => Effect.void,
      messages: () => Effect.succeed([childResult]),
      injectSynthetic: () => Effect.void,
      interrupt: () => Effect.void,
    } satisfies TaskDriver.SessionFacade,
    {
      start: () => Effect.void,
      wait: () => Effect.succeed(state.wait),
      extend: () => Effect.succeed(false),
      cancel: () => Effect.void,
    } satisfies TaskDriver.BackgroundRunner,
  )

const it = testEffect(
  ScheduledJobExecutor.layer.pipe(
    Layer.provideMerge(Layer.effect(TaskDriver.Runtime, installStub())),
  ),
)

const run = (input: { agent?: string; prompt?: string }) =>
  Effect.gen(function* () {
    const executor = yield* ScheduledJob.ScheduledExecutor
    return yield* executor.run({ parentID, agent: input.agent, prompt: input.prompt ?? "audit", taskID: "tsk_1" })
  })

describe("ScheduledJobExecutor", () => {
  it.effect("completed delegation returns the child session id and drives an unattended child", () =>
    Effect.gen(function* () {
      state.createChild = []
      state.prompts = []
      state.wait = { status: "completed" }
      state.getDies = false
      const result = yield* run({ agent: "build" })
      expect(result).toEqual({ outcome: "completed", childSessionID: childID })

      expect(state.createChild).toHaveLength(1)
      expect(state.createChild[0]?.parentID).toBe(parentID)
      expect(state.createChild[0]?.attended).toBe(false)
      expect(state.createChild[0]?.agent).toBe(AgentV2.ID.make("build"))
      // The delegate prompt carries the task content (no taskID/onSettle
      // linkage — the runner settles the task itself). A compressed
      // parent-context summary may be prepended by the seam.
      expect(state.prompts).toHaveLength(1)
      expect(state.prompts[0]).toContain("audit")
    }),
  )

  it.effect("omits the agent when the task has none", () =>
    Effect.gen(function* () {
      state.createChild = []
      state.wait = { status: "completed" }
      state.getDies = false
      const result = yield* run({})
      expect(result.outcome).toBe("completed")
      expect(state.createChild[0]?.agent).toBeUndefined()
    }),
  )

  it.effect("a crashed child drain (DelegateError error) maps to failed", () =>
    Effect.gen(function* () {
      state.wait = { status: "error", error: "provider exploded" }
      state.getDies = false
      const result = yield* run({})
      expect(result).toEqual({ outcome: "failed" })
    }),
  )

  it.effect("an interrupted child drain (DelegateError cancelled) maps to cancelled", () =>
    Effect.gen(function* () {
      state.wait = { status: "cancelled" }
      state.getDies = false
      const result = yield* run({})
      expect(result).toEqual({ outcome: "cancelled" })
    }),
  )

  it.effect("an infrastructure defect (seam missing/broken) maps to failed instead of dying", () =>
    Effect.gen(function* () {
      state.getDies = true
      const result = yield* run({})
      expect(result).toEqual({ outcome: "failed" })
    }),
  )
})
