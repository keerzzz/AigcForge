import { expect, test } from "bun:test"
import { agent, model, renderLocal, session } from "../fixture/local"
import { createApi, createEventStream, createFetch, directory, json, type FetchHandler } from "../fixture/tui-client"
import type {
  SessionCreateInput,
  SessionInfo,
  SessionPromptInput,
  SessionSwitchAgentInput,
  ModelSelection,
} from "@aigcfroge/client"
import { CliRenderEvents, InputRenderable, TextareaRenderable } from "@opentui/core"
import { once } from "node:events"
import { DialogVariant } from "../../src/component/dialog-variant"
import { LocalModelProvider, LocalProvider, useLocal } from "../../src/context/local"
import { testRender } from "@opentui/solid"
import { createEffect } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { ArgsProvider } from "../../src/context/args"
import { ClientProvider, useClient } from "../../src/context/client"
import { DataProvider, useData } from "../../src/context/data"
import { Keymap } from "../../src/context/keymap"
import { LocationProvider } from "../../src/context/location"
import { PermissionProvider } from "../../src/context/permission"
import { RouteProvider, useRoute } from "../../src/context/route"
import { ThemeProvider } from "../../src/context/theme"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createAppFixture } from "../fixture/app"
import { isModelGroup } from "../../src/model-preference"
import { ProductMode } from "@aigcfroge/schema/product-mode"

function physicalModel(value: ModelSelection | undefined) {
  if (value && isModelGroup(value)) throw new Error("This fixture requires a physical model")
  return value
}

test("cycles all recent models in a stable order in both directions", async () => {
  await using setup = await renderLocal({
    models: [model("first"), model("second"), model("third")],
    preferences: { recent: ["first", "second", "third"].map((modelID) => ({ providerID: "provider", modelID })) },
  })
  expect(setup.local.model.current()).toMatchObject({ modelID: "first" })
  for (const id of ["second", "third", "first"]) {
    setup.local.model.cycle(1)
    expect(setup.local.model.current()).toMatchObject({ modelID: id })
  }
  for (const id of ["third", "second", "first"]) {
    setup.local.model.cycle(-1)
    expect(setup.local.model.current()).toMatchObject({ modelID: id })
  }
})

test("uses the last configured model and variant ahead of recents", async () => {
  await using setup = await renderLocal({
    models: [model("first"), model("second", ["low", "high"]), model("third")],
    preferences: { recent: [{ providerID: "provider", modelID: "third" }] },
    fetch: (url) => {
      if (url.pathname === "/api/config")
        return json([
          { type: "document", info: { model: "provider/first" } },
          { type: "document", info: { model: { providerID: "provider", model: "second", variant: "high" } } },
          { type: "document", info: {} },
        ])
    },
  })
  expect(setup.local.model.selection()).toEqual({ providerID: "provider", modelID: "second", variant: "high" })
})

test("switching agents restores their model and variant within the session", async () => {
  await using setup = await renderLocal({
    models: [model("first", ["low", "high"]), model("second", ["low", "high"]), model("third", ["low", "high"])],
    agents: [
      agent("build", { providerID: "provider", id: "first", variant: "high" }),
      agent("plan", { providerID: "provider", id: "second", variant: "low" }),
    ],
    sessions: [session("ses_first", { providerID: "provider", id: "first", variant: "low" })],
  })
  await setup.data.session.sync("ses_first")
  setup.route.navigate({ type: "session", sessionID: "ses_first" })
  expect(setup.local.model.selection()).toEqual({ providerID: "provider", modelID: "first", variant: "low" })
  setup.local.agent.move(1)
  expect(setup.local.agent.current()?.id).toBe("plan")
  expect(setup.local.model.selection()).toEqual({ providerID: "provider", modelID: "second", variant: "low" })
  setup.local.model.set({ providerID: "provider", modelID: "third" })
  setup.local.model.variant.set("high")
  setup.local.agent.move(-1)
  expect(setup.local.model.selection()).toEqual({ providerID: "provider", modelID: "first", variant: "low" })
  setup.local.agent.set("plan")
  expect(setup.local.model.selection()).toEqual({ providerID: "provider", modelID: "third", variant: "high" })
})

test("agent and model drafts are isolated across sessions and survive navigation", async () => {
  await using setup = await renderLocal({
    models: [model("first", ["low", "high"]), model("second", ["low", "high"])],
    agents: [agent("build"), agent("plan", { providerID: "provider", id: "second" })],
    sessions: [
      session("ses_first", { providerID: "provider", id: "first", variant: "low" }),
      session("ses_second", { providerID: "provider", id: "second", variant: "high" }, "plan"),
    ],
  })
  await Promise.all([setup.data.session.sync("ses_first"), setup.data.session.sync("ses_second")])
  setup.route.navigate({ type: "session", sessionID: "ses_first" })
  setup.local.agent.set("plan")
  setup.local.model.variant.set("low")
  setup.route.navigate({ type: "session", sessionID: "ses_second" })
  expect(setup.local.agent.current()?.id).toBe("plan")
  expect(setup.local.model.variant.current()).toBe("high")
  setup.route.navigate({ type: "session", sessionID: "ses_first" })
  expect(setup.local.agent.current()?.id).toBe("plan")
  expect(setup.local.model.variant.current()).toBe("low")
  setup.local.agent.set("build")
  expect(setup.local.model.selection()).toEqual({ providerID: "provider", modelID: "first", variant: "low" })
})

test("retains an unavailable saved session model instead of selecting a fallback", async () => {
  const selected = { providerID: "provider", id: "missing", variant: "high" }
  await using setup = await renderLocal({
    models: [model("first", ["low", "high"]), model("second")],
    agents: [agent("build", { providerID: "provider", id: "first", variant: "low" })],
    sessions: [session("ses_first", selected)],
  })
  await setup.data.session.sync("ses_first")
  setup.route.navigate({ type: "session", sessionID: "ses_first" })
  expect(setup.local.model.selection()).toEqual({ providerID: "provider", modelID: "missing", variant: "high" })
  expect(setup.local.model.available()).toBe(false)
  expect(setup.data.session.get("ses_first")?.model).toEqual(selected)
})

test("new-session fallback still skips unavailable CLI and recent models", async () => {
  await using setup = await renderLocal({
    models: [model("first"), model("second")],
    args: { model: "provider/missing-cli" },
    preferences: {
      recent: [
        { providerID: "provider", modelID: "missing-recent" },
        { providerID: "provider", modelID: "second" },
      ],
    },
  })
  expect(setup.local.model.current()).toMatchObject({ modelID: "second" })
  expect(setup.local.model.available()).toBe(true)
})

test.each(["provider/chat#high", "provider/chat", undefined])(
  "explicit CLI variant precedes saved preferences for %s",
  async (selected) => {
    await using setup = await renderLocal({
      models: [model("chat", ["low", "high"])],
      args: selected ? { model: selected } : undefined,
      preferences: { variant: { "provider/chat": "low" } },
    })
    expect(setup.local.model.selection()).toEqual({
      providerID: "provider",
      modelID: "chat",
      variant: selected?.includes("#") ? "high" : "low",
    })
  },
)

test.each(["coding", "work", "custom", undefined] as const)(
  "ordinary Agent and Executor choices use Session mode %s",
  async (mode) => {
    const saved = { ...session("ses_mode_" + mode), mode }
    await using setup = await renderLocal({
      agents: [
        { ...agent("build"), mode: "all", originKind: "builtin", ordinaryModes: ProductMode.ID.literals.slice() },
        { ...agent("authored"), mode: "all", originKind: "user", ordinaryModes: ["custom"] },
        { ...agent("legacy"), mode: "all" },
      ],
      sessions: mode ? [saved] : [],
    })
    if (mode) {
      await setup.data.session.sync(saved.id)
      setup.route.navigate({ type: "session", sessionID: saved.id })
      expect(setup.data.session.get(saved.id)?.mode).toBe(mode)
    }
    const expected = mode === "custom" ? ["build", "authored", "legacy"] : ["build", "legacy"]
    expect(setup.local.agent.list().map((item) => item.id)).toEqual(expected)
    expect(setup.local.executor.agent.list().map((item) => item.id)).toEqual(expected)
  },
)

test.each(["build", "plan"])("production Prompt creates the backend-default %s Agent", async (selected) => {
  const created = Promise.withResolvers<SessionCreateInput>()
  const selectedModel = { providerID: "provider", id: selected + "-model", variant: "high" }
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  await using setup = await createAppFixture({
    config: { animations: false },
    fetch: async (url, request) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/agent")
        return json({
          location,
          data: [
            { ...agent(selected, selectedModel), mode: "all" },
            { ...agent(selected === "build" ? "plan" : "build"), mode: "all" },
            agent("meta", { providerID: "provider", id: "meta-model", variant: "low" }),
            { ...agent("explore"), mode: "subagent" },
          ],
        })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [model(selected + "-model", ["low", "high"]), model("meta-model", ["low"])] })
      if (url.pathname === "/api/session" && request.method === "POST") {
        const payload: SessionCreateInput = await request.json()
        created.resolve(payload)
        return json({
          data: session(payload.id ?? "ses_created", payload.model ?? undefined, payload.agent ?? selected),
        })
      }
      if (/^\/api\/session\/[^/]+\/prompt$/.test(url.pathname)) {
        const payload: Omit<SessionPromptInput, "sessionID"> = await request.json()
        return json({
          data: {
            id: payload.id,
            sessionID: url.pathname.split("/")[3],
            type: "user",
            time: { created: 1 },
            delivery: payload.delivery ?? "steer",
            payload: { text: payload.text },
          },
        })
      }
      if (/^\/api\/session\/[^/]+\/environment$/.test(url.pathname)) return new Response(null, { status: 204 })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
    },
  })
  await setup.ready
  // Handoff acknowledges the first frame; submission also needs the catalog selection.
  await setup.waitForFrame(
    (frame) =>
      frame.includes(selectedModel.id + " Provider · " + selectedModel.variant) &&
      setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )
  await setup.mockInput.typeText("ordinary selection")
  setup.mockInput.pressEnter()
  const payload = await created.promise
  expect(payload.agent).toBe(selected)
  expect(payload.model).toEqual(selectedModel)
  expect(payload.control).toBeUndefined()
  expect(payload.executorPreference).toBeUndefined()
})

test("a historical Meta root keeps actual Agent selection separate from its delegation preference", async () => {
  const root = {
    ...session("ses_historical", { providerID: "provider", id: "first", variant: "high" }, "plan"),
    controller: { kind: "root", metaAgentID: "mag_historical", rootSessionID: "ses_historical" } as const,
    executorPreference: { agent: "build" },
  }
  await using setup = await renderLocal({
    models: [model("first", ["low", "high"])],
    agents: [
      agent("plan"),
      { ...agent("build"), mode: "all" },
      agent("meta"),
      { ...agent("explore"), mode: "subagent" },
    ],
    sessions: [root],
  })
  await setup.data.session.sync(root.id)
  setup.route.navigate({ type: "session", sessionID: root.id })
  expect(setup.local.agent.list().map((item) => item.id)).toEqual(["plan", "build", "meta"])
  expect(setup.local.agent.current()?.id).toBe("plan")
  setup.local.agent.set("build")
  expect(setup.local.agent.current()?.id).toBe("build")
  setup.local.agent.set("plan")
  expect(setup.local.agent.current()?.id).toBe("plan")
  expect(setup.data.session.get(root.id)?.executorPreference).toEqual(root.executorPreference)
})

test("production Prompt switches a historical Meta root to Plan with its captured model", async () => {
  const root = promptSelectionSession()
  const selectedModel = { providerID: "provider", id: "plan-model", variant: "low" }
  const switched = Promise.withResolvers<Omit<SessionSwitchAgentInput, "sessionID">>()
  const admitted = Promise.withResolvers<Omit<SessionPromptInput, "sessionID">>()
  const server = { canonical: root, readsAfterSwitch: 0, switched: false, executorPosts: 0, modelPosts: 0 }
  const location = { directory, project: { id: root.projectID, directory, canonical: directory } }
  await using setup = await renderSelectionPrompt(root, async (url, request) => {
    if (url.pathname === "/api/agent")
      return json({ location, data: [agent("meta"), { ...agent("build"), mode: "all" }, agent("plan", selectedModel)] })
    if (url.pathname === "/api/model")
      return json({ location, data: [model("shared", ["high"]), model("plan-model", ["low", "high"])] })
    if (url.pathname === "/api/session/" + root.id && request.method === "GET") {
      if (server.switched) server.readsAfterSwitch++
      return json({ data: server.canonical })
    }
    if (url.pathname === "/api/session/" + root.id + "/agent" && request.method === "POST") {
      const payload: Omit<SessionSwitchAgentInput, "sessionID"> = await request.json()
      server.switched = true
      server.canonical = { ...root, agent: payload.agent, model: payload.model ?? undefined }
      switched.resolve(payload)
      return new Response(null, { status: 204 })
    }
    if (url.pathname === "/api/session/" + root.id + "/executor" && request.method === "POST") {
      server.executorPosts++
      return json({ data: server.canonical })
    }
    if (url.pathname === "/api/session/" + root.id + "/model" && request.method === "POST") {
      server.modelPosts++
      return new Response(null, { status: 204 })
    }
    if (url.pathname === "/api/session/" + root.id + "/prompt" && request.method === "POST") {
      const payload: Omit<SessionPromptInput, "sessionID"> = await request.json()
      admitted.resolve(payload)
      return json({
        data: {
          id: payload.id,
          sessionID: root.id,
          type: "user",
          time: { created: 1 },
          delivery: payload.delivery ?? "steer",
          payload: { text: payload.text },
        },
      })
    }
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Meta · shared Provider · low"))
  setup.mockInput.pressKey("F10")
  await setup.waitForFrame(
    (frame) => frame.includes("Select agent") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  await setup.mockInput.typeText("plan")
  await setup.renderOnce()
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Plan · plan-model Provider · low") &&
      setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )
  await setup.mockInput.typeText("historical root selection")
  setup.mockInput.pressEnter()
  expect(await switched.promise).toEqual({ agent: "plan", model: selectedModel })
  expect((await admitted.promise).text).toBe("historical root selection")
  expect(server.readsAfterSwitch).toBe(1)
  expect(server.canonical.agent).toBe("plan")
  expect(server.canonical.model).toEqual(selectedModel)
  expect(server.canonical.controller).toEqual(root.controller)
  expect(server.canonical.executorPreference).toEqual(root.executorPreference)
  expect(server.executorPosts).toBe(0)
  expect(server.modelPosts).toBe(0)
})

test("a manual agent switch supersedes the CLI agent after its commit", async () => {
  await using setup = await renderLocal({
    args: { agent: "build" },
    agents: [agent("build"), agent("plan")],
    sessions: [session("ses_first", { providerID: "provider", id: "first" })],
    fetch: selectionMessage,
  })
  await setup.data.session.sync("ses_first")
  setup.route.navigate({ type: "session", sessionID: "ses_first" })
  setup.local.agent.set("plan")
  await publishSelection(setup, "plan", "first")
  expect(setup.local.agent.current()?.id).toBe("plan")
  setup.route.navigate({ type: "home" })
  setup.route.navigate({ type: "session", sessionID: "ses_first" })
  expect(setup.local.agent.current()?.id).toBe("plan")
})

test("a late inactive-agent acknowledgment preserves its choice after the active agent commits", async () => {
  await using setup = await renderLocal({
    models: [model("first"), model("second"), model("third")],
    agents: [agent("build"), agent("plan", { providerID: "provider", id: "second" })],
    sessions: [session("ses_first", { providerID: "provider", id: "first" })],
    fetch: selectionMessage,
  })
  await setup.data.session.sync("ses_first")
  setup.route.navigate({ type: "session", sessionID: "ses_first" })
  setup.local.agent.set("plan")
  setup.local.model.set({ providerID: "provider", modelID: "third" })
  setup.local.model.trackSessionCommit("ses_first", { providerID: "provider", id: "third" }, "plan")
  setup.local.agent.set("build")
  await publishSelection(setup, "plan", "third")
  setup.local.model.trackSessionCommit("ses_first", { providerID: "provider", id: "first" }, "build")
  await publishSelection(setup, "build", "first")
  setup.local.agent.set("plan")
  expect(setup.local.model.current()).toMatchObject({ modelID: "third" })
})

test("same-model agent switches clear drafts without a model acknowledgment", async () => {
  await using setup = await renderLocal({
    models: [model("first"), model("second")],
    agents: [agent("build"), agent("plan")],
    sessions: [session("ses_first", { providerID: "provider", id: "first" })],
    fetch: selectionMessage,
  })
  await setup.data.session.sync("ses_first")
  setup.route.navigate({ type: "session", sessionID: "ses_first" })
  setup.local.agent.set("plan")
  setup.local.model.trackSessionCommit("ses_first", { providerID: "provider", id: "first" }, "plan")
  await publishSelection(setup, "plan", "first", false)
  await publishSelection(setup, "plan", "second")
  expect(setup.local.model.current()).toMatchObject({ modelID: "second" })
})

async function publishSelection(
  setup: Awaited<ReturnType<typeof renderLocal>>,
  agent: string,
  modelID: string,
  changed = true,
) {
  setup.events.emit({
    id: `evt_${crypto.randomUUID()}`,
    type: "session.agent.selected",
    created: 1,
    durable: { aggregateID: "ses_first", seq: 1, version: 1 },
    data: { sessionID: "ses_first", agent },
  })
  if (changed)
    setup.events.emit({
      id: `evt_${crypto.randomUUID()}_${modelID}`,
      type: "session.model.selected",
      created: 2,
      durable: { aggregateID: "ses_first", seq: 2, version: 1 },
      data: { sessionID: "ses_first", model: { providerID: "provider", id: modelID } },
    })
  await setup.waitFor(async () => {
    await Bun.sleep(10)
    const session = setup.data.session.get("ses_first")
    return (
      session?.agent === agent && session.model !== undefined && "id" in session.model && session.model.id === modelID
    )
  })
}

function selectionMessage(url: URL) {
  if (!url.pathname.includes("/message/")) return
  const id = url.pathname.split("/").at(-1)!
  return json({
    data: {
      id,
      type: "model-switched",
      model: { providerID: "provider", id: id.split("_").at(-1) },
      time: { created: 2 },
    },
  })
}

function metaSelectionSession(): SessionInfo {
  return {
    ...session("ses_meta_selection", { providerID: "provider", id: "shared", variant: "low" }, "meta"),
    controller: { kind: "root", metaAgentID: "mag_selection", rootSessionID: "ses_meta_selection" },
    executorPreference: { agent: "build", model: { providerID: "provider", id: "shared", variant: "high" } },
  }
}

test("Session and executor owners preserve separate raw variants through the real picker", async () => {
  const root = metaSelectionSession()
  await using setup = await renderLocal({
    models: [model("shared", ["default", "low", "high"])],
    agents: [
      agent("meta"),
      { ...agent("build"), mode: "all" },
      { ...agent("explore", { providerID: "provider", id: "shared", variant: "low" }), mode: "subagent" },
      agent("plan"),
    ],
    sessions: [root],
  })
  await setup.data.session.sync(root.id)
  setup.route.navigate({ type: "session", sessionID: root.id })
  expect(setup.local.agent.current()?.id).toBe("meta")
  expect(setup.local.agent.list().map((item) => item.id)).toEqual(["meta", "build", "plan"])
  expect(setup.local.executor.agent.current()?.id).toBe("build")
  expect(setup.local.executor.agent.list().map((item) => item.id)).toEqual(["build", "explore"])
  setup.local.executor.agent.set("plan")
  expect(setup.local.executor.agent.current()?.id).toBe("build")
  expect(setup.local.model.selection()?.variant).toBe("low")
  setup.local.executor.agent.set("explore")
  setup.local.executor.model.set({ providerID: "provider", modelID: "shared" })
  setup.local.executor.model.variant.set("default")
  expect(setup.local.model.selection()?.variant).toBe("low")
  expect(setup.local.executor.preference()).toEqual({
    agent: "explore",
    model: { providerID: "provider", id: "shared", variant: "default" },
  })

  setup.dialog.replace(() => <DialogVariant />)
  await setup.waitForFrame(
    (frame) => frame.includes("Select variant") && frame.includes("Default") && frame.includes("default"),
  )
  if (!(setup.renderer.currentFocusedRenderable instanceof InputRenderable))
    await once(setup.renderer, CliRenderEvents.FOCUSED_RENDERABLE)
  setup.mockInput.pressKey("HOME")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.dialog.stack.length === 0)
  expect(setup.local.model.selection()?.variant).toBeUndefined()
  expect(physicalModel(setup.local.executor.preference()?.model)?.variant).toBe("default")

  setup.dialog.replace(() => <DialogVariant />)
  await setup.waitForFrame((frame) => frame.includes("Select variant") && frame.includes("default"))
  if (!(setup.renderer.currentFocusedRenderable instanceof InputRenderable))
    await once(setup.renderer, CliRenderEvents.FOCUSED_RENDERABLE)
  setup.mockInput.pressKey("HOME")
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.dialog.stack.length === 0)
  expect(setup.local.model.selection()?.variant).toBe("default")

  setup.dialog.replace(() => (
    <LocalModelProvider domain="executor">
      <DialogVariant />
    </LocalModelProvider>
  ))
  await setup.waitForFrame((frame) => frame.includes("Select variant"))
  if (!(setup.renderer.currentFocusedRenderable instanceof InputRenderable))
    await once(setup.renderer, CliRenderEvents.FOCUSED_RENDERABLE)
  setup.mockInput.pressKey("HOME")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.dialog.stack.length === 0)
  expect(physicalModel(setup.local.executor.preference()?.model)?.variant).toBeUndefined()
  expect(setup.local.model.selection()?.variant).toBe("default")
  expect(physicalModel(setup.data.session.get(root.id)?.model)?.variant).toBe("low")
  expect(physicalModel(setup.data.session.get(root.id)?.executorPreference?.model)?.variant).toBe("high")
})

test("Session child owner shows the adopted subagent and rejects changed complete selections", async () => {
  const child: SessionInfo = {
    ...session("ses_meta_child_selection", { providerID: "provider", id: "shared", variant: "default" }, "worker"),
    mode: "coding",
    parentID: "ses_meta_selection",
    controller: {
      kind: "child",
      metaAgentID: "mag_selection",
      rootSessionID: "ses_meta_selection",
      executor: {
        agent: "worker",
        model: { providerID: "provider", id: "shared", variant: "default" },
        source: "tool",
      },
      source: { kind: "subagent", assistantMessageID: "msg_selection", toolCallID: "call_selection" },
    },
  }
  await using setup = await renderLocal({
    models: [model("shared", ["default", "low"]), model("other")],
    agents: [
      { ...agent("build"), mode: "all" },
      { ...agent("worker"), mode: "subagent", originKind: "user", ordinaryModes: ["custom"] },
    ],
    sessions: [child],
  })
  await setup.data.session.sync(child.id)
  setup.route.navigate({ type: "session", sessionID: child.id })
  expect(setup.local.locked()).toBe(true)
  expect(setup.local.agent.current()?.id).toBe("worker")
  expect(setup.local.executor.agent.list().map((item) => item.id)).toEqual(["worker"])
  expect(setup.local.model.selection()?.variant).toBe("default")
  setup.local.agent.set("build")
  setup.local.model.set({ providerID: "provider", modelID: "other" })
  setup.local.model.variant.set(undefined)
  expect(setup.local.agent.current()?.id).toBe("worker")
  expect(setup.local.model.selection()).toEqual({ providerID: "provider", modelID: "shared", variant: "default" })
  setup.local.agent.set("worker")
  setup.local.model.set({ providerID: "provider", modelID: "shared" })
  setup.local.model.variant.set("default")
  expect(setup.data.session.get(child.id)).toEqual(child)
})

test("canonical acknowledgments reconcile each domain without erasing later local edits", async () => {
  const root = metaSelectionSession()
  await using setup = await renderLocal({
    models: [model("shared", ["default", "low", "high"])],
    agents: [agent("meta"), { ...agent("build"), mode: "all" }, { ...agent("explore"), mode: "subagent" }],
    sessions: [root],
  })
  await setup.data.session.sync(root.id)
  setup.route.navigate({ type: "session", sessionID: root.id })
  setup.local.executor.agent.set("explore")
  setup.local.executor.model.set({ providerID: "provider", modelID: "shared" })
  setup.local.executor.model.variant.set("default")
  setup.local.model.variant.set("high")
  setup.local.model.trackSessionCommit(root.id, { providerID: "provider", id: "shared", variant: "high" }, "meta")
  setup.local.executor.trackCommit(root.id, {
    agent: "explore",
    model: { providerID: "provider", id: "shared", variant: "default" },
  })
  setup.local.model.variant.set(undefined)
  setup.local.executor.model.variant.set("low")

  setup.data.session.remember({
    ...root,
    model: { providerID: "provider", id: "shared", variant: "high" },
    executorPreference: { agent: "explore", model: { providerID: "provider", id: "shared", variant: "default" } },
    time: { ...root.time, updated: 1 },
  })
  await setup.waitFor(() => setup.data.session.get(root.id)?.time.updated === 1)
  expect(setup.local.model.selection()?.variant).toBeUndefined()
  expect(physicalModel(setup.local.executor.preference()?.model)?.variant).toBe("low")
  expect(setup.local.agent.current()?.id).toBe("meta")
  expect(setup.local.executor.agent.current()?.id).toBe("explore")
})

test("an explicit unavailable Session executor never selects the first primary agent", async () => {
  const root = {
    ...metaSelectionSession(),
    executorPreference: { agent: "missing", model: { providerID: "provider", id: "missing", variant: "default" } },
  }
  await using setup = await renderLocal({
    models: [model("shared", ["default"])],
    agents: [agent("meta"), { ...agent("build"), mode: "all" }],
    sessions: [root],
  })
  await setup.data.session.sync(root.id)
  setup.route.navigate({ type: "session", sessionID: root.id })
  expect(setup.local.agent.current()?.id).toBe("meta")
  expect(setup.local.executor.agent.current()).toBeUndefined()
  expect(setup.local.executor.preference()).toEqual(root.executorPreference)
  expect(setup.local.executor.model.available()).toBe(false)
  expect(setup.local.model.selection()).toMatchObject({ modelID: "shared" })
})

test("fresh canonical readback releases only its captured Session and executor drafts", async () => {
  const root: SessionInfo = {
    ...metaSelectionSession(),
    model: { providerID: "provider", id: "shared" },
    executorPreference: { agent: "build", model: { providerID: "provider", id: "shared" } },
  }
  const requestedModel = { providerID: "provider", id: "shared", variant: "default" }
  const requestedExecutor = { agent: "build", model: requestedModel }
  let acknowledgments = 0
  await using setup = await renderLocal({
    models: [model("shared", ["default", "low", "high"])],
    agents: [
      agent("meta"),
      { ...agent("build"), mode: "all" },
      { ...agent("explore"), mode: "subagent" },
      agent("plan"),
    ],
    sessions: [root],
    fetch: async (url, request) => {
      if (url.pathname !== "/api/session/" + root.id + "/executor") return
      expect(await request.json()).toEqual(requestedExecutor)
      acknowledgments++
      // Effective-equivalent selection may preserve the old raw undefined variant.
      return json({ data: root })
    },
  })
  await setup.data.session.sync(root.id)
  setup.route.navigate({ type: "session", sessionID: root.id })
  setup.local.model.variant.set("default")
  setup.local.executor.model.variant.set("default")
  const earlierSession = setup.local.model.trackSessionCommit(root.id, requestedModel, "meta")
  const currentSession = setup.local.model.trackSessionCommit(root.id, requestedModel, "meta")
  const executor = setup.local.executor.trackCommit(root.id, requestedExecutor)
  await setup.data.session.selectExecutor({ sessionID: root.id, executorPreference: requestedExecutor })
  setup.data.session.invalidate(root.id)
  await setup.data.session.sync(root.id)
  earlierSession("acknowledge")
  expect(setup.local.model.selection()?.variant).toBe("default")
  currentSession("acknowledge")
  executor("acknowledge")
  expect(setup.local.model.selection()?.variant).toBeUndefined()
  expect(physicalModel(setup.local.executor.preference()?.model)?.variant).toBeUndefined()

  setup.local.model.variant.set("default")
  setup.local.executor.model.variant.set("default")
  const laterSession = setup.local.model.trackSessionCommit(root.id, requestedModel, "meta")
  const laterExecutor = setup.local.executor.trackCommit(root.id, requestedExecutor)
  setup.local.model.variant.set("high")
  setup.local.executor.model.variant.set("low")
  await setup.data.session.selectExecutor({ sessionID: root.id, executorPreference: requestedExecutor })
  setup.data.session.invalidate(root.id)
  await setup.data.session.sync(root.id)
  laterSession("acknowledge")
  laterExecutor("acknowledge")
  expect(setup.local.model.selection()?.variant).toBe("high")
  expect(physicalModel(setup.local.executor.preference()?.model)?.variant).toBe("low")
  expect(acknowledgments).toBe(2)
})

test.each(["success", "failure"] as const)(
  "replaced API %s preserves Session and executor drafts through canonical reconciliation and cleanup",
  async (outcome) => {
    const root: SessionInfo = {
      ...metaSelectionSession(),
      model: { providerID: "provider", id: "shared" },
      executorPreference: { agent: "build", model: { providerID: "provider", id: "shared" } },
    }
    const requestedModel = { providerID: "provider", id: "shared", variant: "default" }
    const requestedExecutor = { agent: "build", model: requestedModel }
    const replacementCanonical: SessionInfo = { ...metaSelectionSession(), time: { ...root.time, updated: 2 } }
    const replacementReads: SessionInfo[] = [
      { ...root, model: requestedModel, executorPreference: requestedExecutor, time: { ...root.time, updated: 1 } },
      replacementCanonical,
    ]
    const staleCanonical: SessionInfo = {
      ...root,
      model: requestedModel,
      executorPreference: requestedExecutor,
      time: { ...root.time, updated: 99 },
    }
    const sessionStarted = Promise.withResolvers<void>()
    const executorStarted = Promise.withResolvers<void>()
    const sessionResponse = Promise.withResolvers<Response>()
    const executorResponse = Promise.withResolvers<Response>()
    await using setup = await renderReconnectingSelection(
      async (url, request) => {
        if (url.pathname === "/api/session/" + root.id && request.method === "GET") return json({ data: root })
        if (url.pathname === "/api/session/" + root.id + "/model" && request.method === "POST") {
          expect(await request.json()).toEqual({ model: requestedModel })
          sessionStarted.resolve()
          return sessionResponse.promise
        }
        if (url.pathname === "/api/session/" + root.id + "/executor" && request.method === "POST") {
          expect(await request.json()).toEqual(requestedExecutor)
          executorStarted.resolve()
          return executorResponse.promise
        }
      },
      (url, request) => {
        if (url.pathname !== "/api/session/" + root.id || request.method !== "GET") return
        const canonical = replacementReads.shift()
        if (!canonical) throw new Error("Unexpected replacement session read")
        return json({ data: canonical })
      },
    )
    await setup.data.session.sync(root.id)
    setup.route.navigate({ type: "session", sessionID: root.id })
    setup.local.model.variant.set("default")
    setup.local.executor.model.variant.set("default")
    const releaseSession = setup.local.model.trackSessionCommit(root.id, requestedModel, "meta")
    const releaseExecutor = setup.local.executor.trackCommit(root.id, requestedExecutor)
    const completion = Promise.allSettled([
      setup.client.api.session.switchModel({ sessionID: root.id, model: requestedModel }),
      setup.data.session.selectExecutor({ sessionID: root.id, executorPreference: requestedExecutor }),
    ])
    try {
      await Promise.all([sessionStarted.promise, executorStarted.promise])
      await setup.replaceClient()
      expect(setup.client.api).toBe(setup.replacement)
      setup.data.session.invalidate(root.id)
      await setup.data.session.sync(root.id)
      await setup.renderOnce()
      expect(physicalModel(setup.data.session.get(root.id)?.model)?.variant).toBe("default")
      expect(physicalModel(setup.data.session.get(root.id)?.executorPreference?.model)?.variant).toBe("default")

      // A coincident raw match from B cannot acknowledge A's pending attempt.
      setup.data.session.invalidate(root.id)
      await setup.data.session.sync(root.id)
      await setup.renderOnce()
      expect(setup.local.model.selection()?.variant).toBe("default")
      expect(physicalModel(setup.local.executor.preference()?.model)?.variant).toBe("default")
      expect(setup.data.session.get(root.id)).toEqual(replacementCanonical)

      sessionResponse.resolve(outcome === "success" ? new Response(null, { status: 204 }) : json({}, { status: 500 }))
      executorResponse.resolve(outcome === "success" ? json({ data: staleCanonical }) : json({}, { status: 500 }))
      expect((await completion).map((result) => result.status)).toEqual(
        outcome === "success" ? ["fulfilled", "fulfilled"] : ["rejected", "rejected"],
      )
      releaseSession(outcome === "success" ? "acknowledge" : "cancel")
      releaseExecutor(outcome === "success" ? "acknowledge" : "cancel")
      expect(setup.local.model.selection()?.variant).toBe("default")
      expect(physicalModel(setup.local.executor.preference()?.model)?.variant).toBe("default")
      expect(setup.data.session.get(root.id)).toEqual(replacementCanonical)
    } finally {
      sessionResponse.resolve(new Response(null, { status: 204 }))
      executorResponse.resolve(json({ data: staleCanonical }))
      await completion
    }
  },
)

test("old API completion cannot discard newer identical Session and executor attempts under its replacement", async () => {
  const root: SessionInfo = {
    ...metaSelectionSession(),
    model: { providerID: "provider", id: "shared" },
    executorPreference: { agent: "build", model: { providerID: "provider", id: "shared" } },
  }
  const requestedModel = { providerID: "provider", id: "shared", variant: "default" }
  const requestedExecutor = { agent: "build", model: requestedModel }
  const canonical: SessionInfo = { ...root, time: { ...root.time, updated: 2 } }
  const replacementReads: SessionInfo[] = [{ ...root, time: { ...root.time, updated: 1 } }, canonical]
  const earlierSessionStarted = Promise.withResolvers<void>()
  const earlierExecutorStarted = Promise.withResolvers<void>()
  const currentSessionStarted = Promise.withResolvers<void>()
  const currentExecutorStarted = Promise.withResolvers<void>()
  const earlierSessionResponse = Promise.withResolvers<Response>()
  const earlierExecutorResponse = Promise.withResolvers<Response>()
  const currentSessionResponse = Promise.withResolvers<Response>()
  const currentExecutorResponse = Promise.withResolvers<Response>()
  await using setup = await renderReconnectingSelection(
    async (url, request) => {
      if (url.pathname === "/api/session/" + root.id && request.method === "GET") return json({ data: root })
      if (url.pathname === "/api/session/" + root.id + "/model" && request.method === "POST") {
        expect(await request.json()).toEqual({ model: requestedModel })
        earlierSessionStarted.resolve()
        return earlierSessionResponse.promise
      }
      if (url.pathname === "/api/session/" + root.id + "/executor" && request.method === "POST") {
        expect(await request.json()).toEqual(requestedExecutor)
        earlierExecutorStarted.resolve()
        return earlierExecutorResponse.promise
      }
    },
    async (url, request) => {
      if (url.pathname === "/api/session/" + root.id && request.method === "GET") {
        const read = replacementReads.shift()
        if (!read) throw new Error("Unexpected replacement session read")
        return json({ data: read })
      }
      if (url.pathname === "/api/session/" + root.id + "/model" && request.method === "POST") {
        expect(await request.json()).toEqual({ model: requestedModel })
        currentSessionStarted.resolve()
        return currentSessionResponse.promise
      }
      if (url.pathname === "/api/session/" + root.id + "/executor" && request.method === "POST") {
        expect(await request.json()).toEqual(requestedExecutor)
        currentExecutorStarted.resolve()
        return currentExecutorResponse.promise
      }
    },
  )
  await setup.data.session.sync(root.id)
  setup.route.navigate({ type: "session", sessionID: root.id })
  setup.local.model.variant.set("default")
  setup.local.executor.model.variant.set("default")
  const earlierSession = setup.local.model.trackSessionCommit(root.id, requestedModel, "meta")
  const earlierExecutor = setup.local.executor.trackCommit(root.id, requestedExecutor)
  const earlierCompletion = Promise.allSettled([
    setup.client.api.session.switchModel({ sessionID: root.id, model: requestedModel }),
    setup.data.session.selectExecutor({ sessionID: root.id, executorPreference: requestedExecutor }),
  ])
  try {
    await Promise.all([earlierSessionStarted.promise, earlierExecutorStarted.promise])
    await setup.replaceClient()
    expect(setup.client.api).toBe(setup.replacement)
    setup.data.session.invalidate(root.id)
    await setup.data.session.sync(root.id)
    const currentSession = setup.local.model.trackSessionCommit(root.id, requestedModel, "meta")
    const currentExecutor = setup.local.executor.trackCommit(root.id, requestedExecutor)
    const currentCompletion = Promise.allSettled([
      setup.client.api.session.switchModel({ sessionID: root.id, model: requestedModel }),
      setup.data.session.selectExecutor({ sessionID: root.id, executorPreference: requestedExecutor }),
    ])
    await Promise.all([currentSessionStarted.promise, currentExecutorStarted.promise])
    earlierSessionResponse.resolve(new Response(null, { status: 204 }))
    earlierExecutorResponse.resolve(json({ data: root }))
    expect((await earlierCompletion).map((result) => result.status)).toEqual(["fulfilled", "fulfilled"])
    earlierSession("acknowledge")
    earlierExecutor("acknowledge")
    expect(setup.local.model.selection()?.variant).toBe("default")
    expect(physicalModel(setup.local.executor.preference()?.model)?.variant).toBe("default")

    currentSessionResponse.resolve(new Response(null, { status: 204 }))
    currentExecutorResponse.resolve(json({ data: canonical }))
    expect((await currentCompletion).map((result) => result.status)).toEqual(["fulfilled", "fulfilled"])
    setup.data.session.invalidate(root.id)
    await setup.data.session.sync(root.id)
    currentSession("acknowledge")
    currentExecutor("acknowledge")
    expect(setup.local.model.selection()?.variant).toBeUndefined()
    expect(physicalModel(setup.local.executor.preference()?.model)?.variant).toBeUndefined()
    expect(setup.data.session.get(root.id)).toEqual(canonical)
  } finally {
    earlierSessionResponse.resolve(new Response(null, { status: 204 }))
    earlierExecutorResponse.resolve(json({ data: root }))
    currentSessionResponse.resolve(new Response(null, { status: 204 }))
    currentExecutorResponse.resolve(json({ data: canonical }))
    await earlierCompletion
  }
})

async function renderReconnectingSelection(initialFetch: FetchHandler, replacementFetch: FetchHandler) {
  const temporary = await tmpdir()
  const initialEvents = createEventStream()
  const replacementEvents = createEventStream()
  function selectionApi(fetch: FetchHandler, events: ReturnType<typeof createEventStream>) {
    return createApi(
      createFetch(async (url, request) => {
        const response = await fetch(url, request)
        if (response) return response
        const location = { directory }
        if (url.pathname === "/api/agent")
          return json({ location, data: [agent("meta"), { ...agent("build"), mode: "all" }] })
        if (url.pathname === "/api/model")
          return json({ location, data: [model("shared", ["default", "low", "high"])] })
      }, events).fetch,
    )
  }
  const initial = selectionApi(initialFetch, initialEvents)
  const replacement = selectionApi(replacementFetch, replacementEvents)
  const ready = Promise.withResolvers<{
    local: ReturnType<typeof useLocal>
    route: ReturnType<typeof useRoute>
    data: ReturnType<typeof useData>
    client: ReturnType<typeof useClient>
  }>()
  const replaced = Promise.withResolvers<void>()
  function Probe() {
    const local = useLocal()
    const route = useRoute()
    const data = useData()
    const client = useClient()
    createEffect(() => {
      if (client.connection.status() !== "connected") return
      if (client.api === replacement) replaced.resolve()
      if (local.model.ready) ready.resolve({ local, route, data, client })
    })
    return <box />
  }
  const setup = await testRender(
    () => (
      <TestTuiContexts paths={{ state: temporary.path }}>
        <ArgsProvider>
          <ConfigProvider config={createTuiResolvedConfig()}>
            <Keymap.Provider>
              <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
                <ToastProvider>
                  <RouteProvider initialRoute={{ type: "home" }}>
                    <ClientProvider
                      api={initial}
                      service={{ reconnect: async () => ({ api: replacement }), restart: async () => {} }}
                    >
                      <DataProvider directory={directory}>
                        <LocationProvider>
                          <PermissionProvider>
                            <LocalProvider>
                              <DialogProvider>
                                <Probe />
                              </DialogProvider>
                            </LocalProvider>
                          </PermissionProvider>
                        </LocationProvider>
                      </DataProvider>
                    </ClientProvider>
                  </RouteProvider>
                </ToastProvider>
              </ThemeProvider>
            </Keymap.Provider>
          </ConfigProvider>
        </ArgsProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 30, kittyKeyboard: true },
  )
  const context = await ready.promise
  await context.data.location.sync()
  return {
    ...setup,
    ...context,
    replacement,
    async replaceClient() {
      initialEvents.disconnect()
      await replaced.promise
    },
    async [Symbol.asyncDispose]() {
      setup.renderer.destroy()
      initialEvents.disconnect()
      replacementEvents.disconnect()
      await temporary[Symbol.asyncDispose]()
    },
  }
}

test.each([
  ["session", false],
  ["executor", false],
  ["session", true],
  ["executor", true],
] as const)(
  "same-API pre-ACK %s GET preserves the draft and a newer identical attempt (same raw selection: %s)",
  async (domain, sameRaw) => {
    const root: SessionInfo = {
      ...metaSelectionSession(),
      model: { providerID: "provider", id: "shared", variant: "high" },
      executorPreference: { agent: "build", model: { providerID: "provider", id: "shared", variant: "high" } },
      time: { created: 0, updated: 1 },
    }
    const requestedModel = { providerID: "provider", id: "shared", variant: sameRaw ? "high" : "low" }
    const requestedExecutor = { agent: "build", model: requestedModel }
    const matching: SessionInfo = {
      ...root,
      model: requestedModel,
      executorPreference: requestedExecutor,
      time: { ...root.time, updated: 2 },
    }
    const followingVariant = sameRaw ? "low" : "high"
    const following: SessionInfo = {
      ...root,
      model: { ...requestedModel, variant: followingVariant },
      executorPreference: { agent: "build", model: { ...requestedModel, variant: followingVariant } },
      time: { ...root.time, updated: 3 },
    }
    const server = { canonical: root, holdRead: false, mutations: 0 }
    const readStarted = Promise.withResolvers<void>()
    const preAckRead = Promise.withResolvers<Response>()
    const attempts = [0, 1].map(() => ({
      started: Promise.withResolvers<void>(),
      response: Promise.withResolvers<Response>(),
    }))
    await using setup = await renderReconnectingSelection(
      async (url, request) => {
        if (url.pathname === "/api/session/" + root.id && request.method === "GET") {
          if (server.holdRead) {
            server.holdRead = false
            readStarted.resolve()
            return preAckRead.promise
          }
          return json({ data: server.canonical })
        }
        const endpoint = domain === "session" ? "model" : "executor"
        if (url.pathname !== "/api/session/" + root.id + "/" + endpoint || request.method !== "POST") return
        expect(await request.json()).toEqual(domain === "session" ? { model: requestedModel } : requestedExecutor)
        const attempt = attempts[server.mutations++]
        if (!attempt) throw new Error("Unexpected same-API selection request")
        attempt.started.resolve()
        return attempt.response.promise
      },
      () => undefined,
    )
    await setup.data.session.sync(root.id)
    setup.route.navigate({ type: "session", sessionID: root.id })
    const owner = domain === "session" ? setup.local.selection.model : setup.local.executor.model
    if (!sameRaw) owner.variant.set("low")
    server.holdRead = true
    setup.data.session.invalidate(root.id)
    const reading = setup.data.session.sync(root.id)
    await readStarted.promise
    const track = () =>
      domain === "session"
        ? setup.local.selection.model.trackSessionCommit(root.id, requestedModel, "meta")
        : setup.local.executor.trackCommit(root.id, requestedExecutor)
    const send = () =>
      domain === "session"
        ? setup.client.api.session.switchModel({ sessionID: root.id, model: requestedModel })
        : setup.data.session.selectExecutor({ sessionID: root.id, executorPreference: requestedExecutor })
    const earlier = track()
    const completions = [Promise.allSettled([send()])]
    try {
      await attempts[0]!.started.promise
      preAckRead.resolve(json({ data: matching }))
      await reading
      await setup.renderOnce()
      expect(setup.data.session.get(root.id)?.time.updated).toBe(2)
      expect(owner.variant.selected()).toBe(requestedModel.variant)

      server.canonical = following
      setup.data.session.invalidate(root.id)
      await setup.data.session.sync(root.id)
      await setup.renderOnce()
      // An earlier matching GET cannot acknowledge this mutation, including a same-value attempt.
      expect(setup.data.session.get(root.id)?.time.updated).toBe(3)
      expect(owner.variant.selected()).toBe(requestedModel.variant)

      const current = track()
      completions.push(Promise.allSettled([send()]))
      await attempts[1]!.started.promise
      attempts[0]!.response.resolve(
        domain === "session" ? new Response(null, { status: 204 }) : json({ data: following }),
      )
      expect((await completions[0]!).map((result) => result.status)).toEqual(["fulfilled"])
      earlier("acknowledge")
      expect(owner.variant.selected()).toBe(requestedModel.variant)

      server.canonical = { ...matching, time: { ...root.time, updated: 4 } }
      attempts[1]!.response.resolve(
        domain === "session" ? new Response(null, { status: 204 }) : json({ data: server.canonical }),
      )
      expect((await completions[1]!).map((result) => result.status)).toEqual(["fulfilled"])
      if (domain === "session") {
        setup.data.session.invalidate(root.id)
        await setup.data.session.sync(root.id)
      }
      current("acknowledge")
      server.canonical = { ...following, time: { ...root.time, updated: 5 } }
      setup.data.session.invalidate(root.id)
      await setup.data.session.sync(root.id)
      await setup.renderOnce()
      expect(owner.variant.selected()).toBe(followingVariant)
      expect(server.mutations).toBe(2)
    } finally {
      preAckRead.resolve(json({ data: root }))
      attempts.forEach((attempt) =>
        attempt.response.resolve(domain === "session" ? new Response(null, { status: 204 }) : json({ data: root })),
      )
      await reading
      await Promise.all(completions)
    }
  },
)

test.each([
  ["session", "success", false],
  ["executor", "success", false],
  ["session", "failure", false],
  ["executor", "failure", false],
  ["session", "readback-failure", false],
  ["session", "success", true],
  ["executor", "success", true],
  ["session", "failure", true],
  ["executor", "failure", true],
  ["session", "readback-failure", true],
  ["executor", "canonical-mismatch", false],
  ["executor", "canonical-mismatch", true],
] as const)(
  "production Prompt %s %s acknowledges only its captured draft (later edit: %s)",
  async (domain, outcome, laterEdit) => {
    const root: SessionInfo = {
      ...promptSelectionSession(),
      model: { providerID: "provider", id: "shared", variant: "high" },
      executorPreference: { agent: "build", model: { providerID: "provider", id: "shared", variant: "high" } },
    }
    const requestedModel = { providerID: "provider", id: "shared", variant: domain === "session" ? "default" : "high" }
    const requestedExecutor = {
      agent: "build",
      model: { providerID: "provider", id: "shared", variant: domain === "executor" ? "default" : "high" },
    }
    const server = { canonical: root, readback: false, commands: 0 }
    const started = Promise.withResolvers<void>()
    const response = Promise.withResolvers<Response>()
    const readStarted = Promise.withResolvers<void>()
    const readResponse = Promise.withResolvers<Response>()
    const commandStarted = Promise.withResolvers<void>()
    await using setup = await renderSelectionPrompt(root, async (url, request) => {
      if (url.pathname === "/api/session/" + root.id && request.method === "GET") {
        if (server.readback) readStarted.resolve()
        if (server.readback && outcome === "readback-failure") return readResponse.promise
        return json({ data: server.canonical })
      }
      if (url.pathname === "/api/session/" + root.id + "/agent")
        throw new Error("Session root must preserve its runtime agent")
      if (url.pathname === "/api/session/" + root.id + "/executor" && request.method === "POST") {
        expect(await request.json()).toEqual(requestedExecutor)
        if (domain === "executor") {
          started.resolve()
          return response.promise
        }
        return json({ data: server.canonical })
      }
      if (url.pathname === "/api/session/" + root.id + "/model" && request.method === "POST") {
        expect(await request.json()).toEqual({ model: requestedModel })
        if (domain === "session") {
          server.readback = true
          started.resolve()
          return response.promise
        }
        return new Response(null, { status: 204 })
      }
      if (url.pathname === "/api/session/" + root.id + "/command" && request.method === "POST") {
        expect(await request.json()).toEqual({
          name: "review",
          text: "selection",
          files: [],
          agents: [],
          delivery: "steer",
        })
        server.commands++
        commandStarted.resolve()
        return new Response(null, { status: 204 })
      }
    })
    try {
      await setup.ready
      await setup.waitForFrame(
        (frame) =>
          frame.includes("Meta · shared Provider · high") &&
          setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
      )
      await choosePromptVariant(setup, domain, "default")
      expect(setup.captureCharFrame()).toContain(
        "Meta · shared Provider · " + (domain === "session" ? "default" : "high"),
      )
      await setup.mockInput.typeText("/review selection")
      setup.mockInput.pressEscape()
      setup.mockInput.pressEnter()
      await started.promise
      if (laterEdit) await choosePromptVariant(setup, domain, "low")

      if (outcome === "failure") response.resolve(json({}, { status: 500 }))
      if (outcome === "canonical-mismatch") response.resolve(json({ data: root }))
      if (outcome === "readback-failure") {
        response.resolve(new Response(null, { status: 204 }))
        await readStarted.promise
        // A successful 204 alone does not acknowledge a failed fresh readback.
        await setup.waitForFrame((frame) =>
          frame.includes("Meta · shared Provider · " + (laterEdit ? "low" : "default")),
        )
        readResponse.resolve(json({}, { status: 500 }))
      }
      if (outcome === "success") {
        server.canonical =
          domain === "session"
            ? { ...root, model: { providerID: "provider", id: "shared" }, time: { ...root.time, updated: 1 } }
            : {
                ...root,
                executorPreference: { agent: "build", model: { providerID: "provider", id: "shared" } },
                time: { ...root.time, updated: 1 },
              }
        response.resolve(domain === "session" ? new Response(null, { status: 204 }) : json({ data: server.canonical }))
        if (domain === "session") await readStarted.promise
        await commandStarted.promise
        await assertPromptVariant(setup, domain, laterEdit ? "low" : undefined)
        expect(server.commands).toBe(1)
      }
      if (outcome !== "success") {
        await setup.waitForFrame((frame) => frame.includes("Failed to run command"))
        await assertPromptVariant(setup, domain, laterEdit ? "low" : "default")
        expect(server.commands).toBe(0)
      }
      await assertPromptVariant(setup, domain === "session" ? "executor" : "session", "high")
      expect(server.canonical.agent).toBe("meta")
    } finally {
      response.resolve(domain === "session" ? new Response(null, { status: 204 }) : json({ data: root }))
      readResponse.resolve(json({ data: root }))
    }
  },
)

function promptSelectionSession(): SessionInfo {
  const id = "ses_meta_prompt_" + crypto.randomUUID()
  return {
    ...metaSelectionSession(),
    id,
    controller: { kind: "root", metaAgentID: "mag_meta_prompt", rootSessionID: id },
  }
}

async function renderSelectionPrompt(root: SessionInfo, fetch: FetchHandler) {
  const location = { directory, project: { id: root.projectID, directory, canonical: directory } }
  return createAppFixture({
    args: { sessionID: root.id },
    config: { animations: false, keybinds: { "variant.list": "f9", "agent.list": "f10" } },
    fetch: async (url, request) => {
      const response = await fetch(url, request)
      if (response) return response
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/agent")
        return json({
          location,
          data: [agent("meta"), { ...agent("build"), mode: "all" }, { ...agent("explore"), mode: "subagent" }],
        })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model") return json({ location, data: [model("shared", ["default", "low", "high"])] })
      if (url.pathname === "/api/command") return json({ location, data: [{ name: "review", description: "Review" }] })
      if (url.pathname === "/api/session/" + root.id) return json({ data: root })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
    },
  })
}

async function choosePromptVariant(
  setup: Awaited<ReturnType<typeof createAppFixture>>,
  domain: "session" | "executor",
  variant: "default" | "low",
) {
  await openPromptVariant(setup, domain)
  setup.mockInput.pressKey("HOME")
  Array.from({ length: variant === "default" ? 1 : 2 }).forEach(() => setup.mockInput.pressArrow("down"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) =>
      (domain === "executor" || frame.includes("Meta · shared Provider · " + variant)) &&
      setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )
}

async function openPromptExecutor(setup: Awaited<ReturnType<typeof createAppFixture>>) {
  setup.mockInput.pressKey("F10")
  await setup.waitForFrame(
    (frame) => frame.includes("Select agent") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  setup.mockInput.pressTab()
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) => frame.includes("Select executor") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
}

async function openPromptVariant(setup: Awaited<ReturnType<typeof createAppFixture>>, domain: "session" | "executor") {
  if (domain === "session") setup.mockInput.pressKey("F9")
  if (domain === "executor") {
    await openPromptExecutor(setup)
    setup.mockInput.pressEnter()
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Select executor model") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
    )
    await setup.mockInput.typeText("shared")
    await setup.renderOnce()
    setup.mockInput.pressEnter()
  }
  await setup.waitForFrame(
    (frame) => frame.includes("Select variant") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
}

async function assertPromptVariant(
  setup: Awaited<ReturnType<typeof createAppFixture>>,
  domain: "session" | "executor",
  variant: string | undefined,
) {
  await openPromptVariant(setup, domain)
  // The current marker preserves the raw distinction between Default and literal default.
  await setup.waitForFrame((frame) =>
    frame.split("\n").some((line) => new RegExp("●\\s+" + (variant ?? "Default") + "(?:\\s|$)").test(line)),
  )
  setup.mockInput.pressEscape()
  await setup.waitForFrame(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
}

test.each([false, true])(
  "production Prompt cancels a same-API discarded Session readback (later edit: %s)",
  async (laterEdit) => {
    const root: SessionInfo = {
      ...promptSelectionSession(),
      model: { providerID: "provider", id: "shared", variant: "high" },
      executorPreference: { agent: "build", model: { providerID: "provider", id: "shared", variant: "high" } },
    }
    const requestedModel = { providerID: "provider", id: "shared", variant: "default" }
    const readStarted = Promise.withResolvers<void>()
    const readResponse = Promise.withResolvers<Response>()
    const commandStarted = Promise.withResolvers<void>()
    const server = { reading: false, reads: 0, commands: 0 }
    await using setup = await renderSelectionPrompt(root, async (url, request) => {
      if (url.pathname === "/api/session/" + root.id && request.method === "GET") {
        if (!server.reading) return json({ data: root })
        server.reads++
        readStarted.resolve()
        return readResponse.promise
      }
      if (url.pathname === "/api/session/" + root.id + "/executor" && request.method === "POST") {
        expect(await request.json()).toEqual(root.executorPreference)
        return json({ data: root })
      }
      if (url.pathname === "/api/session/" + root.id + "/model" && request.method === "POST") {
        expect(await request.json()).toEqual({ model: requestedModel })
        server.reading = true
        return new Response(null, { status: 204 })
      }
      if (url.pathname === "/api/session/" + root.id + "/command" && request.method === "POST") {
        server.commands++
        commandStarted.resolve()
        return new Response(null, { status: 204 })
      }
    })
    const variant = laterEdit ? "low" : "default"
    try {
      await setup.ready
      await setup.waitForFrame(
        (frame) =>
          frame.includes("Meta · shared Provider · high") &&
          setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
      )
      await choosePromptVariant(setup, "session", "default")
      await setup.mockInput.typeText("/review selection")
      setup.mockInput.pressEscape()
      setup.mockInput.pressEnter()
      await readStarted.promise
      if (laterEdit) await choosePromptVariant(setup, "session", "low")
      await openPromptExecutor(setup)
      setup.events.emit({
        id: "evt_session_readback_invalidated_" + crypto.randomUUID(),
        type: "session.executor.selected",
        created: 1,
        durable: { aggregateID: root.id, seq: 1, version: 1 },
        data: {
          sessionID: root.id,
          executorPreference: { agent: "explore", model: { providerID: "provider", id: "shared", variant: "low" } },
        },
      })
      // The executor picker adopts the same API event before the held GET completes.
      await setup.waitForFrame(
        (frame) =>
          frame.split("\n").some((line) => line.includes("●") && line.includes("explore")) &&
          frame.includes("Meta · shared Provider · " + variant),
      )
      setup.mockInput.pressEscape()
      await setup.waitForFrame(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
      const terminal = Promise.race([
        setup.waitForFrame((frame) => frame.includes("Failed to run command")).then(() => "cancel"),
        commandStarted.promise.then(() => "command"),
      ])
      // This snapshot is newer than the event; current() alone must exclude its publication.
      readResponse.resolve(
        json({
          data: {
            ...root,
            model: { providerID: "provider", id: "shared" },
            time: { ...root.time, updated: 2 },
          },
        }),
      )
      expect(await terminal).toBe("cancel")
      expect(setup.captureCharFrame()).toContain("Meta · shared Provider · " + variant)
      await assertPromptVariant(setup, "executor", "low")
      expect(server.commands).toBe(0)
      expect(server.reads).toBe(1)
    } finally {
      readResponse.resolve(json({ data: root }))
    }
  },
)

test.each([false, true])(
  "production Prompt cancels an adopted Session GET that differs from its request (later edit: %s)",
  async (laterEdit) => {
    const root: SessionInfo = {
      ...promptSelectionSession(),
      model: { providerID: "provider", id: "shared", variant: "high" },
      executorPreference: { agent: "build", model: { providerID: "provider", id: "shared", variant: "high" } },
    }
    const requestedModel = { providerID: "provider", id: "shared", variant: "default" }
    const readStarted = Promise.withResolvers<void>()
    const readResponse = Promise.withResolvers<Response>()
    const commandStarted = Promise.withResolvers<void>()
    const server = { reading: false, reads: 0, commands: 0 }
    await using setup = await renderSelectionPrompt(root, async (url, request) => {
      if (url.pathname === "/api/session/" + root.id && request.method === "GET") {
        if (!server.reading) return json({ data: root })
        server.reads++
        readStarted.resolve()
        return readResponse.promise
      }
      if (url.pathname === "/api/session/" + root.id + "/executor" && request.method === "POST") {
        expect(await request.json()).toEqual(root.executorPreference)
        return json({ data: root })
      }
      if (url.pathname === "/api/session/" + root.id + "/model" && request.method === "POST") {
        expect(await request.json()).toEqual({ model: requestedModel })
        server.reading = true
        return new Response(null, { status: 204 })
      }
      if (url.pathname === "/api/session/" + root.id + "/command" && request.method === "POST") {
        server.commands++
        commandStarted.resolve()
        return new Response(null, { status: 204 })
      }
    })
    const variant = laterEdit ? "low" : "default"
    try {
      await setup.ready
      await setup.waitForFrame(
        (frame) =>
          frame.includes("Meta · shared Provider · high") &&
          setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
      )
      await choosePromptVariant(setup, "session", "default")
      await setup.mockInput.typeText("/review selection")
      setup.mockInput.pressEscape()
      setup.mockInput.pressEnter()
      await readStarted.promise
      if (laterEdit) await choosePromptVariant(setup, "session", "low")
      const terminal = Promise.race([
        setup.waitForFrame((frame) => frame.includes("Failed to run command")).then(() => "cancel"),
        commandStarted.promise.then(() => "command"),
      ])
      // No invalidation occurs here. Timestamp acceptance alone cannot confirm the requested Ref.
      readResponse.resolve(json({ data: { ...root, time: { ...root.time, updated: 2 } } }))
      expect(await terminal).toBe("cancel")
      expect(setup.captureCharFrame()).toContain("Meta · shared Provider · " + variant)
      await assertPromptVariant(setup, "executor", "high")
      expect(server.commands).toBe(0)
      expect(server.reads).toBe(1)
    } finally {
      readResponse.resolve(json({ data: root }))
    }
  },
)
