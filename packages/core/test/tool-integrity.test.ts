import { expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Layer, Result, Schema, Stream } from "effect"
import { LLMClient } from "@aigcfroge/ai"
import { TestLLM } from "@aigcfroge/ai/testing"
import { makeGlobalNode } from "@aigcfroge/util/effect/app-node"
import { Document, Info } from "@aigcfroge/schema/config"
import { ConfigMeta } from "../src/config/meta"
import { Config } from "../src/config"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNodePlatform } from "../src/effect/app-node-platform"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Global } from "@aigcfroge/util/global"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { Plugin } from "../src/plugin"
import { PluginHooks } from "../src/plugin/hooks"
import { PluginInternal } from "../src/plugin/internal"
import { ToolIntegrityPlugin } from "../src/plugin/tool-integrity"
import { AgentPlugin } from "../src/plugin/agent"
import { WriteTool } from "../src/tool/plugin/write"
import { ReadTool } from "../src/tool/plugin/read"
import { PatchTool } from "../src/tool/plugin/patch"
import { Tool } from "../src/tool"
import { Location } from "../src/location"
import { LocationServiceMap } from "../src/location-service-map"
import { AbsolutePath } from "../src/schema"
import { Model } from "../src/model"
import { Provider } from "../src/provider"
import { Agent } from "../src/agent"
import { Mcp } from "../src/mcp"
import { Database } from "../src/database/database"
import { ProjectTable } from "../src/project/sql"
import { Project } from "@aigcfroge/schema/project"
import { SessionSchema } from "../src/session/schema"
import { SessionEvent } from "../src/session/event"
import { Session } from "../src/session"
import { SessionExecution } from "../src/session/execution"
import { SessionInputResult } from "../src/session/input-result"
import { CorrectionStore } from "../src/session/correction-store"
import { Bus } from "../src/bus"
import { tempLocationLayer } from "./fixture/location"
import { tempGlobalLayer } from "./fixture/global"
import { emptyMcpLayer } from "./fixture/mcp"
import { offlineModels, useOfflineCatalog } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { awaitWithTimeout, testEffect } from "./lib/effect"
import { executeTool, toolIdentity } from "./lib/tool"

const checks = (meta: ConfigMeta.Info = ConfigMeta.Info.make({})) =>
  testEffect(
    AppNodeBuilder.build(LayerNode.group([Plugin.node, PluginInternal.requirements, Database.node, PluginHooks.node]), [
      offlineModels,
      Location.node.replace(tempLocationLayer),
      Global.node.replace(tempGlobalLayer),
      Config.node.replace(Config.testLayer([new Document({ type: "document", info: Info.make({ meta }) })])),
      Bus.node.replace(Bus.configured({ persist: true })),
      Mcp.node.replace(emptyMcpLayer),
    ]),
  )
const it = checks()
const timeout = checks(ConfigMeta.Info.make({ verifier: ConfigMeta.Verifier.make({ timeout_ms: 25 }) }))
const tsgo = path.resolve(import.meta.dirname, "../../../node_modules/.bin/tsgo")

const setup = Effect.fnUntraced(function* (denyDoom = false) {
  const plugins = yield* Plugin.Service
  const tools = yield* Tool.Service
  const fs = yield* FSUtil.Service
  const location = yield* Location.Service
  const db = (yield* Database.Service).db
  const bus = yield* Bus.Service
  const store = yield* CorrectionStore.Service
  const internal = yield* PluginInternal.list()
  const selected = [
    AgentPlugin.Plugin.id,
    WriteTool.Plugin.id,
    ReadTool.Plugin.id,
    PatchTool.Plugin.id,
    ToolIntegrityPlugin.Plugin.id,
  ]
  const generations = internal.pre
    .filter((plugin) => selected.includes(plugin.id))
    .map((plugin) => ({ ...plugin, revision: "integrity-v1" }))
  expect(generations).toHaveLength(5)
  yield* plugins.activate(generations)
  const sessionID = SessionSchema.ID.create()
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: location.directory, sandboxes: [] })
    .onConflictDoNothing()
    .run()
  yield* bus.publish(SessionEvent.Created, {
    sessionID,
    projectID: Project.ID.global,
    location: { directory: location.directory },
    slug: sessionID,
    title: "Tool integrity",
    version: "test",
    agent: toolIdentity.agent,
    permissions: [
      { action: "*", resource: "*", effect: "allow" },
      ...(denyDoom ? [{ action: "doom_loop", resource: "*", effect: "deny" as const }] : []),
    ],
  })
  const write = (file: string, content: string, id = "integrity-write") =>
    executeTool(tools, {
      sessionID,
      ...toolIdentity,
      call: { type: "tool-call", id, name: "write", input: { path: file, content } },
    })
  return { plugins, tools, fs, location, bus, store, sessionID, write, generations }
})

it.live("connects real write output to shared CorrectionStore without publishing a completed Step", () =>
  Effect.gen(function* () {
    const f = yield* setup()
    const result = yield* f.write("guide.md", "See [missing](./missing.md).\n")
    expect(result.status).toBe("completed")
    expect(
      result.content
        ?.filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n"),
    ).toContain("./missing.md")
    expect((yield* f.store.facts(f.sessionID)).some((fact) => fact.key === "ref:./missing.md")).toBe(true)
    const events = yield* f.bus.log({ aggregateID: f.sessionID }).pipe(Stream.runCollect)
    expect(
      events.filter((event) => !Bus.isSynced(event) && event.type === SessionEvent.Step.Completed.type),
    ).toHaveLength(0)
  }),
)

it.live(
  "MC04b attaches actual package status, change signature and invocation source to L0 metadata",
  () =>
    Effect.gen(function* () {
      const f = yield* setup()
      yield* f.fs.writeWithDirs(
        path.join(f.location.directory, "package.json"),
        JSON.stringify({
          packageManager: "bun@1.4.2",
          scripts: { typecheck: `${JSON.stringify(tsgo)} --noEmit --skipLibCheck --target esnext input.ts` },
        }),
      )
      const failed = yield* f.write("input.ts", "export const value: string = 1\n", "mc04b-actual-failure")
      expect(failed.status).toBe("completed")
      expect(failed.metadata?.verification).toMatchObject({
        sessionID: f.sessionID,
        status: "failed",
        source: { type: "tool", messageID: toolIdentity.messageID, id: "mc04b-actual-failure" },
        packages: [{ directory: f.location.directory, status: "failed", executed: true, exitCode: 2 }],
      })
      expect(failed.content?.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n")).toContain(`[验证来源] verification.source=${JSON.stringify({ messageID: toolIdentity.messageID, id: "mc04b-actual-failure" })}`)
      const passed = yield* f.write("input.ts", 'export const value: string = "fixed"\n', "mc04b-actual-repair")
      expect(passed.metadata?.verification).toMatchObject({
        status: "passed",
        packages: [{ status: "passed", executed: true, exitCode: 0 }],
      })
      expect(passed.content?.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n")).toContain(`[验证来源] verification.source=${JSON.stringify({ messageID: toolIdentity.messageID, id: "mc04b-actual-repair" })}`)
      expect(failed.metadata?.verification).not.toEqual(passed.metadata?.verification)
    }),
  30_000,
)

it.live(
  "runs the declared package check after real writes and retains failed then passed durable events",
  () =>
    Effect.gen(function* () {
      const f = yield* setup()
      const directory = path.join(f.location.directory, "packages", "sample")
      yield* f.fs.writeWithDirs(
        path.join(directory, "package.json"),
        JSON.stringify({
          packageManager: "bun@1.4.2",
          scripts: { typecheck: `${JSON.stringify(tsgo)} --noEmit --skipLibCheck --target esnext input.ts` },
        }),
      )
      const failed = yield* f.write("packages/sample/input.ts", "export const value: string = 1\n", "bad-code")
      expect(failed.status).toBe("completed")
      expect(
        failed.content
          ?.filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n"),
      ).toContain("typecheck 失败")
      expect((yield* f.store.facts(f.sessionID)).some((fact) => fact.key === `verify:${directory}`)).toBe(true)
      const passed = yield* f.write("packages/sample/input.ts", 'export const value: string = "fixed"\n', "fixed-code")
      expect(passed.status).toBe("completed")
      expect(
        passed.content
          ?.filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n"),
      ).toContain("typecheck 通过")
      const events = yield* f.bus.log({ aggregateID: f.sessionID }).pipe(Stream.runCollect)
      expect(
        events
          .filter((event) => !Bus.isSynced(event) && event.type.startsWith("session.next.verify."))
          .map((event) => event.type),
      ).toEqual([
        SessionEvent.Verify.Started.type,
        SessionEvent.Verify.Failed.type,
        SessionEvent.Verify.Started.type,
        SessionEvent.Verify.Passed.type,
      ])
    }),
  30_000,
)

it.live("reports an unavailable executable without recording a code correction", () =>
  Effect.gen(function* () {
    const f = yield* setup()
    yield* f.fs.writeWithDirs(
      path.join(f.location.directory, "package.json"),
      JSON.stringify({ packageManager: "bun@1.4.2", scripts: { typecheck: "mc04a-nonexistent-typechecker" } }),
    )
    const result = yield* f.write("input.ts", "export const value = 1\n")
    expect(result.status).toBe("completed")
    expect(
      result.content
        ?.filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n"),
    ).toContain("执行不可用")
    expect((yield* f.store.facts(f.sessionID)).filter((fact) => fact.key.startsWith("verify:"))).toHaveLength(0)
  }),
)

it.live("MC04b retains passed packages when another actual package check is unavailable", () =>
  Effect.gen(function* () {
    const f = yield* setup()
    yield* f.fs.writeWithDirs(path.join(f.location.directory, "packages/first/package.json"), JSON.stringify({ packageManager: "bun@1.4.2", scripts: { typecheck: "bun -e 'process.exit(0)'" } }))
    yield* f.fs.writeWithDirs(path.join(f.location.directory, "packages/second/package.json"), JSON.stringify({ packageManager: "bun@1.4.2", scripts: { typecheck: "mc04b-nonexistent-typechecker" } }))
    const result = yield* executeTool(f.tools, { sessionID: f.sessionID, ...toolIdentity, call: { type: "tool-call", id: "mc04b-partial-packages", name: "patch", input: { patchText: "*** Begin Patch\n*** Add File: packages/first/input.ts\n+export const first = 1\n*** Add File: packages/second/input.ts\n+export const second = 2\n*** End Patch" } } })
    expect(result.status).toBe("completed")
    expect(result.metadata?.verification).toMatchObject({ status: "unavailable", packages: [{ status: "passed", executed: true, exitCode: 0 }, { status: "unavailable", executed: true, exitCode: 127 }] })
    expect((yield* f.store.facts(f.sessionID)).filter((fact) => fact.key.startsWith("verify:"))).toHaveLength(0)
  }),
)

it.live("deduplicates one package in a real multi-file patch", () =>
  Effect.gen(function* () {
    const f = yield* setup()
    yield* f.fs.writeWithDirs(
      path.join(f.location.directory, "package.json"),
      JSON.stringify({ packageManager: "bun@1.4.2", scripts: { typecheck: "bun -e 'process.exit(0)'" } }),
    )
    const result = yield* executeTool(f.tools, {
      sessionID: f.sessionID,
      ...toolIdentity,
      call: {
        type: "tool-call",
        id: "two-files",
        name: "patch",
        input: {
          patchText:
            "*** Begin Patch\n*** Add File: first.ts\n+export const first = 1\n*** Add File: second.ts\n+export const second = 2\n*** End Patch",
        },
      },
    })
    expect(result.status).toBe("completed")
    const events = yield* f.bus.log({ aggregateID: f.sessionID }).pipe(Stream.runCollect)
    expect(
      events.filter((event) => !Bus.isSynced(event) && event.type === SessionEvent.Verify.Started.type),
    ).toHaveLength(1)
    expect(
      events.filter((event) => !Bus.isSynced(event) && event.type === SessionEvent.Verify.Passed.type),
    ).toHaveLength(1)
  }),
)

it.live("unregisters the real integrity hooks when their plugin generation is removed", () =>
  Effect.gen(function* () {
    const f = yield* setup()
    yield* f.plugins.activate(f.generations.filter((plugin) => plugin.id !== ToolIntegrityPlugin.Plugin.id))
    const result = yield* f.write("guide.md", "See [missing](./missing.md).\n")
    expect(result.status).toBe("completed")
    expect(
      result.content
        ?.filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n"),
    ).not.toContain("引用检查")
    expect(yield* f.store.facts(f.sessionID)).toHaveLength(0)
  }),
)

it.live("uses current DoomLoop denial and resets its scoped history on plugin reload", () =>
  Effect.gen(function* () {
    const f = yield* setup(true)
    yield* f.fs.writeWithDirs(path.join(f.location.directory, "same.txt"), "unchanged")
    const read = (id: string) =>
      executeTool(f.tools, {
        sessionID: f.sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id, name: "read", input: { path: "same.txt" } },
      })
    expect((yield* read("read-one")).status).toBe("completed")
    expect((yield* read("read-two")).status).toBe("completed")
    expect((yield* read("read-denied")).status).toBe("error")
    yield* f.plugins.activate(
      f.generations.map((plugin) =>
        plugin.id === ToolIntegrityPlugin.Plugin.id ? { ...plugin, revision: "integrity-v2" } : plugin,
      ),
    )
    expect((yield* read("read-after-reload")).status).toBe("completed")
  }),
)

timeout.live("reports the real process timeout without producing a code correction", () =>
  Effect.gen(function* () {
    const f = yield* setup()
    yield* f.fs.writeWithDirs(
      path.join(f.location.directory, "package.json"),
      JSON.stringify({ packageManager: "bun@1.4.2", scripts: { typecheck: "bun -e 'await Bun.sleep(500)'" } }),
    )
    const result = yield* f.write("input.ts", "export const value = 1\n")
    expect(result.status).toBe("completed")
    expect(
      result.content
        ?.filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n"),
    ).toContain("超时")
    expect(result.metadata?.verification).toMatchObject({ status: "unavailable", packages: [{ status: "unavailable", executed: null }] })
    expect((yield* f.store.facts(f.sessionID)).filter((fact) => fact.key.startsWith("verify:"))).toHaveLength(0)
  }),
)

it.live("preserves defects and interruption at the real after-hook boundary", () =>
  Effect.gen(function* () {
    const f = yield* setup()
    const hooks = yield* PluginHooks.Service
    const defect = new Error("after-hook defect")
    const registration = yield* hooks.register("tool", "execute.after", () => Effect.die(defect))
    const snapshot = yield* f.tools.snapshot()
    const call = {
      sessionID: f.sessionID,
      ...toolIdentity,
      call: {
        type: "tool-call" as const,
        id: "after-defect",
        name: "write",
        input: { path: "first.txt", content: "first" },
      },
    }
    const failed = yield* snapshot.execute(call).pipe(Effect.exit)
    expect(Exit.isFailure(failed)).toBe(true)
    if (Exit.isFailure(failed)) {
      const found = Cause.findDefect(failed.cause)
      expect(Result.isSuccess(found) && found.success).toBe(defect)
    }
    yield* registration.dispose
    yield* hooks.register("tool", "execute.after", () => Effect.interrupt)
    const interrupted = yield* snapshot
      .execute({
        ...call,
        call: { ...call.call, id: "after-interrupt", input: { path: "second.txt", content: "second" } },
      })
      .pipe(Effect.exit)
    expect(Exit.isFailure(interrupted) && Cause.hasInterrupts(interrupted.cause)).toBe(true)
    expect(yield* f.fs.readFileString(path.join(f.location.directory, "second.txt"))).toBe("second")
  }),
)

const llmTest = makeGlobalNode({ service: TestLLM.Test, layer: TestLLM.testLayer(), deps: [] })
const llmClient = makeGlobalNode({
  service: LLMClient.Service,
  layer: Layer.effect(LLMClient.Service, TestLLM.Test),
  deps: [llmTest],
})
const sessionTest = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Session.node,
      SessionExecution.node,
      LocationServiceMap.node,
      Database.node,
      Bus.node,
      FSUtil.node,
      llmTest,
    ]),
    [
      Global.node.replace(tempGlobalLayer),
      Bus.node.replace(Bus.configured({ persist: true })),
      offlineModels,
      LayerNodePlatform.llmClient.replace(llmClient),
    ],
  ),
)

sessionTest.live(
  "delivers real verifier diagnostics to the next Session model request and settles its original Step",
  () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
      const locations = yield* LocationServiceMap.Service
      const local = locations.get(location)
      const providerID = Provider.ID.make("integrity-keeper")
      const model = Model.Ref.make({ providerID, id: Model.ID.make("integrity-model") })
      yield* useOfflineCatalog([
        {
          info: Provider.Info.make({
            ...Provider.Info.empty(providerID),
            activation: "enabled",
            package: "@aigcfroge/ai/providers/openai/responses",
          }),
          models: [Model.Info.make(Model.Info.default(providerID, model.id))],
        },
      ]).pipe(Effect.provide(local))
      const fs = yield* FSUtil.Service
      yield* fs.writeWithDirs(
        path.join(directory.path, "package.json"),
        JSON.stringify({
          packageManager: "bun@1.4.2",
          scripts: { typecheck: `${JSON.stringify(tsgo)} --noEmit --skipLibCheck --target esnext input.ts` },
        }),
      )
      const sessions = yield* Session.Service
      const session = yield* sessions.create({
        location,
        agent: Agent.ID.make("build"),
        model,
        title: "Integrity continuation",
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      })
      const llm = yield* TestLLM.Test
      yield* llm.push(
        TestLLM.tool("integrity-model-write", "write", {
          path: "input.ts",
          content: "export const value: string = 1\n",
        }),
        TestLLM.text("The declared check found the type error.", "integrity-answer"),
      )
      const input = yield* sessions.prompt({
        sessionID: session.id,
        text: "Write the sample and report its check result.",
      })
      const runs = yield* SessionExecution.Service
      yield* awaitWithTimeout(llm.wait(2), "Integrity report did not reach a continuation request", "10 seconds")
      yield* awaitWithTimeout(runs.awaitIdle(session.id), "Integrity Session did not settle", "10 seconds")
      const requests = yield* llm.requests()
      expect(requests).toHaveLength(2)
      expect(JSON.stringify(requests[1]?.messages)).toContain("typecheck 失败")
      expect(JSON.stringify(requests[1]?.messages)).toContain("TS2322")
      const db = (yield* Database.Service).db
      expect(yield* SessionInputResult.read(db, { sessionID: session.id, inputID: input.id })).toMatchObject({
        status: "completed",
        assistant: { needsContinuation: false },
      })
      const messages = yield* sessions.context(session.id)
      const original = messages.find(
        (message) =>
          message.type === "assistant" &&
          message.content.some((item) => item.type === "tool" && item.id === "integrity-model-write"),
      )
      expect(original?.type).toBe("assistant")
      if (original?.type !== "assistant") return yield* Effect.die(new Error("Original assistant Step is missing"))
      expect(
        original.content.find((item) => item.type === "tool" && item.id === "integrity-model-write"),
      ).toMatchObject({ state: { status: "completed" } })
      const bus = yield* Bus.Service
      const events = yield* bus.log({ aggregateID: session.id }).pipe(Stream.runCollect)
      expect(
        events.filter(
          (event) =>
            !Bus.isSynced(event) &&
            event.type === SessionEvent.Step.Completed.type &&
            Schema.decodeUnknownSync(SessionEvent.Step.Completed.data)(event.data).assistantMessageID === original.id,
        ),
      ).toHaveLength(1)
    }),
  30_000,
)

it.live(
  "MC04a review checks repaired content after repeated failure and resets on success",
  () =>
    Effect.gen(function* () {
      const f = yield* setup()
      yield* f.fs.writeWithDirs(
        path.join(f.location.directory, "package.json"),
        JSON.stringify({
          packageManager: "bun@1.4.2",
          scripts: { typecheck: `${JSON.stringify(tsgo)} --noEmit --skipLibCheck --target esnext input.ts` },
        }),
      )
      const text = (result: Effect.Success<ReturnType<typeof f.write>>) =>
        result.content
          ?.filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n")
      expect(text(yield* f.write("input.ts", "export const value: string = 1\n", "failure-one"))).toContain(
        "typecheck 失败",
      )
      expect(text(yield* f.write("input.ts", "export const value: string = 1\n", "failure-two"))).toContain(
        "typecheck 失败",
      )
      expect(text(yield* f.write("input.ts", "export const value: string = 1\n", "unchanged-capped"))).toContain(
        "未检查",
      )
      expect(text(yield* f.write("input.ts", 'export const value: string = "fixed"\n', "repair-after-cap"))).toContain(
        "typecheck 通过",
      )
      expect(text(yield* f.write("input.ts", "export const value: string = 1\n", "failure-after-success"))).toContain(
        "typecheck 失败",
      )
      const events = yield* f.bus.log({ aggregateID: f.sessionID }).pipe(Stream.runCollect)
      expect(
        events.filter((event) => !Bus.isSynced(event) && event.type === SessionEvent.Verify.Started.type),
      ).toHaveLength(4)
      expect(
        events.filter((event) => !Bus.isSynced(event) && event.type === SessionEvent.Verify.Passed.type),
      ).toHaveLength(1)
    }),
  30_000,
)

it.live(
  "MC04a review keeps ENOENT identifiers in real compiler failures",
  () =>
    Effect.gen(function* () {
      const f = yield* setup()
      yield* f.fs.writeWithDirs(
        path.join(f.location.directory, "package.json"),
        JSON.stringify({
          packageManager: "bun@1.4.2",
          scripts: { typecheck: `${JSON.stringify(tsgo)} --noEmit --skipLibCheck --target esnext input.ts` },
        }),
      )
      const result = yield* f.write("input.ts", "export const value = ENOENT\n")
      const text = result.content
        ?.filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n")
      expect(text).toContain("typecheck 失败")
      expect(text).toContain("TS2304")
      expect((yield* f.store.facts(f.sessionID)).some((fact) => fact.key.startsWith("verify:"))).toBe(true)
    }),
  30_000,
)

it.live("MC04a review checks old references after a real moved file", () =>
  Effect.gen(function* () {
    const f = yield* setup()
    yield* f.fs.writeWithDirs(path.join(f.location.directory, "src/old.ts"), "export const value = 1\n")
    yield* f.fs.writeWithDirs(path.join(f.location.directory, "src/consumer.ts"), "import { value } from './old.js'\n")
    const result = yield* executeTool(f.tools, {
      sessionID: f.sessionID,
      ...toolIdentity,
      call: {
        type: "tool-call",
        id: "move-old-file",
        name: "patch",
        input: {
          patchText:
            "*** Begin Patch\n*** Update File: src/old.ts\n*** Move to: src/new.ts\n@@\n-export const value = 1\n+export const value = 2\n*** End Patch",
        },
      },
    })
    expect(result.status).toBe("completed")
    expect(
      result.content
        ?.filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n"),
    ).toContain("./old.js")
    expect((yield* f.store.facts(f.sessionID)).some((fact) => fact.key === "ref:./old.js")).toBe(true)
    expect(Schema.decodeUnknownSync(PatchTool.Output)(result.output).applied).toEqual([
      { type: "update", target: path.join(f.location.directory, "src/new.ts"), resource: "src/new.ts" },
      { type: "delete", target: path.join(f.location.directory, "src/old.ts"), resource: "src/old.ts" },
    ])
  }),
)
