import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { EventTable } from "@aigcfroge/core/event/sql"
import { testEffect } from "./lib/effect"
import {
  makeObservableSignals,
  makeObservableFakeAdapter,
  makeTestLocation,
  makeTestSessionId,
  testDelegationBaseLayer,
  tmpdirScoped,
} from "./delegation-test-support"

const it = testEffect(testDelegationBaseLayer)

const ProbeDurableEvent = EventV2.define({
  type: "delegation.probe.durable",
  durable: {
    version: 1,
    aggregate: "id",
  },
  schema: {
    id: Schema.String,
    payload: Schema.String,
  },
})

describe("delegation test scaffolding (Phase 0)", () => {
  it.effect("fake adapter records signals, preserves result envelope, and tracks cancel", () =>
    Effect.gen(function* () {
      const signals = makeObservableSignals()
      const adapter = makeObservableFakeAdapter(signals, {
        name: "test-cli",
        result: {
          status: "success",
          summary: "done",
          files: { modified: ["src/index.ts"] },
          errors: ["warn-1"],
        },
      })

      const result = yield* adapter.execute!({ prompt: "hello world", cwd: "/test", resumeId: "res_1" })
      expect(result.status).toBe("success")
      expect(result.summary).toBe("done")
      expect(result.files?.modified).toEqual(["src/index.ts"])
      expect(result.errors).toEqual(["warn-1"])
      expect(signals.executeCount).toBe(1)
      expect(signals.prompts).toEqual(["hello world"])
      expect(signals.resumeIds).toEqual(["res_1"])

      if (adapter.cancel) {
        yield* adapter.cancel("/test/cwd")
      }
      expect(signals.controlCalls).toEqual([{ method: "cancel", args: { cwd: "/test/cwd" } }])
    }),
  )

  test("data builders produce valid branded values", () => {
    const sid = makeTestSessionId("ses_custom_1")
    const loc = makeTestLocation("/custom/path")
    expect(String(sid)).toBe("ses_custom_1")
    expect(String(loc.directory)).toBe("/custom/path")
  })

  it.live("tmpdirScoped creates dir, initializes git, and cleans up on scope close", () =>
    Effect.gen(function* () {
      let capturedDir: string | undefined
      yield* Effect.scoped(
        Effect.gen(function* () {
          const dir = yield* tmpdirScoped({ git: true })
          capturedDir = dir
          const stat = yield* Effect.promise(() => fs.stat(dir))
          expect(stat.isDirectory()).toBe(true)

          const gitDir = yield* Effect.promise(() => fs.stat(path.join(dir, ".git")))
          expect(gitDir.isDirectory()).toBe(true)

          const logOutput = yield* Effect.promise(async () => {
            const proc = Bun.spawn(["git", "log", "-1", "--format=%s"], { cwd: dir, stdout: "pipe" })
            return (await new Response(proc.stdout).text()).trim()
          })
          expect(logOutput).toBe("root commit")
        }),
      )

      expect(capturedDir).toBeDefined()
      const existsAfterScope = yield* Effect.promise(async () => {
        try {
          await fs.stat(capturedDir!)
          return true
        } catch {
          return false
        }
      })
      expect(existsAfterScope).toBe(false)
    }),
  )

  it.live("tmpdirScoped creates plain directory and cleans up on scope close", () =>
    Effect.gen(function* () {
      let capturedDir: string | undefined
      yield* Effect.scoped(
        Effect.gen(function* () {
          const dir = yield* tmpdirScoped()
          capturedDir = dir
          const stat = yield* Effect.promise(() => fs.stat(dir))
          expect(stat.isDirectory()).toBe(true)
        }),
      )

      expect(capturedDir).toBeDefined()
      const existsAfterScope = yield* Effect.promise(async () => {
        try {
          await fs.stat(capturedDir!)
          return true
        } catch {
          return false
        }
      })
      expect(existsAfterScope).toBe(false)
    }),
  )

  it.effect("testDelegationBaseLayer performs durable event publish and database readback", () =>
    Effect.gen(function* () {
      const dbService = yield* Database.Service
      const events = yield* EventV2.Service
      const probeID = EventV2.ID.create()

      let commitExecuted = false
      yield* events.publish(
        ProbeDurableEvent,
        { id: probeID, payload: "probe-data" },
        {
          commit: () =>
            Effect.sync(() => {
              commitExecuted = true
            }),
        },
      )
      expect(commitExecuted).toBe(true)

      const rows = yield* dbService.db.select().from(EventTable).where(eq(EventTable.aggregate_id, probeID))

      expect(rows.length).toBe(1)
      expect(rows[0]?.type).toBe("delegation.probe.durable.1")
      expect(rows[0]?.aggregate_id).toBe(probeID)
      expect(rows[0]?.data).toEqual({ id: probeID, payload: "probe-data" })
    }),
  )
})
