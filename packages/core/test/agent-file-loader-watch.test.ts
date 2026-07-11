import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { AgentV2 } from "@aigcfroge/core/agent"
import { AgentFileLoader } from "@aigcfroge/core/agent/file-loader"
import { EventV2 } from "@aigcfroge/core/event"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Watcher } from "@aigcfroge/core/filesystem/watcher"
import { Location } from "@aigcfroge/core/location"
import { Project } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { pollWithTimeout } from "./lib/effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const agentFileLoaderLayer = AgentFileLoader.layer.pipe(Layer.provide(FSUtil.defaultLayer))
const agentsLayer = AgentV2.fileLayer.pipe(Layer.provide(agentFileLoaderLayer))

const makeLayer = (directory: string) =>
  Layer.mergeAll(
    agentsLayer,
    Layer.succeed(
      Location.Service,
      Location.Service.of({
        directory: AbsolutePath.make(directory),
        workspaceID: undefined,
        project: { id: Project.ID.make("test"), directory: AbsolutePath.make(directory) },
      }),
    ),
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(EventV2.defaultLayer, agentFileLoaderLayer).pipe(Layer.provide(FSUtil.defaultLayer)),
    ),
  )

describe("AgentV2 file watcher refresh", () => {
  test("reloads file agents when .agent.md changes", async () => {
    const originalFlag = process.env.AIGCFROGE_ENABLE_AGENT_FILE
    process.env.AIGCFROGE_ENABLE_AGENT_FILE = "1"

    const dirpath = path.join(os.tmpdir(), "aigcfroge-agent-watch-" + Math.random().toString(36).slice(2))
    await fs.mkdir(dirpath, { recursive: true })
    const dir = await fs.realpath(dirpath)
    const agentsDir = path.join(dir, ".claude", "agents")
    await fs.mkdir(agentsDir, { recursive: true })

    const agentFile = path.join(agentsDir, "reviewer.agent.md")
    await Bun.write(
      agentFile,
      ["---", "name: reviewer", "description: Original", "tools:", "  - read", "---", "", "You review code."].join("\n"),
    )

    const originalCwd = process.cwd()
    try {
      process.chdir(dir)
      const layer = makeLayer(dir)
      await Effect.runPromise(
        Effect.gen(function* () {
          const agents = yield* AgentV2.Service
          const events = yield* EventV2.Service

          const before = yield* agents.get(AgentV2.ID.make("reviewer"))
          expect(before?.description).toBe("Original")

          yield* Effect.promise(() =>
            Bun.write(
              agentFile,
              ["---", "name: reviewer", "description: Updated", "tools:", "  - read", "---", "", "You review code."].join("\n"),
            ),
          )

          // Keep an inline subscription alive so the EventV2 typed pubsub is created
          // before the watcher event is published.
          yield* events
            .subscribe(Watcher.Event.Updated)
            .pipe(Stream.runForEach(() => Effect.void), Effect.forkScoped)
          yield* Effect.yieldNow

          yield* events.publish(Watcher.Event.Updated, { file: ".claude/agents/reviewer.agent.md", event: "change" })

          const after = yield* pollWithTimeout(
            Effect.gen(function* () {
              const agent = yield* agents.get(AgentV2.ID.make("reviewer"))
              return agent?.description === "Updated" ? agent : undefined
            }),
            "timed out waiting for agent file reload",
            "2 seconds",
          )
          expect(after.description).toBe("Updated")
        }).pipe(Effect.scoped, Effect.provide(layer)),
      )
    } finally {
      process.chdir(originalCwd)
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
      if (originalFlag === undefined) delete process.env.AIGCFROGE_ENABLE_AGENT_FILE
      else process.env.AIGCFROGE_ENABLE_AGENT_FILE = originalFlag
    }
  })
})
