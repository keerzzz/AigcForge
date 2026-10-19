import { expect } from "bun:test"
import { Context, Effect, Layer, Scope } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { ProjectV2 } from "@aigcfroge/core/project"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionStore } from "@aigcfroge/core/session/store"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

it.effect("record-only Session defaults cannot capture the live runtime's execution owner", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope
    const memo = yield* Layer.makeMemoMap
    const cold = yield* Layer.buildWithMemoMap(SessionV2.defaultLayer, memo, scope)
    const calls: string[] = []
    const live = yield* Layer.buildWithMemoMap(
      SessionV2.layer.pipe(
        Layer.provide(
          Layer.mock(SessionExecution.Service, {
            interrupt: (id) =>
              Effect.sync(() => {
                calls.push(id)
              }),
          }),
        ),
        Layer.provide(SessionStore.defaultLayer),
        Layer.provide(EventV2.defaultLayer),
        Layer.provide(Database.defaultLayer),
        Layer.provide(ProjectV2.defaultLayer),
      ),
      memo,
      scope,
    )
    const id = SessionV2.ID.make("ses_execution_owner")
    yield* Context.get(live, SessionV2.Service).interrupt(id)
    expect(calls).toEqual([id])
    yield* Context.get(cold, SessionV2.Service).interrupt(id)
    expect(calls).toEqual([id])
  }),
)
