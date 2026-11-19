import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"
import { createAppFixture } from "./fixture/app"
import type { SessionInfo } from "@aigcfroge/client"

test("custom commands commit the captured agent, model and variant before execution", async () => {
  await using state = await tmpdir()
  const agent = Promise.withResolvers<Response>()
  const mutations: { type: string; body: unknown }[] = []
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const expectedModel = { providerID: "demo", id: "second", variant: "low" }
  let session: SessionInfo = {
    id: `ses_${crypto.randomUUID()}`,
    projectID: "project",
    title: "Command selection fixture",
    agent: "build",
    model: { providerID: "demo", id: "first" },
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  await using setup = await createAppFixture({
    state: state.path,
    config: {
      animations: false,
      keybinds: { "agent.cycle": "f6", "variant.cycle": "f7", "model.list": "f8" },
    },
    args: { sessionID: session.id },
    fetch: async (url, request) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/agent")
        return json({
          location,
          data: ["build", "plan"].map((id) => ({ id, mode: "primary", hidden: false, permissions: [] })),
        })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: ["first", "second"].map((id) => ({
            id,
            providerID: "demo",
            name: `${id} model`,
            variants: [{ id: "low" }, { id: "high" }],
            cost: [],
            time: { released: 0 },
          })),
        })
      if (url.pathname === "/api/command")
        return json({ location, data: [{ name: "review", description: "Review the input" }] })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      const type = url.pathname.match(/^\/api\/session\/[^/]+\/(agent|model|command)$/)?.[1]
      if (!type) return
      mutations.push({ type, body: await request.json() })
      return type === "agent" ? agent.promise : new Response(null, { status: 204 })
    },
  })
  try {
    await setup.ready
    await setup.waitForFrame((frame) => frame.includes("Build · first model"))
    setup.mockInput.pressKey("F6")
    await setup.waitForFrame((frame) => frame.includes("Plan ·"))
    setup.mockInput.pressKey("F8")
    await setup.waitForFrame(
      (frame) => frame.includes("Select model") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
    )
    await setup.mockInput.typeText("second")
    await setup.renderOnce()
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("Select variant") && frame.includes("low"))
    await setup.mockInput.typeText("low")
    await setup.renderOnce()
    setup.mockInput.pressEnter()
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Plan · second model Demo · low") &&
        setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
    )
    await setup.mockInput.typeText("/review selected input")
    setup.mockInput.pressEscape()
    setup.mockInput.pressEnter()
    await setup.waitFor(() => mutations.length > 0)
    expect(mutations).toEqual([{ type: "agent", body: { agent: "plan", model: expectedModel } }])

    // A later local edit must not change the in-flight command's selection.
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Plan · second model Demo · low") &&
        setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
    )
    setup.mockInput.pressKey("F7")
    await setup.waitForFrame((frame) => frame.includes("Plan · second model Demo · high"))
    expect(mutations).toHaveLength(1)
    session = { ...session, agent: "plan", model: expectedModel, time: { ...session.time, updated: 1 } }
    agent.resolve(new Response(null, { status: 204 }))
    await setup.waitFor(() => mutations.some((mutation) => mutation.type === "command"))
    expect(mutations).toEqual([
      { type: "agent", body: { agent: "plan", model: expectedModel } },
      {
        type: "command",
        body: { name: "review", text: "selected input", files: [], agents: [], delivery: "steer" },
      },
    ])
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Plan · second model Demo · high") &&
        setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
    )
    expect(session.agent).toBe("plan")
    expect(session.model).toEqual(expectedModel)
  } finally {
    agent.resolve(new Response(null, { status: 204 }))
  }
})

test("Meta commands use the real direct variant entry and commit both captured domains", async () => {
  await using state = await tmpdir()
  const executor = Promise.withResolvers<Response>()
  const model = Promise.withResolvers<Response>()
  const mutations: { type: string; body: unknown }[] = []
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const acknowledgedModel = { providerID: "demo", id: "first" }
  let canonical: SessionInfo = {
    id: "ses_meta_command",
    projectID: "project",
    title: "Meta command selection",
    agent: "meta",
    model: { ...acknowledgedModel, variant: "high" },
    controller: { kind: "root", metaAgentID: "mag_command", rootSessionID: "ses_meta_command" },
    executorPreference: { agent: "build", model: { providerID: "demo", id: "second", variant: "low" } },
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const expectedExecutor = { agent: "explore", model: { providerID: "demo", id: "second", variant: "low" } }
  const expectedModel = { providerID: "demo", id: "first", variant: "default" }
  await using setup = await createAppFixture({
    state: state.path,
    args: { sessionID: canonical.id },
    config: {
      animations: false,
      keybinds: { "variant.cycle": "f7", "agent.list": "f10", "variant.list": "f9" },
    },
    fetch: async (url, request) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/agent")
        return json({
          location,
          data: [
            {
              id: "meta",
              mode: "primary",
              hidden: false,
              permissions: [],
              model: { providerID: "demo", id: "first", variant: "high" },
            },
            { id: "build", mode: "all", hidden: false, permissions: [] },
            { id: "plan", mode: "primary", hidden: false, permissions: [] },
            {
              id: "explore",
              mode: "subagent",
              hidden: false,
              permissions: [],
              model: { providerID: "demo", id: "second", variant: "low" },
            },
          ],
        })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: ["first", "second"].map((id) => ({
            id,
            providerID: "demo",
            name: id + " model",
            variants: [{ id: "default" }, { id: "low" }, { id: "high" }],
            cost: [],
            time: { released: 0 },
          })),
        })
      if (url.pathname === "/api/command")
        return json({ location, data: [{ name: "review", description: "Review the input" }] })
      if (url.pathname === "/api/session/" + canonical.id) return json({ data: canonical })
      if (url.pathname === `/session/${canonical.id}/identity`)
        return json({
          sessionID: canonical.id,
          agent: canonical.agent,
          location: canonical.location,
          coordination: { available: true, reasons: [], selection: { agent: "meta" } },
        })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      const type = url.pathname.match(/^\/api\/session\/[^/]+\/(agent|executor|model|command)$/)?.[1]
      if (!type) return
      const body: unknown = await request.json()
      mutations.push({ type, body })
      if (type === "agent") throw new Error("Meta root must not switch its runtime agent")
      if (type === "executor") {
        expect(body).toEqual(expectedExecutor)
        canonical = { ...canonical, executorPreference: expectedExecutor, time: { ...canonical.time, updated: 1 } }
        return executor.promise
      }
      if (type === "model") {
        expect(body).toEqual({ model: expectedModel })
        canonical = { ...canonical, model: acknowledgedModel, time: { ...canonical.time, updated: 2 } }
        return model.promise
      }
      return new Response(null, { status: 204 })
    },
  })
  try {
    await setup.ready
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Meta · first model Demo · high") &&
        setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
    )
    setup.mockInput.pressKey("F10")
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Select agent") &&
        frame.includes("Delegation preference") &&
        setup.renderer.currentFocusedRenderable instanceof InputRenderable,
    )
    setup.mockInput.pressTab()
    setup.mockInput.pressEnter()
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Select executor") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
    )
    await setup.mockInput.typeText("explore")
    await setup.renderOnce()
    setup.mockInput.pressEnter()
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Select executor model") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
    )
    await setup.mockInput.typeText("second")
    await setup.renderOnce()
    setup.mockInput.pressEnter()
    await setup.waitForFrame(
      (frame) => frame.includes("Select variant") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
    )
    await setup.mockInput.typeText("low")
    await setup.renderOnce()
    setup.mockInput.pressEnter()
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Meta · first model Demo · high") &&
        setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
    )

    // F9 changes the Meta model directly; the delegation preference has its own model.
    setup.mockInput.pressKey("F9")
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Select variant") &&
        frame.includes("Default") &&
        frame.includes("default") &&
        setup.renderer.currentFocusedRenderable instanceof InputRenderable,
    )
    setup.mockInput.pressKey("HOME")
    setup.mockInput.pressEnter()
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Meta · first model Demo") &&
        !frame.includes("Meta · first model Demo ·") &&
        setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
    )
    setup.mockInput.pressKey("F9")
    await setup.waitForFrame(
      (frame) => frame.includes("Select variant") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
    )
    setup.mockInput.pressKey("HOME")
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressEnter()
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Meta · first model Demo · default") &&
        setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
    )
    expect(mutations).toEqual([])

    await setup.mockInput.typeText("/review selected input")
    setup.mockInput.pressEscape()
    setup.mockInput.pressEnter()
    await setup.waitFor(() => mutations.length === 1)
    expect(mutations[0]).toEqual({ type: "executor", body: expectedExecutor })

    setup.mockInput.pressKey("F7")
    await setup.waitForFrame((frame) => frame.includes("Meta · first model Demo · low"))
    expect(mutations).toHaveLength(1)
    executor.resolve(json({ data: canonical }))
    await setup.waitFor(() => mutations.length === 2)
    expect(mutations[1]).toEqual({ type: "model", body: { model: expectedModel } })
    model.resolve(new Response(null, { status: 204 }))
    await setup.waitFor(() => mutations.length === 3)
    expect(mutations[2]).toEqual({
      type: "command",
      body: { name: "review", text: "selected input", files: [], agents: [], delivery: "steer" },
    })
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Meta · first model Demo · low") &&
        setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
    )
    expect(canonical.agent).toBe("meta")
    expect(canonical.model).toEqual(acknowledgedModel)
    expect(canonical.executorPreference).toEqual(expectedExecutor)
  } finally {
    executor.resolve(json({ data: canonical }))
    model.resolve(new Response(null, { status: 204 }))
  }
})
