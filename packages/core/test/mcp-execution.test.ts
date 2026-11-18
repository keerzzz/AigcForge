import { expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Schema } from "effect"
import path from "node:path"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { filesystem } from "@aigcfroge/util/effect/app-node-platform"
import { Agent } from "@aigcfroge/core/agent"
import { Bus } from "@aigcfroge/core/bus"
import { Database } from "@aigcfroge/core/database/database"
import { Image } from "@aigcfroge/core/image"
import { Location } from "@aigcfroge/core/location"
import { Permission } from "@aigcfroge/core/permission"
import { ApprovalPresence } from "@aigcfroge/core/permission/approval-presence"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { McpConnection } from "@aigcfroge/core/mcp/connection"
import { Tool } from "@aigcfroge/core/tool"
import { McpServerBinding } from "@aigcfroge/schema/mcp-scope"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "./lib/effect"
import { location } from "./fixture/location"
import { tmpdirScoped } from "./fixture/tmpdir"
import { withCustomModeEnabled } from "./lib/product-mode"
import { codeModeListings } from "./lib/tool"

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
      filesystem,
    ]),
    [
      Location.node.replace(Layer.succeed(Location.Service, location({ directory: AbsolutePath.make("/tmp") }))),
      Image.node.replace(Layer.mock(Image.Service, { normalize: (_resource, content) => Effect.succeed(content) })),
    ],
  ),
)
const sessionID = Session.ID.make("ses_mcp_execution")
const agentID = Agent.ID.make("test")
const messageID = SessionMessage.ID.make("msg_mcp_execution")
const action = "mcp_execution_echo"

const setRules = (rules: Permission.Ruleset) =>
  Agent.Service.use((agents) =>
    agents.transform((editor) =>
      editor.update(agentID, (agent) => {
        agent.permissions = [...rules]
      }),
    ),
  )

const setup = (effect: "allow" | "ask", mode: "results" | "pendingcall" = "results") =>
  Effect.gen(function* () {
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
        slug: "mcp",
        directory: AbsolutePath.make("/tmp"),
        title: "MCP execution",
        version: "test",
        mode: "coding",
        agent: agentID,
        attended: null,
      })
      .run()
      .pipe(Effect.orDie)
    yield* setRules([{ action: "*", resource: "*", effect }])
    const tmp = yield* tmpdirScoped()
    const marker = path.join(tmp.path, "called")
    const connection = yield* McpConnection.Service
    yield* connection.connect({
      binding: Schema.decodeUnknownSync(McpServerBinding)({
        serverName: "execution",
        ref: { relativePath: "mcp/execution.json", revision: "a".repeat(64) },
        transport: "stdio",
        command: [process.execPath, path.join(import.meta.dir, "fixture/mcp/fake-mcp-server.mjs"), mode, marker],
      }),
    })
    const permission = yield* Permission.Service
    const tools = yield* Tool.Service
    const snapshot = yield* tools.snapshot(yield* permission.effectiveRules(sessionID, agentID))
    const fs = yield* FileSystem.FileSystem
    return {
      permission,
      snapshot,
      called: fs.exists(marker),
      execute: (
        name = "echo",
        code = `return JSON.stringify(await tools.mcp_execution_${name}({ msg: "allowed" }));`,
      ) =>
        snapshot.execute({
          sessionID,
          agent: agentID,
          messageID,
          call: {
            type: "tool-call",
            id: "call_mcp",
            name: "execute",
            // Serialize inside Code Mode so objects and literal JSON strings stay distinct.
            input: { code },
          },
        }),
    }
  })

it.live("does not send an MCP call when ask has no responder", () =>
  Effect.gen(function* () {
    const test = yield* setup("ask")
    const result = yield* test.execute()
    expect(yield* test.called).toBe(false)
    expect(result.output).toMatchObject({
      error: true,
      output: expect.stringContaining("Permission.RejectedError"),
      toolCalls: [{ tool: action, status: "error", input: { msg: "allowed" } }],
      files: [],
    })
    expect(yield* test.permission.forSession(sessionID)).toHaveLength(0)
  }),
)

for (const reply of ["once", "reject", "correct", "interrupt"] as const) {
  it.live(`authorizes the captured MCP tool before RPC: ${reply}`, () =>
    Effect.gen(function* () {
      const test = yield* setup("ask")
      yield* ApprovalPresence.Service.use((presence) => presence.bindResponder({ custom: true }))
      const asked = yield* Deferred.make<Permission.Request>()
      const bus = yield* Bus.Service
      const unsubscribe = yield* bus.listen((event) =>
        event.type === Permission.Event.Asked.type
          ? Deferred.succeed(asked, Schema.decodeUnknownSync(Permission.Request)(event.data)).pipe(Effect.asVoid)
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const fiber = yield* test
        .execute(
          "echo",
          reply === "reject" || reply === "interrupt"
            ? 'try { await tools.mcp_execution_echo({ msg: "allowed" }); } catch { return "swallowed"; } return "continued";'
            : undefined,
        )
        .pipe(Effect.forkScoped)
      const request = yield* awaitWithTimeout(Deferred.await(asked), "MCP did not ask before calling")
      expect(request).toMatchObject({
        sessionID,
        action,
        resources: ["*"],
        save: ["*"],
        source: { type: "tool", messageID, id: "call_mcp" },
      })
      expect(yield* test.called).toBe(false)
      if (reply === "interrupt") {
        yield* Fiber.interrupt(fiber)
        const exit = yield* Fiber.await(fiber)
        expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
        expect(yield* test.called).toBe(false)
        expect(yield* test.permission.forSession(sessionID)).toHaveLength(0)
        return
      }
      yield* test.permission.reply({
        requestID: request.id,
        reply: reply === "correct" ? "reject" : reply,
        ...(reply === "correct" ? { message: "use another tool" } : {}),
      })
      const exit = yield* Fiber.await(fiber)
      expect(yield* test.called).toBe(reply === "once")
      expect(yield* test.permission.forSession(sessionID)).toHaveLength(0)
      if (reply === "once") {
        expect(Exit.isSuccess(exit) && exit.value.output).toEqual({
          output: JSON.stringify("echo:allowed"),
          toolCalls: [{ tool: action, status: "completed", input: { msg: "allowed" } }],
          files: [],
        })
        return
      }
      if (reply === "correct") {
        expect(Exit.isSuccess(exit) && exit.value.output).toMatchObject({
          error: true,
          output: expect.stringContaining("use another tool"),
          toolCalls: [{ tool: action, status: "error", input: { msg: "allowed" } }],
          files: [],
        })
        return
      }
      // A decline without feedback terminates execution through Permission's defect tunnel.
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(Permission.DeclinedError)
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
    }),
  )
}

it.live("interrupts an in-flight MCP RPC even when the script catches tool errors", () =>
  Effect.gen(function* () {
    const test = yield* setup("allow", "pendingcall")
    const fiber = yield* test
      .execute(
        "echo",
        'try { await tools.mcp_execution_echo({ msg: "allowed" }); } catch { return "swallowed"; } return "continued";',
      )
      .pipe(Effect.forkScoped)
    yield* pollWithTimeout(
      test.called.pipe(Effect.map((called) => (called ? true : undefined))),
      "MCP never received the pending call",
    )
    yield* Fiber.interrupt(fiber)
    const exit = yield* Fiber.await(fiber)
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    expect(yield* test.permission.forSession(sessionID)).toHaveLength(0)
    const connection = yield* McpConnection.Service
    expect(yield* connection.health("execution")).toBe("ready")
    yield* connection.disconnect("execution")
    expect(yield* connection.connections()).toHaveLength(0)
  }),
)

it.live("keeps Code Mode defects out of script catches and concurrent uses of one snapshot", () =>
  Effect.gen(function* () {
    const test = yield* setup("allow")
    const registry = yield* Tool.Service
    const faultStarted = yield* Deferred.make<void>()
    const survivorStarted = yield* Deferred.make<void>()
    const faultRelease = yield* Deferred.make<void>()
    const survivorRelease = yield* Deferred.make<void>()
    const defect = new Error("executor defect")
    yield* registry.transform((editor) => {
      editor.add({
        name: "fault",
        description: "Fault after readiness",
        input: Schema.Struct({}),
        execute: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(faultStarted, undefined)
            yield* Deferred.await(faultRelease)
            return yield* Effect.die(defect)
          }),
      })
      editor.add({
        name: "survivor",
        description: "Wait for an independent completion",
        input: Schema.Struct({}),
        execute: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(survivorStarted, undefined)
            yield* Deferred.await(survivorRelease)
            return { content: "survived" }
          }),
      })
    })
    const snapshot = yield* registry.snapshot()
    const execute = (id: string, code: string) =>
      snapshot.execute({
        sessionID,
        agent: agentID,
        messageID,
        call: { type: "tool-call", id, name: "execute", input: { code } },
      })
    const failed = yield* execute(
      "call_fault",
      'try { await tools.fault({}); } catch { return "swallowed"; } return "continued";',
    ).pipe(Effect.forkScoped)
    yield* awaitWithTimeout(Deferred.await(faultStarted), "Code Mode fault did not start")
    const survived = yield* execute("call_survivor", "return await tools.survivor({});").pipe(Effect.forkScoped)
    yield* awaitWithTimeout(Deferred.await(survivorStarted), "Concurrent Code Mode call did not start")
    yield* Deferred.succeed(faultRelease, undefined)
    const failedExit = yield* awaitWithTimeout(Fiber.await(failed), "Code Mode swallowed the executor defect")
    expect(Exit.isFailure(failedExit) && Cause.hasDies(failedExit.cause)).toBe(true)
    expect(Exit.isFailure(failedExit) && Cause.hasInterrupts(failedExit.cause)).toBe(false)
    expect(Exit.isFailure(failedExit) && Cause.squash(failedExit.cause)).toBe(defect)
    yield* Deferred.succeed(survivorRelease, undefined)
    const survivedExit = yield* awaitWithTimeout(Fiber.await(survived), "Independent Code Mode call did not finish")
    expect(Exit.isSuccess(survivedExit) && survivedExit.value.output).toEqual({
      output: "survived",
      toolCalls: [{ tool: "survivor", status: "completed" }],
      files: [],
    })
    expect(yield* test.called).toBe(false)
  }),
)

it.live("allows scripts to handle expected MCP tool errors", () =>
  Effect.gen(function* () {
    const test = yield* setup("allow")
    const result = yield* test.execute(
      "error",
      'try { await tools.mcp_execution_error({ msg: "allowed" }); } catch { return "handled"; } return "continued";',
    )
    expect(result.output).toEqual({
      output: "handled",
      toolCalls: [{ tool: "mcp_execution_error", status: "error", input: { msg: "allowed" } }],
      files: [],
    })
    expect(yield* test.called).toBe(true)
  }),
)

it.live("keeps normal Code Mode completion when cleanup interrupts an unawaited child", () =>
  Effect.gen(function* () {
    const test = yield* setup("allow")
    const registry = yield* Tool.Service
    const started = yield* Deferred.make<void>()
    const stopped = yield* Deferred.make<void>()
    yield* registry.transform((editor) => {
      editor.add({
        name: "pending",
        description: "A child interrupted when its script returns",
        input: Schema.Struct({}),
        execute: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined)
            return yield* Effect.never
          }).pipe(Effect.ensuring(Deferred.succeed(stopped, undefined).pipe(Effect.asVoid))),
      })
      editor.add({
        name: "ready",
        description: "Confirm that the child is running",
        input: Schema.Struct({}),
        execute: () => Deferred.await(started).pipe(Effect.as({ content: "ready" })),
      })
    })
    const snapshot = yield* registry.snapshot()
    const result = yield* snapshot.execute({
      sessionID,
      agent: agentID,
      messageID,
      call: {
        type: "tool-call",
        id: "call_cleanup",
        name: "execute",
        input: { code: 'tools.pending({}); await tools.ready({}); return "done";' },
      },
    })
    expect(result.output).toMatchObject({ output: "done", files: [] })
    yield* awaitWithTimeout(Deferred.await(stopped), "Code Mode child survived script completion")
    expect(yield* test.called).toBe(false)
  }),
)

it.live("a captured visible MCP tool still checks the current leaf deny rule", () =>
  Effect.gen(function* () {
    const test = yield* setup("allow")
    expect(test.snapshot.definitions.map((tool) => tool.name)).toEqual(["execute"])
    expect(test.snapshot.catalog.find((tool) => tool.name === action)?.placement).toBe("codemode")
    if (test.snapshot.codeModeCatalog === undefined) throw new Error("Missing MCP Code Mode discovery")
    expect(codeModeListings(test.snapshot.codeModeCatalog).map((tool) => tool.path)).toContain(action)
    yield* setRules([
      { action: "*", resource: "*", effect: "allow" },
      { action, resource: "*", effect: "deny" },
    ])
    const result = yield* test.execute()
    expect(yield* test.called).toBe(false)
    expect(result.output).toMatchObject({
      error: true,
      output: expect.stringContaining("Permission.BlockedError"),
      toolCalls: [{ tool: action, status: "error", input: { msg: "allowed" } }],
      files: [],
    })
  }),
)

for (const [name, output] of [
  ["echo", "echo:allowed"],
  ["json", { count: 1 }],
  ["literal", '{"count":1}'],
  ["structured", { count: 1 }],
  ["raw", { count: "raw" }],
  ["empty", null],
  ["mixed", "image"],
] as const) {
  it.live(`settles MCP ${name} through the real Tool snapshot`, () =>
    Effect.gen(function* () {
      const test = yield* setup("allow")
      const result = yield* test.execute(name)
      expect(yield* test.called).toBe(true)
      expect(result.output).toEqual({
        output: JSON.stringify(output),
        toolCalls: [{ tool: `mcp_execution_${name}`, status: "completed", input: { msg: "allowed" } }],
        files: name === "mixed" ? [{ data: "aGVsbG8=", mime: "image/png" }] : [],
      })
      if (name === "mixed")
        expect(result.content).toContainEqual({
          type: "file",
          uri: "data:image/png;base64,aGVsbG8=",
          mime: "image/png",
        })
    }),
  )
}

it.live("returns MCP error output as a failed Code Mode child call", () =>
  Effect.gen(function* () {
    const test = yield* setup("allow")
    const result = yield* test.execute("error")
    expect(yield* test.called).toBe(true)
    expect(result.output).toMatchObject({
      error: true,
      output: expect.stringContaining("remote failure"),
      toolCalls: [{ tool: "mcp_execution_error", status: "error", input: { msg: "allowed" } }],
      files: [],
    })
  }),
)
