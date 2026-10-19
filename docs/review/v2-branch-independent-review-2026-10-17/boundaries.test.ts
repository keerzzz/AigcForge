import { expect } from "bun:test"
import { Cause, Effect, Exit, Layer, Schema, Stream } from "effect"
import { AppNodeBuilder } from "/home/keer/workspace/aigcfroge-v2/packages/core/src/effect/app-node-builder"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Agent } from "/home/keer/workspace/aigcfroge-v2/packages/core/src/agent"
import { Bus } from "/home/keer/workspace/aigcfroge-v2/packages/core/src/bus"
import { Database } from "/home/keer/workspace/aigcfroge-v2/packages/core/src/database/database"
import { Image } from "/home/keer/workspace/aigcfroge-v2/packages/core/src/image"
import { Location } from "/home/keer/workspace/aigcfroge-v2/packages/core/src/location"
import { Permission } from "/home/keer/workspace/aigcfroge-v2/packages/core/src/permission"
import { ApprovalPresence } from "/home/keer/workspace/aigcfroge-v2/packages/core/src/permission/approval-presence"
import { Project } from "/home/keer/workspace/aigcfroge-v2/packages/core/src/project"
import { ProjectTable } from "/home/keer/workspace/aigcfroge-v2/packages/core/src/project/sql"
import { AbsolutePath } from "/home/keer/workspace/aigcfroge-v2/packages/core/src/schema"
import { Session } from "/home/keer/workspace/aigcfroge-v2/packages/core/src/session"
import { SessionTable } from "/home/keer/workspace/aigcfroge-v2/packages/core/src/session/sql"
import { SessionMessage } from "/home/keer/workspace/aigcfroge-v2/packages/core/src/session/message"
import { McpConnection } from "/home/keer/workspace/aigcfroge-v2/packages/core/src/mcp/connection"
import { Tool } from "/home/keer/workspace/aigcfroge-v2/packages/core/src/tool"
import { McpServerBinding } from "@aigcfroge/schema/mcp-scope"
import { Event } from "@aigcfroge/schema/event"
import { EventFeed } from "/home/keer/workspace/aigcfroge-v2/packages/server/src/event-feed.ts"
import { testEffect } from "/home/keer/workspace/aigcfroge-v2/packages/core/test/lib/effect.ts"
import { location } from "/home/keer/workspace/aigcfroge-v2/packages/core/test/fixture/location.ts"
import { withCustomModeEnabled } from "/home/keer/workspace/aigcfroge-v2/packages/core/test/lib/product-mode.ts"

withCustomModeEnabled()

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      Agent.node,
      ApprovalPresence.node,
      Permission.node,
      McpConnection.node,
      Tool.node,
    ]),
    [
      Location.node.replace(Layer.succeed(Location.Service, location({ directory: AbsolutePath.make("/tmp") }))),
      Image.node.replace(Layer.mock(Image.Service, { normalize: (_resource, content) => Effect.succeed(content) })),
    ],
  ),
)

const sessionID = Session.ID.make("ses_review_boundary")
const agentID = Agent.ID.make("test")
const setup = Effect.gen(function* () {
  const database = yield* Database.Service
  yield* database.db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/tmp"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* database.db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "review",
      directory: AbsolutePath.make("/tmp"),
      title: "review",
      version: "test",
      mode: "coding",
      agent: agentID,
      attended: null,
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  const agents = yield* Agent.Service
  yield* agents.transform((editor) =>
    editor.update(agentID, (agent) => {
      agent.permissions = [{ action: "*", resource: "*", effect: "ask" }]
    }),
  )
})

it.live("a live production event-feed subscriber must make permission asks answerable", () =>
  Effect.gen(function* () {
    yield* setup
    const bus = yield* Bus.Service
    const feed = yield* EventFeed.make(bus.listen)
    const stream = yield* feed.subscribe
    yield* bus.publish(Agent.Event.Updated, {})
    const frames = yield* stream.pipe(Stream.take(1), Stream.runCollect)
    expect(Array.from(frames)).toHaveLength(1)
    const presence = yield* ApprovalPresence.Service
    const present = yield* presence.hasResponder({ location: { directory: AbsolutePath.make("/tmp") }, mode: "coding" })
    const permission = yield* Permission.Service
    const result = yield* permission
      .assert({ sessionID, agent: agentID, action: "shell", resources: ["echo review"] })
      .pipe(Effect.exit)
    console.log(
      "SSE_REPRO",
      JSON.stringify({
        receivedFrames: Array.from(frames).length,
        present,
        failure: Exit.isFailure(result) ? Cause.squash(result.cause) : null,
      }),
    )
    expect(present).toBe(true)
  }),
)

it.live("a registered MCP tool with ask policy must not execute before approval", () =>
  Effect.gen(function* () {
    yield* setup
    const marker = "/tmp/v2-approval-20261017/unauthorized-call-marker"
    const markerFile = Bun.file(marker)
    if (yield* Effect.promise(() => markerFile.exists())) yield* Effect.promise(() => markerFile.delete())
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        if (await markerFile.exists()) await markerFile.delete()
      }),
    )
    const connection = yield* McpConnection.Service
    yield* connection.connect({
      binding: Schema.decodeUnknownSync(McpServerBinding)({
        serverName: "review",
        ref: { relativePath: "mcp/review.json", revision: "a".repeat(64) },
        transport: "stdio",
        command: [process.execPath, "/tmp/v2-approval-20261017/mcp-marker.mjs", "ok", marker],
      }),
    })
    const permission = yield* Permission.Service
    const rules = yield* permission.effectiveRules(sessionID, agentID)
    expect(Permission.evaluate("mcp_review_echo", "*", rules).effect).toBe("ask")
    const tools = yield* Tool.Service
    const snapshot = yield* tools.snapshot(rules)
    const result = yield* snapshot
      .execute({
        sessionID,
        agent: agentID,
        messageID: SessionMessage.ID.make("msg_review"),
        call: { type: "tool-call", id: "review", name: "mcp_review_echo", input: { msg: "unauthorized" } },
      })
      .pipe(Effect.exit)
    const called = yield* Effect.promise(() => markerFile.exists())
    console.log(
      "MCP_AUTH_REPRO",
      JSON.stringify({
        policy: "ask",
        externalCallReached: called,
        result,
        pending: yield* permission.forSession(sessionID),
      }),
    )
    expect(called).toBe(false)
  }),
)

it.live("a successfully returning MCP tool must settle through the production registry", () =>
  Effect.gen(function* () {
    yield* setup
    const connection = yield* McpConnection.Service
    yield* connection.connect({
      binding: Schema.decodeUnknownSync(McpServerBinding)({
        serverName: "settle",
        ref: { relativePath: "mcp/settle.json", revision: "b".repeat(64) },
        transport: "stdio",
        command: [
          process.execPath,
          "/home/keer/workspace/aigcfroge-v2/packages/core/test/fixture/mcp/fake-mcp-server.mjs",
          "ok",
        ],
      }),
    })
    const tools = yield* Tool.Service
    const snapshot = yield* tools.snapshot([{ action: "*", resource: "*", effect: "allow" }])
    const result = yield* snapshot
      .execute({
        sessionID,
        agent: agentID,
        messageID: SessionMessage.ID.make("msg_settle"),
        call: { type: "tool-call", id: "settle", name: "mcp_settle_echo", input: { msg: "authorized" } },
      })
      .pipe(Effect.exit)
    console.log("MCP_OUTPUT_REPRO", JSON.stringify(result))
    expect(Exit.isSuccess(result)).toBe(true)
  }),
)
