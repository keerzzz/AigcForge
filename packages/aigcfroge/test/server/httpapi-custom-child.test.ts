import { expect } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { Deferred, Effect, FileSystem, Layer, Schema } from "effect"
import { AgentV2 } from "@aigcfroge/core/agent"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionTask } from "@aigcfroge/core/session/task"
import { TaskTool } from "@aigcfroge/core/tool/task"
import { Hash } from "@aigcfroge/core/util/hash"
import { Composition } from "@aigcfroge/schema/composition"
import { withCustomMode } from "../../../core/test/lib/product-mode"
import { AIGCFROGE_V2_RUNTIME, AppLayer } from "../../src/effect/app-runtime"
import { EffectBridge } from "../../src/effect/bridge"
import { InvalidRequestError } from "../../src/server/routes/instance/httpapi/errors"
import { CustomCompositionApiGroup } from "../../src/server/routes/instance/httpapi/groups/custom-composition"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session/session"
import { provideTmpdirServer } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffectShared } from "../lib/effect"
import { LegacyHistory } from "../lib/legacy-history"
import { reply, TestLLMServer } from "../lib/llm-server"

// Production services share Server.Default's memo map; each provider server owns
// a fresh router so separate cases cannot register routes on a retained router.
const it = testEffectShared(Layer.mergeAll(AppLayer, Layer.fresh(TestLLMServer.layer), NodeFileSystem.layer))
const allowedName = "e4-frozen-child"
const reserveName = "e4-reserve-child"
const excludedName = "e4-excluded-child"
const childInstruction = "SYNTHETIC_CUSTOM_CHILD_SYSTEM_SENTINEL"

class MessagesResponse extends Schema.Class<MessagesResponse>("CustomChild.MessagesResponse")({
  data: Schema.Array(SessionMessage.Message),
}) {}

class PermissionsResponse extends Schema.Class<PermissionsResponse>("CustomChild.PermissionsResponse")({
  data: Schema.Array(PermissionV2.Request),
}) {}

class AgentsResponse extends Schema.Class<AgentsResponse>("CustomChild.AgentsResponse")({
  data: Schema.Array(AgentV2.Info),
}) {}

it.live("Custom HTTP task dispatch freezes a real child and reuses its durable identity on the next delegation", () =>
  withCustomMode(
    "true",
    provideTmpdirServer(
      ({ dir, llm }) =>
        Effect.gen(function* () {
          expect(AIGCFROGE_V2_RUNTIME).toBe(false)
          yield* llm.reset
          const custom = yield* createCustom(dir)
          const first = prompt("Root delegation one: return the frozen child result.")
          const firstTask = {
            description: "First frozen child turn",
            prompt: "CHILD_INPUT_ONE: return frozen-child-result-1.",
            subagent_type: custom.agent.id,
          }
          yield* llm.toolMatch((hit) => lastContent(hit.body.messages) === first.parts[0].text, "task", firstTask)
          yield* llm.textMatch(
            (hit) => lastContent(hit.body.messages).includes(firstTask.prompt),
            "frozen-child-result-1",
          )
          yield* llm.textMatch(
            (hit) => toolResultContains(hit.body.messages, "frozen-child-result-1"),
            "root-finished-1",
          )
          yield* admit(dir, custom.session.id, first)
          yield* approveTask(dir, custom.session.id, custom.agent.id)
          const firstHistory = yield* settled(dir, custom.session.id, first.messageID)
          expect(
            toolParts(firstHistory).map((tool) =>
              tool.state.status === "error" ? tool.state.error.message : tool.state.status,
            ),
          ).toEqual(["completed"])
          expect(lastText(firstHistory)).toBe("root-finished-1")
          expect(yield* llm.calls).toBe(3)
          expect(yield* llm.pending).toBe(0)

          const children = yield* readChildren(dir, custom.session.id)
          expect(children).toHaveLength(1)
          const child = children[0]
          if (!child) throw new Error("Expected the delegated Custom child")
          expect(child).toMatchObject({
            parentID: custom.session.id,
            mode: "custom",
            agent: custom.agent.id,
            directory: dir,
          })
          const frozen = yield* snapshot(dir, child.id)
          expect(frozen).toEqual({ ...custom.snapshot, sessionID: child.id })
          expect(yield* snapshot(dir, child.id)).toEqual(frozen)
          const firstChild = yield* messages(dir, child.id)
          expect(firstChild.filter((message) => message.type === "user")).toHaveLength(1)
          expect(firstChild.find((message) => message.type === "user")?.text).toContain(firstTask.prompt)
          expect(firstChild.filter((message) => message.type === "assistant")).toMatchObject([
            {
              agent: custom.agent.id,
              finish: "stop",
              content: [{ type: "text", text: "frozen-child-result-1" }],
            },
          ])
          const initialTasks = yield* tasks(dir, custom.session.id)
          expect(initialTasks).toHaveLength(1)
          expect(initialTasks[0]).toMatchObject({
            sessionID: custom.session.id,
            content: firstTask.description,
            status: "completed",
            outputDigest: child.id,
          })
          const initialResult = completedTask(firstHistory)
          expect(initialResult.sessionID).toBe(child.id)
          expect(initialResult.output).toContain("frozen-child-result-1")
          expect(initialResult.delegationID).toBeDefined()
          expect(initialResult.participantID).toBeDefined()
          expect(initialResult.turnID).toBeDefined()
          expect(initialResult.metadata).toMatchObject({
            sessionId: child.id,
            parentSessionId: custom.session.id,
            status: "completed",
            delegationID: initialResult.delegationID,
            participantID: initialResult.participantID,
            turnID: initialResult.turnID,
          })

          const second = prompt("Root delegation two: continue the same frozen child.")
          const secondTask = {
            description: "Resume frozen child turn",
            prompt: "CHILD_INPUT_TWO: return frozen-child-result-2.",
            subagent_type: custom.agent.id,
            task_id: child.id,
            delegation_id: initialResult.delegationID,
          }
          yield* llm.toolMatch((hit) => lastContent(hit.body.messages) === second.parts[0].text, "task", secondTask)
          yield* llm.textMatch(
            (hit) => lastContent(hit.body.messages).includes(secondTask.prompt),
            "frozen-child-result-2",
          )
          yield* llm.textMatch(
            (hit) => toolResultContains(hit.body.messages, "frozen-child-result-2"),
            "root-finished-2",
          )
          yield* admit(dir, custom.session.id, second)
          yield* approveTask(dir, custom.session.id, custom.agent.id)
          // Existing-child adoption must not run the generic Custom creation gate.
          // A failure here is a production recovery failure, not permission to create a replacement child.
          const secondHistory = yield* settled(dir, custom.session.id, second.messageID)
          expect(lastText(secondHistory)).toBe("root-finished-2")
          expect(yield* llm.calls).toBe(6)
          expect(yield* llm.pending).toBe(0)
          expect((yield* readChildren(dir, custom.session.id)).map((item) => item.id)).toEqual([child.id])
          expect(yield* snapshot(dir, child.id)).toEqual(frozen)
          const secondChild = yield* messages(dir, child.id)
          expect(secondChild.slice(0, firstChild.length)).toEqual([...firstChild])
          expect(secondChild.filter((message) => message.type === "user")).toHaveLength(2)
          expect(secondChild.filter((message) => message.type === "assistant")).toHaveLength(2)
          expect(lastText(secondChild)).toBe("frozen-child-result-2")
          const resumedResult = completedTask(secondHistory)
          expect(resumedResult).toMatchObject({
            sessionID: child.id,
            delegationID: initialResult.delegationID,
            participantID: initialResult.participantID,
          })
          expect(resumedResult.turnID).not.toBe(initialResult.turnID)
          expect(yield* tasks(dir, custom.session.id)).toMatchObject([
            { status: "completed", outputDigest: child.id },
            { status: "completed", outputDigest: child.id },
          ])
          const rootState = yield* LegacyHistory.persistedState(custom.session.id)
          const childState = yield* LegacyHistory.persistedState(child.id)
          expect(rootState.inputs).toHaveLength(2)
          expect(childState.inputs).toHaveLength(2)
          expect(rootState.events.filter((event) => event.type === "session.next.tool.called.1")).toHaveLength(2)
          expect(rootState.events.filter((event) => event.type === "session.next.tool.success.1")).toHaveLength(2)
          yield* admit(dir, custom.session.id, first)
          yield* idle(custom.session.id)
          expect(yield* llm.calls).toBe(6)
          expect(yield* llm.pending).toBe(0)
          expect(LegacyHistory.digest(yield* LegacyHistory.persistedState(custom.session.id))).toBe(
            LegacyHistory.digest(rootState),
          )
          expect(LegacyHistory.digest(yield* LegacyHistory.persistedState(child.id))).toBe(
            LegacyHistory.digest(childState),
          )

          const hits = yield* llm.hits
          expect(hits.map((hit) => hit.url.pathname)).toEqual(Array(6).fill("/v1/chat/completions"))
          const wire = hits.map((hit) => LegacyHistory.decodeMessages(hit.body.messages))
          expect(wire.map((history) => history.at(-1)?.role)).toEqual(["user", "user", "tool", "user", "user", "tool"])
          expect(wire[1]?.at(-1)?.content).toContain(firstTask.prompt)
          expect(wire[4]?.at(-1)?.content).toContain(secondTask.prompt)
          expect(
            wire[4]?.some((message) => message.role === "assistant" && message.content === "frozen-child-result-1"),
          ).toBe(true)
          // Only a boolean escapes privileged provider context; raw system/developer text is never asserted.
          expect(
            [hits[1], hits[4]].map((hit) => JSON.stringify(hit?.body.messages).includes(childInstruction)),
          ).toEqual([true, true])
        }),
      { config: providerConfig },
    ).pipe(Effect.scoped),
  ),
)

it.live("Custom HTTP pool rejection preserves state and permits model redispatch and child prompt recovery", () =>
  withCustomMode(
    "true",
    provideTmpdirServer(
      ({ dir, llm }) =>
        Effect.gen(function* () {
          expect(AIGCFROGE_V2_RUNTIME).toBe(false)
          yield* llm.reset
          const custom = yield* createCustom(dir)
          const input = prompt("Reject the excluded child, then delegate to the frozen child.")
          const forbiddenTask = {
            description: "Excluded child negative probe",
            prompt: "EXCLUDED_CHILD_INPUT: must never execute.",
            subagent_type: excludedName,
          }
          const allowedTask = {
            description: "Allowed child recovery turn",
            prompt: "ALLOWED_CHILD_INPUT: return recovered-child-result.",
            subagent_type: custom.agent.id,
          }
          const release = yield* Deferred.make<void>()
          // Release the provider before Session/SSE/server finalizers, even when an assertion fails.
          yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
          const bridge = yield* EffectBridge.make()
          yield* llm.toolMatch((hit) => lastContent(hit.body.messages) === input.parts[0].text, "task", forbiddenTask)
          yield* llm.pushMatch(
            (hit) => toolResultContains(hit.body.messages, "not permitted in this Custom session"),
            reply()
              .wait(bridge.promise(Deferred.await(release)))
              .tool("task", allowedTask),
          )
          yield* llm.textMatch(
            (hit) => lastContent(hit.body.messages).includes(allowedTask.prompt),
            "recovered-child-result",
          )
          yield* llm.textMatch(
            (hit) => toolResultContains(hit.body.messages, "recovered-child-result"),
            "root-recovered",
          )
          yield* admit(dir, custom.session.id, input)
          yield* awaitWithTimeout(llm.wait(2), "Custom pool failure did not reach the model continuation", "20 seconds")
          expect(yield* llm.calls).toBe(2)
          expect(yield* readChildren(dir, custom.session.id)).toEqual([])
          expect(yield* tasks(dir, custom.session.id)).toEqual([])
          expect(yield* permissions(dir)).toEqual([])
          const failedHistory = yield* messages(dir, custom.session.id)
          const failedTools = toolParts(failedHistory)
          expect(failedTools).toHaveLength(1)
          const failedTool = failedTools[0]
          if (!failedTool || failedTool.state.status !== "error") throw new Error("Expected durable pool rejection")
          expect(failedTool).toMatchObject({ id: "call_1", name: "task", state: { input: forbiddenTask } })
          expect(failedTool.state.error).toMatchObject({ type: "unknown" })
          expect(failedTool.state.error.message).toContain("not permitted in this Custom session")
          expect(failedTool.state.error.message).toContain(excludedName)
          const failedState = yield* LegacyHistory.persistedState(custom.session.id)
          const failedEvents = failedState.events.filter((event) => event.type === "session.next.tool.failed.1")
          expect(failedEvents).toHaveLength(1)
          expect(failedEvents[0]?.data.callID).toBe(failedTool.id)
          expect(failedState.events.filter((event) => event.type === "session.next.tool.success.1")).toHaveLength(0)

          yield* Deferred.succeed(release, undefined)
          yield* approveTask(dir, custom.session.id, custom.agent.id)
          const recovered = yield* settled(dir, custom.session.id, input.messageID)
          expect(lastText(recovered)).toBe("root-recovered")
          expect(yield* llm.calls).toBe(4)
          expect(yield* llm.pending).toBe(0)
          expect(toolParts(recovered).filter((tool) => tool.state.status === "error")).toEqual(failedTools)
          const children = yield* readChildren(dir, custom.session.id)
          expect(children).toHaveLength(1)
          const child = children[0]
          if (!child) throw new Error("Expected the allowed child after model redispatch")
          expect(child).toMatchObject({
            mode: "custom",
            agent: custom.agent.id,
            parentID: custom.session.id,
            directory: dir,
          })
          const frozen = yield* snapshot(dir, child.id)
          expect(frozen).toEqual({ ...custom.snapshot, sessionID: child.id })
          const childHistory = yield* messages(dir, child.id)
          expect(lastText(childHistory)).toBe("recovered-child-result")
          expect(childHistory.filter((message) => message.type === "assistant")).toMatchObject([
            { agent: custom.agent.id, finish: "stop" },
          ])
          expect(completedTask(recovered).sessionID).toBe(child.id)
          expect(yield* tasks(dir, custom.session.id)).toMatchObject([
            { status: "completed", outputDigest: child.id, content: allowedTask.description },
          ])
          const rootBefore = yield* LegacyHistory.persistedState(custom.session.id)
          const before = yield* LegacyHistory.persistedState(child.id)
          expect(rootBefore.events.filter((event) => event.type === "session.next.tool.failed.1")).toEqual(failedEvents)

          // Core's existing-ID adoption must not bypass the HTTP Custom capability gate
          // when this endpoint's payload omits mode. Check both root and frozen child IDs.
          yield* Effect.forEach([custom.session.id, child.id], (id) =>
            Effect.gen(function* () {
              const response = yield* request(
                dir,
                "/api/session",
                { method: "POST", body: JSON.stringify({ id }) },
                false,
              )
              expect(response.status).toBe(400)
              const error = yield* Schema.decodeUnknownEffect(ProductModePolicy.UnsupportedProductModeError)(
                yield* Effect.promise(() => response.json()),
              )
              expect(error.mode).toBe("custom")
              const capable = yield* request(dir, "/api/session", {
                method: "POST",
                body: JSON.stringify({ id, mode: "custom" }),
              })
              expect(capable.status).toBe(200)
            }),
          )
          expect(LegacyHistory.digest(yield* LegacyHistory.persistedState(custom.session.id))).toBe(
            LegacyHistory.digest(rootBefore),
          )
          expect(LegacyHistory.digest(yield* LegacyHistory.persistedState(child.id))).toBe(LegacyHistory.digest(before))
          expect(yield* snapshot(dir, child.id)).toEqual(frozen)
          expect(yield* llm.calls).toBe(4)

          const next = prompt("DIRECT_CHILD_RECOVERY: return child-direct-recovery.", excludedName)
          const rejected = yield* request(dir, `/session/${child.id}/prompt_async`, {
            method: "POST",
            body: JSON.stringify(next),
          })
          expect(rejected.status).toBe(400)
          const error = yield* Schema.decodeUnknownEffect(InvalidRequestError)(
            yield* Effect.promise(() => rejected.json()),
          )
          expect(error.message).toContain("not part of the frozen composition pool")
          expect(error.message).toContain(excludedName)
          expect(LegacyHistory.digest(yield* LegacyHistory.persistedState(child.id))).toBe(LegacyHistory.digest(before))
          expect((yield* readChildren(dir, custom.session.id))[0]?.agent).toBe(custom.agent.id)
          expect(yield* snapshot(dir, child.id)).toEqual(frozen)
          expect(yield* permissions(dir)).toEqual([])
          expect(yield* llm.calls).toBe(4)

          const accepted = { ...next, agent: custom.agent.id }
          yield* llm.textMatch((hit) => lastContent(hit.body.messages) === next.parts[0].text, "child-direct-recovery")
          yield* admit(dir, child.id, accepted)
          const resumed = yield* settled(dir, child.id, accepted.messageID)
          expect(
            toolParts(resumed).map((tool) =>
              tool.state.status === "error" ? tool.state.error.message : tool.state.status,
            ),
          ).toEqual([])
          expect(lastText(resumed)).toBe("child-direct-recovery")
          expect(resumed.slice(0, childHistory.length)).toEqual([...childHistory])
          expect(resumed.filter((message) => message.type === "assistant").map((message) => message.agent)).toEqual([
            custom.agent.id,
            custom.agent.id,
          ])
          expect(yield* llm.calls).toBe(5)
          expect(yield* llm.pending).toBe(0)
          const after = yield* LegacyHistory.persistedState(child.id)
          expect(after.inputs).toHaveLength(before.inputs.length + 1)
          expect(after.inputs.filter((item) => item.id === accepted.messageID)).toHaveLength(1)
          expect(after.events.filter((event) => event.type === "session.next.agent.switched.1")).toEqual(
            before.events.filter((event) => event.type === "session.next.agent.switched.1"),
          )
          yield* admit(dir, child.id, accepted)
          yield* idle(child.id)
          expect(yield* llm.calls).toBe(5)
          expect(LegacyHistory.digest(yield* LegacyHistory.persistedState(child.id))).toBe(LegacyHistory.digest(after))
          expect(yield* snapshot(dir, child.id)).toEqual(frozen)

          const hits = yield* llm.hits
          expect(hits.map((hit) => hit.url.pathname)).toEqual(Array(5).fill("/v1/chat/completions"))
          const wire = hits.map((hit) => LegacyHistory.decodeMessages(hit.body.messages))
          expect(wire.map((history) => history.at(-1)?.role)).toEqual(["user", "tool", "user", "tool", "user"])
          expect(wire[1]?.at(-1)?.content).toContain("not permitted in this Custom session")
          expect(wire[2]?.at(-1)?.content).toContain(allowedTask.prompt)
          expect(wire[4]?.at(-1)?.content).toBe(next.parts[0].text)
          expect(
            wire.some(
              (history) => history.at(-1)?.role === "user" && history.at(-1)?.content?.includes(forbiddenTask.prompt),
            ),
          ).toBe(false)
        }),
      { config: providerConfig },
    ).pipe(Effect.scoped),
  ),
)

it.live("Custom HTTP creation checks inherited mode before writing a child without client capability", () =>
  withCustomMode(
    "true",
    provideTmpdirServer(
      ({ dir, llm }) =>
        Effect.gen(function* () {
          const custom = yield* createCustom(dir)
          const before = yield* LegacyHistory.persistedState(custom.session.id)
          const input = {
            id: SessionV2.ID.create(),
            parentID: custom.session.id,
            agent: custom.agent.id,
            location: { directory: dir },
          }
          const response = yield* request(
            dir,
            "/api/session",
            {
              method: "POST",
              body: JSON.stringify(input),
            },
            false,
          )
          expect(response.status).toBe(400)
          const error = yield* Schema.decodeUnknownEffect(ProductModePolicy.UnsupportedProductModeError)(
            yield* Effect.promise(() => response.json()),
          )
          expect(error.mode).toBe("custom")
          expect(yield* readChildren(dir, custom.session.id)).toEqual([])
          expect(LegacyHistory.digest(yield* LegacyHistory.persistedState(custom.session.id))).toBe(
            LegacyHistory.digest(before),
          )
          expect(yield* llm.calls).toBe(0)
          const capable = yield* request(dir, "/api/session", { method: "POST", body: JSON.stringify(input) })
          expect(capable.status).toBe(200)
          expect((yield* readChildren(dir, custom.session.id)).map((child) => child.id)).toEqual([input.id])
          expect(yield* snapshot(dir, input.id)).toEqual({ ...custom.snapshot, sessionID: input.id })
          expect(yield* llm.calls).toBe(0)
        }),
      { config: providerConfig },
    ).pipe(Effect.scoped),
  ),
)

function providerConfig(url: string) {
  // The real summary owner excludes zero-cost models. Keep only this provider
  // available so a background summary cannot consume a scripted child response.
  return { ...LegacyHistory.providerConfig(url), enabled_providers: [LegacyHistory.providerID] }
}

function request(directory: string, path: string, init: RequestInit = {}, capable = true) {
  const headers = new Headers(init.headers)
  headers.set("x-aigcfroge-directory", encodeURIComponent(directory))
  if (capable) headers.set(ProductModePolicy.CAPABILITIES_HEADER, ProductModePolicy.CAPABILITY_CUSTOM_V1)
  if (init.body !== undefined) headers.set("content-type", "application/json")
  return Effect.promise(() => Promise.resolve(Server.Default().app.request(path, { ...init, headers })))
}

const createCustom = Effect.fnUntraced(function* (directory: string) {
  const filesystem = yield* FileSystem.FileSystem
  const sessions = yield* SessionV2.Service
  const execution = yield* SessionExecution.Service
  const asset = `---\nkind: agent\nname: ${allowedName}\ndescription: Frozen child HTTP fixture\n---\n${childInstruction}\n`
  const reserve = `---\nkind: agent\nname: ${reserveName}\ndescription: Unused frozen pool member\n---\nSYNTHETIC_RESERVE_CHILD_SYSTEM\n`
  yield* filesystem.makeDirectory(`${directory}/.aigcfroge/agents`, { recursive: true })
  yield* filesystem.writeFileString(`${directory}/.aigcfroge/agents/${allowedName}.md`, asset)
  yield* filesystem.writeFileString(`${directory}/.aigcfroge/agents/${reserveName}.md`, reserve)
  yield* filesystem.writeFileString(
    `${directory}/.aigcfroge/agents/${excludedName}.md`,
    `---\nkind: agent\nname: ${excludedName}\ndescription: Registered pool exclusion fixture\n---\nEXCLUDED_SYSTEM_SENTINEL\n`,
  )
  // An actual Custom-capable SSE connection supplies approval liveness. No
  // Permission/ApprovalPresence stub or elevated permission tier is involved.
  const stream = yield* request(directory, "/event")
  expect(stream.status).toBe(200)
  if (!stream.body) throw new Error("Expected the production event stream")
  const reader = stream.body.getReader()
  yield* Effect.addFinalizer(() => Effect.promise(() => reader.cancel()))
  const connected = yield* awaitWithTimeout(
    Effect.promise(() => reader.read()),
    "Custom SSE did not connect",
  )
  expect(connected.done).toBe(false)
  expect(new TextDecoder().decode(connected.value).includes("server.connected")).toBe(true)

  const registeredResponse = yield* request(directory, "/api/agent")
  expect(registeredResponse.status).toBe(200)
  const registered = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(AgentsResponse))(
    yield* Effect.promise(() => registeredResponse.json()),
  )
  expect(registered.data.some((agent) => agent.id === excludedName)).toBe(true)
  expect(registered.data.find((agent) => agent.id === allowedName)).toMatchObject({
    originRelativePath: `${allowedName}.md`,
    originRevision: Hash.sha256(Buffer.from(asset)),
  })
  const composition = {
    source: "temporary",
    agents: [
      { kind: "agent", relativePath: `${allowedName}.md`, revision: Hash.sha256(Buffer.from(asset)) },
      { kind: "agent", relativePath: `${reserveName}.md`, revision: Hash.sha256(Buffer.from(reserve)) },
    ],
    bindings: {},
    presentation: "native",
    requestedCapabilities: [],
  }
  const planned = yield* request(directory, CustomCompositionApiGroup.CustomCompositionPaths.plan, {
    method: "POST",
    body: JSON.stringify(composition),
  })
  expect(planned.status).toBe(200)
  const plan = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(Composition.Plan))(
    yield* Effect.promise(() => planned.json()),
  )
  expect(plan.valid).toBe(true)
  const started = yield* request(directory, CustomCompositionApiGroup.CustomCompositionPaths.start, {
    method: "POST",
    body: JSON.stringify({
      composition,
      expectedPlanDigest: plan.digest,
      title: "Custom frozen child HTTP acceptance",
    }),
  })
  expect(started.status).toBe(200)
  const custom = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(Composition.StartResponse))(
    yield* Effect.promise(() => started.json()),
  )
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      yield* execution.interrupt(custom.session.id)
      yield* Effect.forEach(yield* sessions.children(custom.session.id), (child) => sessions.remove(child.id))
      yield* sessions.remove(custom.session.id)
    }).pipe(Effect.orDie),
  )
  expect(custom.session).toMatchObject({ mode: "custom", agent: "meta" })
  expect(custom.snapshot.digest).toBe(plan.digest)
  if (custom.snapshot.version !== 2) throw new Error("Expected a multi-agent composition snapshot")
  expect(custom.snapshot.data.agents).toHaveLength(2)
  const agent = custom.snapshot.data.agents.find((item) => item.id === allowedName)
  if (!agent) throw new Error("Expected the frozen child binding")
  expect(agent.id).toBe(allowedName)
  expect(Object.keys(custom.snapshot.data.bindings ?? {}).sort()).toEqual([
    `agents/${allowedName}`,
    `agents/${reserveName}`,
    "orchestrator",
  ])
  expect(custom.snapshot.data.tools.catalog).toContain("task")
  const persisted = yield* snapshot(directory, custom.session.id)
  // Compare child copies against the stored snapshot. The start response's
  // optional workflow can be null while persisted JSON omits it.
  expect(persisted).toMatchObject({
    sessionID: custom.session.id,
    digest: custom.snapshot.digest,
    createdAt: custom.snapshot.createdAt,
    version: custom.snapshot.version,
  })
  return { ...custom, snapshot: persisted, agent }
})

function prompt(text: string, agent = "meta") {
  return {
    messageID: SessionMessage.ID.create(),
    agent,
    model: { providerID: LegacyHistory.providerID, modelID: LegacyHistory.modelID },
    parts: [{ type: "text", text }],
  }
}

const admit = Effect.fnUntraced(function* (
  directory: string,
  sessionID: SessionV2.ID,
  input: ReturnType<typeof prompt>,
) {
  const response = yield* request(directory, `/session/${sessionID}/prompt_async`, {
    method: "POST",
    body: JSON.stringify(input),
  })
  expect(response.status).toBe(204)
})

const permissions = Effect.fnUntraced(function* (directory: string) {
  const response = yield* request(directory, "/api/permission/request")
  expect(response.status).toBe(200)
  return (yield* Schema.decodeUnknownEffect(Schema.toCodecJson(PermissionsResponse))(
    yield* Effect.promise(() => response.json()),
  )).data
})

const approveTask = Effect.fnUntraced(function* (directory: string, sessionID: SessionV2.ID, agent: string) {
  const pending = yield* pollWithTimeout(
    permissions(directory).pipe(
      Effect.map((items) => items.find((item) => item.sessionID === sessionID && item.action === "task")),
    ),
    "Custom task did not request approval through its owning Session",
    "20 seconds",
  )
  expect(pending.resources).toEqual([agent])
  expect(pending.source).toMatchObject({ type: "tool", callID: "call_1" })
  const response = yield* request(directory, `/api/session/${sessionID}/permission/${pending.id}/reply`, {
    method: "POST",
    body: JSON.stringify({ reply: "once" }),
  })
  expect(response.status).toBe(204)
})

const messages = Effect.fnUntraced(function* (directory: string, sessionID: SessionV2.ID) {
  const response = yield* request(directory, `/api/session/${sessionID}/message?order=asc`)
  expect(response.status).toBe(200)
  return (yield* Schema.decodeUnknownEffect(Schema.toCodecJson(MessagesResponse))(
    yield* Effect.promise(() => response.json()),
  )).data
})

const readChildren = Effect.fnUntraced(function* (directory: string, sessionID: SessionV2.ID) {
  const response = yield* request(directory, `/session/${sessionID}/children`)
  expect(response.status).toBe(200)
  return yield* Schema.decodeUnknownEffect(Schema.toCodecJson(Schema.Array(Session.Info)))(
    yield* Effect.promise(() => response.json()),
  )
})

const snapshot = Effect.fnUntraced(function* (directory: string, sessionID: SessionV2.ID) {
  const response = yield* request(directory, `/session/${sessionID}/composition`)
  expect(response.status).toBe(200)
  return yield* Schema.decodeUnknownEffect(Schema.toCodecJson(Composition.Snapshot))(
    yield* Effect.promise(() => response.json()),
  )
})

const tasks = Effect.fnUntraced(function* (directory: string, sessionID: SessionV2.ID) {
  const response = yield* request(directory, `/session/${sessionID}/task`)
  expect(response.status).toBe(200)
  return yield* Schema.decodeUnknownEffect(Schema.toCodecJson(Schema.Array(SessionTask.Info)))(
    yield* Effect.promise(() => response.json()),
  )
})

const idle = Effect.fnUntraced(function* (sessionID: SessionV2.ID) {
  const execution = yield* SessionExecution.Service
  yield* pollWithTimeout(
    execution.isActive(sessionID).pipe(Effect.map((active) => (active ? undefined : true))),
    "Custom Session execution did not become idle",
    "20 seconds",
  )
})

const settled = Effect.fnUntraced(function* (directory: string, sessionID: SessionV2.ID, messageID: SessionMessage.ID) {
  const execution = yield* SessionExecution.Service
  return yield* pollWithTimeout(
    Effect.gen(function* () {
      if (yield* execution.isActive(sessionID)) return undefined
      const history = yield* messages(directory, sessionID)
      const admitted = history.findIndex((message) => message.id === messageID && message.type === "user")
      const last = history.at(-1)
      if (admitted < 0 || admitted >= history.length - 1 || last?.type !== "assistant" || !last.time.completed)
        return undefined
      return history
    }),
    "Custom provider turn did not settle durably",
    "20 seconds",
  )
})

function lastText(history: ReadonlyArray<SessionMessage.Message>) {
  const last = history.at(-1)
  if (last?.type !== "assistant") throw new Error("Expected the final canonical assistant turn")
  expect(last.finish).toBe("stop")
  return last.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
}

function toolParts(history: ReadonlyArray<SessionMessage.Message>) {
  return history.flatMap((message) =>
    message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
  )
}

function completedTask(history: ReadonlyArray<SessionMessage.Message>) {
  const tool = toolParts(history).findLast((part) => part.name === "task" && part.state.status === "completed")
  if (!tool || tool.state.status !== "completed") throw new Error("Expected the completed canonical task output")
  return Schema.decodeUnknownSync(Schema.toCodecJson(TaskTool.Output))(tool.state.structured)
}

function lastContent(value: unknown) {
  return LegacyHistory.decodeMessages(value).at(-1)?.content ?? ""
}

function toolResultContains(value: unknown, text: string) {
  const last = LegacyHistory.decodeMessages(value).at(-1)
  return last?.role === "tool" && last.content?.includes(text) === true
}
