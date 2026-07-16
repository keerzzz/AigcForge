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

const makeLayer = (directory: string) => {
  const locationLayer = Layer.succeed(
    Location.Service,
    Location.Service.of({
      directory: AbsolutePath.make(directory),
      workspaceID: undefined,
      project: { id: Project.ID.make("test"), directory: AbsolutePath.make(directory) },
    }),
  )
  const fileLoaderLayer = AgentFileLoader.layer.pipe(
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(locationLayer),
  )
  const agentsLayer = AgentV2.fileLayer.pipe(
    Layer.provide(fileLoaderLayer),
    Layer.provideMerge(EventV2.defaultLayer),
  )
  return Layer.mergeAll(agentsLayer, locationLayer)
}

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

  test("loads newly added .agent.md file via watcher add event", async () => {
    const originalFlag = process.env.AIGCFROGE_ENABLE_AGENT_FILE
    process.env.AIGCFROGE_ENABLE_AGENT_FILE = "1"

    const dirpath = path.join(os.tmpdir(), "aigcfroge-agent-add-" + Math.random().toString(36).slice(2))
    await fs.mkdir(dirpath, { recursive: true })
    const dir = await fs.realpath(dirpath)
    const agentsDir = path.join(dir, ".claude", "agents")
    await fs.mkdir(agentsDir, { recursive: true })

    // Start with one existing agent so loadAll has work; the new one is added mid-session.
    await Bun.write(
      path.join(agentsDir, "reviewer.agent.md"),
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

          // Precondition: reviewer exists, optimizer does not
          const reviewer = yield* agents.get(AgentV2.ID.make("reviewer"))
          expect(reviewer?.description).toBe("Original")
          expect(yield* agents.get(AgentV2.ID.make("optimizer"))).toBeUndefined()

          // Add a brand new agent file while the session is "running"
          yield* Effect.promise(() =>
            Bun.write(
              path.join(agentsDir, "optimizer.agent.md"),
              ["---", "name: optimizer", "description: Optimizes code", "tools:", "  - read", "---", "", "You optimize code."].join("\n"),
            ),
          )

          // Keep an inline subscription alive so the EventV2 typed pubsub is created
          // before the watcher event is published.
          yield* events
            .subscribe(Watcher.Event.Updated)
            .pipe(Stream.runForEach(() => Effect.void), Effect.forkScoped)
          yield* Effect.yieldNow

          // Watcher emits Event.Updated with event "add" for newly created files (watcher.ts:94).
          // fileLayer filters *.agent.md and calls agents.reload() -> loadAll rescans the dir.
          yield* events.publish(Watcher.Event.Updated, { file: ".claude/agents/optimizer.agent.md", event: "add" })

          const added = yield* pollWithTimeout(
            Effect.gen(function* () {
              const agent = yield* agents.get(AgentV2.ID.make("optimizer"))
              return agent?.description === "Optimizes code" ? agent : undefined
            }),
            "timed out waiting for newly added agent file to load",
            "2 seconds",
          )
          expect(added.description).toBe("Optimizes code")
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
