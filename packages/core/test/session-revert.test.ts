import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { Agent } from "@aigcfroge/core/agent"
import { Bus } from "@aigcfroge/core/bus"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import { Model } from "@aigcfroge/core/model"
import { Plugin } from "@aigcfroge/core/plugin"
import { Provider } from "@aigcfroge/core/provider"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionInbox } from "@aigcfroge/core/session/inbox"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionInboxTable, SessionMessageTable } from "@aigcfroge/core/session/sql"
import { Snapshot } from "@aigcfroge/core/snapshot"
import { Money } from "@aigcfroge/schema/money"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Global } from "@aigcfroge/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, Session.node, LocationServiceMap.node]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Global.node.replace(tempGlobalLayer),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      offlineModels,
    ],
  ),
)

describe("Session.revert files", () => {
  it.live("commits the insertion cut and clears later completion on a retained reused Assistant", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const session = yield* Session.Service
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const created = yield* session.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      const assistantMessageID = SessionMessage.ID.create()
      const started = {
        sessionID: created.id,
        assistantMessageID,
        agent: Agent.defaultID,
        model: { id: Model.ID.make("test-model"), providerID: Provider.ID.make("test-provider") },
        started: 0,
      }
      const first = yield* bus.publish(SessionEvent.Step.Started, started)
      yield* session.prompt({
        sessionID: created.id,
        id: SessionMessage.ID.make("msg_z_keep"),
        text: "Earlier queue",
        delivery: "queue",
        resume: false,
      })
      const boundary = yield* session.prompt({ sessionID: created.id, text: "Revert this input", resume: false })
      yield* SessionInbox.promote(database.db, bus, created.id, "steer")
      const row = yield* database.db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, boundary.id))
        .get()
      if (!row) return yield* Effect.die(new Error("Revert boundary row missing"))
      yield* bus.publish(SessionEvent.Step.Started, started)
      yield* bus.publish(SessionEvent.Step.Completed, { sessionID: created.id, assistantMessageID })
      yield* session.prompt({
        sessionID: created.id,
        id: SessionMessage.ID.make("msg_a_drop"),
        text: "Later queue",
        delivery: "queue",
        resume: false,
      })
      const retained = yield* database.db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, assistantMessageID))
        .get()
      expect(retained?.seq).toBe(first.durable?.seq)
      expect(yield* session.message({ sessionID: created.id, messageID: assistantMessageID })).toHaveProperty(
        "completion",
      )
      yield* session.revert.stage({ sessionID: created.id, messageID: boundary.id, files: false })
      const invalid = yield* bus
        .publish(SessionEvent.RevertEvent.Committed, {
          sessionID: created.id,
          to: boundary.id,
          boundarySeq: row.seq + 1,
        })
        .pipe(Effect.exit)
      expect(invalid._tag).toBe("Failure")
      expect(yield* session.message({ sessionID: created.id, messageID: assistantMessageID })).toHaveProperty(
        "completion",
      )
      expect(yield* session.message({ sessionID: created.id, messageID: boundary.id })).toBeDefined()
      expect((yield* session.get(created.id)).revert?.messageID).toBe(boundary.id)
      yield* session.revert.commit(created.id)
      expect(yield* session.message({ sessionID: created.id, messageID: assistantMessageID })).not.toHaveProperty(
        "completion",
      )
      expect(yield* session.message({ sessionID: created.id, messageID: boundary.id })).toBeUndefined()
      expect((yield* session.get(created.id)).revert).toBeUndefined()
      const pending = yield* database.db
        .select()
        .from(SessionInboxTable)
        .where(eq(SessionInboxTable.session_id, created.id))
        .all()
      expect(pending.map((item) => String(item.id))).toEqual(["msg_z_keep"])
    }),
  )

  it.live(
    "undoes and restores a file rename without losing either path",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const directory = path.join(tmp.path, "project")
        const original = path.join(directory, "old name.txt")
        const renamed = path.join(directory, "new name.txt")
        yield* Effect.promise(async () => {
          await fs.mkdir(directory)
          await Bun.write(original, "Preserve this content.\n")
          await Bun.write(path.join(directory, "unrelated.txt"), "Unrelated content.\n")
          await $`git init -q`.cwd(directory).quiet()
          await $`git -c core.fsmonitor=false add .`.cwd(directory).quiet()
        })

        const session = yield* Session.Service
        const database = yield* Database.Service
        const bus = yield* Bus.Service
        const created = yield* session.create({ location: { directory: AbsolutePath.make(directory) } })
        const prompt = yield* session.prompt({ sessionID: created.id, text: "Rename the file", resume: false })
        yield* SessionInbox.promote(database.db, bus, created.id, "steer")

        yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          yield* plugins.awaitActivation
          const snapshot = yield* Snapshot.Service
          const before = yield* snapshot.capture()
          if (!before) throw new Error("Initial snapshot missing")
          const assistantMessageID = SessionMessage.ID.create()
          yield* bus.publish(SessionEvent.Step.Started, {
            sessionID: created.id,
            assistantMessageID,
            agent: Agent.defaultID,
            model: { id: Model.ID.make("test-model"), providerID: Provider.ID.make("test-provider") },
            snapshot: before,
            started: 0,
          })
          yield* Effect.promise(() => fs.rename(original, renamed))
          const after = yield* snapshot.capture()
          if (!after) throw new Error("Renamed snapshot missing")
          yield* bus.publish(SessionEvent.Step.Ended, {
            sessionID: created.id,
            assistantMessageID,
            finish: "stop",
            cost: Money.USD.zero,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            snapshot: after,
            files: yield* snapshot.files({ from: before, to: after }),
          })

          yield* Effect.promise(() => Bun.write(path.join(directory, "unrelated.txt"), "Keep this later edit.\n"))
          const reverted = yield* session.revert.stage({ sessionID: created.id, messageID: prompt.id })
          expect({
            original: yield* Effect.promise(() => Bun.file(original).exists()),
            renamed: yield* Effect.promise(() => Bun.file(renamed).exists()),
          }).toEqual({ original: true, renamed: false })
          expect(yield* Effect.promise(() => Bun.file(original).text())).toBe("Preserve this content.\n")
          expect(reverted.files?.map((file) => [file.file, file.status])).toEqual([
            ["new name.txt", "deleted"],
            ["old name.txt", "added"],
          ])
          expect(yield* Effect.promise(() => Bun.file(path.join(directory, "unrelated.txt")).text())).toBe(
            "Keep this later edit.\n",
          )

          yield* session.revert.clear(created.id)
          expect(yield* Effect.promise(() => Bun.file(original).exists())).toBe(false)
          expect(yield* Effect.promise(() => Bun.file(renamed).text())).toBe("Preserve this content.\n")
          expect(yield* Effect.promise(() => Bun.file(path.join(directory, "unrelated.txt")).text())).toBe(
            "Keep this later edit.\n",
          )
          expect((yield* session.get(created.id)).revert).toBeUndefined()
        }).pipe(Effect.provide(LocationServiceMap.Service.get(created.location)))
      }),
    // Real Location/plugin startup and Git snapshots can exceed five seconds under CI load.
    { timeout: 15_000 },
  )
})
