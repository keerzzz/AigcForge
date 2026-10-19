import { Effect, Schema } from "effect"
import { SessionTask } from "@aigcfroge/core/session/task"
import { Location } from "@aigcfroge/core/location"
import { Project } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import * as Tool from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"

// Reuse the canonical six-state write contract directly (AI-TDD-S01-R04/R08):
// the default V1 execution chain writes SessionTask through its own registered
// tool, with no three-field bridge and no second persisted shape. Invalid
// status/priority is rejected by schema validation at the input boundary (the
// model can self-correct) instead of being silently persisted.
export const Parameters = Schema.Struct({
  tasks: Schema.mutable(Schema.Array(SessionTask.WriteInfo)).annotate({
    description:
      "The full task list. Entries without an id are created with a stable tsk_ id; entries with an id are reconciled in place. Omitted entries are removed.",
  }),
  expectedRevision: Schema.optional(Schema.Number).annotate({
    description:
      "The max revision the caller observed across all tasks. If any task changed since, the replace is rejected as stale.",
  }),
})

type Metadata = {
  tasks: ReadonlyArray<SessionTask.Info>
}

// Core's EventV2.publish stamps an event's location only from an ambient
// Location.Service (core/src/event.ts). V1 prompt-loop fibers carry InstanceRef
// instead, so without this bridge task.updated would go out location-less and
// the SSE /event location filter would drop it.
const withInstanceLocation = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* effect
    const workspaceID = yield* WorkspaceRef
    return yield* effect.pipe(
      Effect.provideService(
        Location.Service,
        Location.Service.of({
          directory: AbsolutePath.make(ctx.directory),
          ...(workspaceID ? { workspaceID } : {}),
          project: { id: Project.ID.make(ctx.project.id), directory: AbsolutePath.make(ctx.worktree) },
        }),
      ),
    )
  })

export const TodoWriteTool = Tool.define<typeof Parameters, Metadata, SessionTask.Service>(
  "todowrite",
  Effect.gen(function* () {
    const tasks = yield* SessionTask.Service

    return {
      description: DESCRIPTION_WRITE,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "todowrite",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          // Tool execute defects surface to the model as the tool-error message
          // (see SessionProcessor.failToolCall), so map each failure to a
          // readable, self-correcting instruction instead of swallowing it.
          const updated = yield* withInstanceLocation(
            tasks.update({
              sessionID: ctx.sessionID,
              tasks: params.tasks,
              expectedRevision: params.expectedRevision,
            }),
          ).pipe(
            Effect.catchTag("SessionTask.TaskWriteError", (error) => {
              if (error.reason !== "stale_revision") return Effect.die(new Error(error.message))
              // Hand the model the server's current list so it can merge its
              // changes and retry.
              return tasks
                .get(ctx.sessionID)
                .pipe(
                  Effect.flatMap((current) =>
                    Effect.die(
                      new Error(
                        `${error.message}\nCurrent server-side task list:\n${JSON.stringify(current, null, 2)}\nMerge your changes into this list and retry.`,
                      ),
                    ),
                  ),
                )
            }),
          )

          return {
            title: `${updated.filter((x) => x.status !== "completed").length} todos`,
            output: JSON.stringify(updated, null, 2),
            metadata: {
              tasks: updated,
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
