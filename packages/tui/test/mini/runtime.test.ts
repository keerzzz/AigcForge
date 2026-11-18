import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { AigcForge, type SessionInfo } from "@aigcfroge/client/promise"
import { runInteractiveDeferredMode, type RunDeferredInput } from "../../src/mini/runtime"
import type { LifecycleInput } from "../../src/mini/runtime.lifecycle"
import type { FooterEvent, MiniHost } from "../../src/mini/types"
import { catalogModel, catalogProvider, stubCatalogLists } from "./fixture/catalog"
import { createFooterApiFixture } from "./fixture/footer-api"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { isModelGroup, toModelPreference } from "../../src/model-preference"
import type { RunInput } from "../../src/mini/types"

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function ok<T>(data: T) {
  return Promise.resolve(data)
}

function host(): MiniHost {
  return {
    version: "local",
    terminal: { stdin: process.stdin },
    platform: "linux",
    stdout: { write() {} },
    files: { readText: async () => "" },
    editor: { open: async () => undefined },
    paths: { home: "/home/test" },
    signals: {
      sigint: { subscribe: () => () => {} },
      sigusr2: { subscribe: () => () => {} },
    },
    startup: { showTiming: false, now: () => 0 },
    diagnostics: {},
    preferences: {
      resolveVariant: async () => undefined,
      saveVariant: async () => {},
    },
  }
}

function footer(events: FooterEvent[] = []) {
  return createFooterApiFixture({ events }).api
}

const sessionLocation = { directory: "/tmp", project: { id: "pro-1", directory: "/tmp", canonical: "/tmp" } }

function metaSession(): SessionInfo {
  return {
    id: "ses_session_root",
    projectID: "pro-1",
    title: "Session root",
    agent: "meta",
    controller: { kind: "root", metaAgentID: "meta_root", rootSessionID: "ses_session_root" },
    model: { providerID: "test", id: "session-a", variant: "high" },
    executorPreference: { agent: "build", model: { providerID: "test", id: "executor-a", variant: "default" } },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    location: { directory: "/tmp" },
  }
}

async function canonicalRuntime(
  input: {
    sdk?: RunDeferredInput["sdk"]
    info?: SessionInfo
    createSession?: RunDeferredInput["createSession"]
    closeStream?: () => Promise<void>
  } = {},
) {
  const sdk = input.sdk ?? AigcForge.make({ baseUrl: "https://aigcfroge.test" })
  const info = input.info ?? metaSession()
  const events: FooterEvent[] = []
  const ui = createFooterApiFixture({ events })
  const streamReady = defer<void>()
  const titles: Array<string | undefined> = []
  const exits: Array<{ sessionID?: string; sessionTitle?: string }> = []
  let lifecycle!: LifecycleInput
  let replaceClient!: (next: RunDeferredInput["sdk"]) => void
  stubCatalogLists(sdk, {
    providers: [catalogProvider("test", "Test Provider")],
    models: ["session-a", "session-b", "executor-a", "executor-b"].map((id) =>
      catalogModel({ id, providerID: "test", variants: ["default", "high"] }),
    ),
  })
  const task = runInteractiveDeferredMode(
    {
      host: host(),
      sdk,
      directory: "/tmp",
      agent: info.agent,
      model: info.model && toModelPreference(info.model),
      variant: info.model && !isModelGroup(info.model) ? info.model.variant : undefined,
      files: [],
      target: async () => ({
        sessionID: info.id,
        sessionTitle: info.title,
        location: sessionLocation,
        agent: info.agent,
        model: info.model && toModelPreference(info.model),
        variant: info.model && !isModelGroup(info.model) ? info.model.variant : undefined,
        selection: info,
        resume: false,
      }),
      createSession: input.createSession,
    },
    {
      createRuntimeLifecycle: async (next) => {
        lifecycle = next
        return {
          footer: ui.api,
          onResize: () => () => {},
          refreshTheme() {},
          setTitle: (title) => titles.push(title),
          resetForReplay: async () => {},
          close: async (exit) => {
            exits.push(exit)
          },
        }
      },
      streamTransport: Promise.resolve({
        createSessionTransport: async (next) => {
          replaceClient = (client) => next.onClient?.(client)
          streamReady.resolve()
          return {
            runPromptTurn: async () => {},
            admitPromptTurn: async () => {},
            waitForIdle: async () => {},
            interruptActiveTurn: async () => {},
            selectSubagent() {},
            replayOnResize: async () => false,
            close: () => input.closeStream?.() ?? Promise.resolve(),
          }
        },
        formatUnknownError: (error: unknown) => String(error),
      }),
    },
  )
  await Promise.all([ui.promptReady, streamReady.promise])
  return { sdk, info, ui, events, titles, exits, lifecycle, replaceClient, task }
}

afterEach(() => {
  mock.restore()
})

describe("run interactive runtime", () => {
  test.each(["session", "executor"] as const)(
    "new waits for the pending %s ACK and captures both canonical refs",
    async (domain) => {
      const sdk = AigcForge.make({ baseUrl: "https://aigcfroge.test" })
      const initial = metaSession()
      const expected: SessionInfo =
        domain === "session"
          ? { ...initial, model: { providerID: "test", id: "session-b" } }
          : { ...initial, executorPreference: { agent: "build", model: { providerID: "test", id: "executor-b" } } }
      const createdInfo: SessionInfo = {
        ...expected,
        id: "ses_session_created",
        title: "Created Session",
        controller: { kind: "root", metaAgentID: "meta_created", rootSessionID: "ses_session_created" },
      }
      const arrived = defer<void>()
      const ack = defer<SessionInfo>()
      const starting = defer<void>()
      const adopted = defer<void>()
      const create = mock(
        (
          _sdk: RunDeferredInput["sdk"],
          _selection: Parameters<NonNullable<RunDeferredInput["createSession"]>>[1],
          _signal?: AbortSignal,
        ) =>
          ok({
            sessionID: createdInfo.id,
            sessionTitle: createdInfo.title,
            location: sessionLocation,
            agent: "meta",
            model: { providerID: "test", modelID: domain === "session" ? "session-b" : "session-a" },
            variant: domain === "session" ? undefined : "high",
            selection: createdInfo,
            resume: false,
          }),
      )
      const app = await canonicalRuntime({ sdk, createSession: create })
      const emit = app.ui.api.event.bind(app.ui.api)
      app.ui.api.event = (event) => {
        emit(event)
        if (event.type === "stream.patch" && event.patch.status === "starting new session") starting.resolve()
      }
      const append = app.ui.api.append.bind(app.ui.api)
      app.ui.api.append = (commit) => {
        append(commit)
        if (commit.kind === "system" && commit.text === `new session ${createdInfo.id}`) adopted.resolve()
      }
      if (domain === "session") {
        spyOn(sdk.session, "switchModel").mockImplementation(() => {
          arrived.resolve()
          return ack.promise.then(() => undefined)
        })
        spyOn(sdk.session, "get").mockResolvedValue(expected)
      }
      if (domain === "executor") {
        spyOn(sdk.session, "selectExecutor").mockImplementation(() => {
          arrived.resolve()
          return ack.promise
        })
      }
      try {
        const choice = app.lifecycle.onModelSelect?.(
          {
            providerID: "test",
            modelID: domain === "session" ? "session-b" : "executor-b",
          },
          domain,
        )
        await arrived.promise
        expect(app.ui.submit("/new")).toBe(true)
        await starting.promise
        expect(create).not.toHaveBeenCalled()
        ack.resolve(expected)
        await choice
        await adopted.promise
        expect(create).toHaveBeenCalledTimes(1)
        expect(create.mock.calls[0]?.[0]).toBe(sdk)
        expect(create.mock.calls[0]?.[1]).toMatchObject({
          agent: "meta",
          model: { providerID: "test", modelID: domain === "session" ? "session-b" : "session-a" },
          variant: domain === "session" ? undefined : "high",
          selection: expected,
        })
        expect(app.events).toContainEqual({ type: "selection", selection: createdInfo })
      } finally {
        ack.resolve(expected)
        app.ui.api.close()
        await app.task
      }
    },
  )

  test("interleaved Session and executor choices preserve the preceding canonical Session ACK", async () => {
    const app = await canonicalRuntime()
    const arrived = defer<void>()
    const ack = defer<void>()
    const order: string[] = []
    const sessionAck: SessionInfo = { ...app.info, model: { providerID: "test", id: "session-b" } }
    const combined: SessionInfo = {
      ...sessionAck,
      executorPreference: { agent: "build", model: { providerID: "test", id: "executor-b" } },
    }
    spyOn(app.sdk.session, "switchModel").mockImplementation(() => {
      order.push("session request")
      arrived.resolve()
      return ack.promise
    })
    spyOn(app.sdk.session, "get").mockImplementation(() => {
      order.push("session readback")
      return ok(sessionAck)
    })
    const executor = spyOn(app.sdk.session, "selectExecutor").mockImplementation(() => {
      order.push("executor request")
      return ok(combined)
    })
    try {
      const session = app.lifecycle.onModelSelect?.({ providerID: "test", modelID: "session-b" }, "session")
      await arrived.promise
      const next = app.lifecycle.onModelSelect?.({ providerID: "test", modelID: "executor-b" }, "executor")
      expect(executor).not.toHaveBeenCalled()
      ack.resolve()
      await Promise.all([session, next])
      expect(order).toEqual(["session request", "session readback", "executor request"])
      expect(executor.mock.calls.map(([request]) => request)).toEqual([
        { sessionID: app.info.id, payload: { agent: "build", model: { providerID: "test", id: "executor-b" } } },
      ])
      expect(app.events.filter((event) => event.type === "selection").slice(-2)).toEqual([
        { type: "selection", selection: sessionAck },
        { type: "selection", selection: combined },
      ])
    } finally {
      ack.resolve()
      app.ui.api.close()
      await app.task
    }
  })

  test("a replacement SDK invalidates the old executor ACK and supplies the next choice", async () => {
    const app = await canonicalRuntime()
    const replacement = AigcForge.make({ baseUrl: "https://replacement.aigcfroge.test" })
    const arrived = defer<void>()
    const ack = defer<SessionInfo>()
    const stale: SessionInfo = {
      ...app.info,
      executorPreference: { agent: "review", model: { providerID: "test", id: "executor-b" } },
    }
    const accepted: SessionInfo = {
      ...app.info,
      executorPreference: { agent: "build", model: { providerID: "test", id: "executor-a", variant: "high" } },
    }
    const old = spyOn(app.sdk.session, "selectExecutor").mockImplementation(() => {
      arrived.resolve()
      return ack.promise
    })
    const next = spyOn(replacement.session, "selectExecutor").mockResolvedValue(accepted)
    try {
      app.lifecycle.onAgentSelect?.("review", "executor")
      await arrived.promise
      app.replaceClient(replacement)
      ack.resolve(stale)
      await app.lifecycle.onVariantSelect?.("high", "executor")
      expect(old).toHaveBeenCalledTimes(1)
      expect(next.mock.calls.map(([request]) => request)).toEqual([
        {
          sessionID: app.info.id,
          payload: { agent: "build", model: { providerID: "test", id: "executor-a", variant: "high" } },
        },
      ])
      expect(app.events).not.toContainEqual({ type: "selection", selection: stale })
      expect(app.events).toContainEqual({ type: "selection", selection: accepted })
    } finally {
      ack.resolve(stale)
      app.ui.api.close()
      await app.task
    }
  })

  test("failed executor selection reads canonical state before the next choice", async () => {
    const app = await canonicalRuntime()
    const readReady = defer<void>()
    const recovered: SessionInfo = {
      ...app.info,
      executorPreference: { agent: "review", model: { providerID: "test", id: "executor-b", variant: "high" } },
    }
    const accepted = {
      ...recovered,
      executorPreference: { agent: "review", model: { providerID: "test", id: "executor-b", variant: "default" } },
    } satisfies SessionInfo
    const select = spyOn(app.sdk.session, "selectExecutor")
      .mockRejectedValueOnce(new Error("selection rejected"))
      .mockResolvedValueOnce(accepted)
    const read = spyOn(app.sdk.session, "get").mockImplementation(() => {
      readReady.resolve()
      return ok(recovered)
    })
    try {
      app.lifecycle.onAgentSelect?.("unavailable", "executor")
      await readReady.promise
      await app.lifecycle.onVariantSelect?.("default", "executor")
      expect(read).toHaveBeenCalledTimes(1)
      expect(select.mock.calls[1]?.[0]).toEqual({ sessionID: app.info.id, payload: accepted.executorPreference })
      expect(app.events).toContainEqual({ type: "selection", selection: recovered })
      expect(app.events).toContainEqual({ type: "selection", selection: accepted })
    } finally {
      app.ui.api.close()
      await app.task
    }
  })

  test("SDK replacement during new creation ignores the late durable result", async () => {
    const arrived = defer<void>()
    const result = defer<Awaited<ReturnType<NonNullable<RunDeferredInput["createSession"]>>>>()
    const create = mock(() => {
      arrived.resolve()
      return result.promise
    })
    const app = await canonicalRuntime({ createSession: create })
    try {
      app.ui.submit("/new")
      await arrived.promise
      app.replaceClient(AigcForge.make({ baseUrl: "https://replacement.aigcfroge.test" }))
      const events = [...app.events]
      const titles = [...app.titles]
      app.ui.api.close()
      result.resolve({
        sessionID: "ses_late",
        sessionTitle: "Late durable",
        location: sessionLocation,
        model: { providerID: "test", modelID: "session-a" },
        variant: "high",
        resume: false,
      })
      await app.task
      expect(create).toHaveBeenCalledTimes(1)
      expect(app.events.filter((event) => event.type !== "turn.idle")).toEqual(
        events.filter((event) => event.type !== "turn.idle"),
      )
      expect(app.titles).toEqual(titles)
      expect(app.exits.at(-1)?.sessionID).toBe(app.info.id)
    } finally {
      result.resolve({
        sessionID: "ses_late",
        location: sessionLocation,
        model: { providerID: "test", modelID: "session-a" },
        variant: "high",
        resume: false,
      })
      app.ui.api.close()
      await app.task
    }
  })

  for (const boundary of ["idle", "transport"] as const)
    test(`closing during new Session ${boundary} handoff ignores the successful result`, async () => {
      const arrived = defer<void>()
      const release = defer<void>()
      const create = mock(async () => ({
        sessionID: "ses_created",
        sessionTitle: "Created durable",
        location: sessionLocation,
        model: { providerID: "test", modelID: "session-a" },
        variant: "high",
        resume: false,
      }))
      const app = await canonicalRuntime({
        createSession: create,
        closeStream:
          boundary === "transport"
            ? () => {
                arrived.resolve()
                return release.promise
              }
            : undefined,
      })
      if (boundary === "idle")
        app.ui.api.idle = () => {
          arrived.resolve()
          return release.promise
        }
      try {
        app.ui.submit("/new")
        await arrived.promise
        const events = [...app.events]
        const titles = [...app.titles]
        app.ui.api.close()
        release.resolve()
        await app.task
        expect(create).toHaveBeenCalledTimes(1)
        expect(app.events.filter((event) => event.type !== "turn.idle")).toEqual(
          events.filter((event) => event.type !== "turn.idle"),
        )
        expect(app.titles).toEqual(titles)
        expect(app.exits.at(-1)?.sessionID).toBe(app.info.id)
      } finally {
        release.resolve()
        app.ui.api.close()
        await app.task
      }
    })

  test("serial executor model choice uses the preceding agent ACK as its basis", async () => {
    const app = await canonicalRuntime()
    const arrived = defer<void>()
    const ack = defer<SessionInfo>()
    const agentAck: SessionInfo = { ...app.info, executorPreference: { agent: "review" } }
    const modelAck: SessionInfo = {
      ...agentAck,
      executorPreference: { agent: "review", model: { providerID: "test", id: "executor-b" } },
    }
    const select = spyOn(app.sdk.session, "selectExecutor")
      .mockImplementationOnce(() => {
        arrived.resolve()
        return ack.promise
      })
      .mockResolvedValueOnce(modelAck)
    try {
      app.lifecycle.onAgentSelect?.("review", "executor")
      await arrived.promise
      const next = app.lifecycle.onModelSelect?.({ providerID: "test", modelID: "executor-b" }, "executor")
      expect(select).toHaveBeenCalledTimes(1)
      ack.resolve(agentAck)
      await next
      expect(select.mock.calls.map(([request]) => request)).toEqual([
        { sessionID: app.info.id, payload: { agent: "review", model: undefined } },
        { sessionID: app.info.id, payload: { agent: "review", model: { providerID: "test", id: "executor-b" } } },
      ])
      expect(app.events).toContainEqual({ type: "selection", selection: agentAck })
      expect(app.events).toContainEqual({ type: "selection", selection: modelAck })
    } finally {
      ack.resolve(agentAck)
      app.ui.api.close()
      await app.task
    }
  })

  test("serial Session variant choice uses the preceding model canonical readback", async () => {
    const app = await canonicalRuntime()
    const arrived = defer<void>()
    const ack = defer<void>()
    const modelAck: SessionInfo = { ...app.info, model: { providerID: "test", id: "session-b" } }
    const variantAck: SessionInfo = { ...modelAck, model: { providerID: "test", id: "session-b", variant: "default" } }
    const change = spyOn(app.sdk.session, "switchModel")
      .mockImplementationOnce(() => {
        arrived.resolve()
        return ack.promise
      })
      .mockResolvedValueOnce(undefined)
    const read = spyOn(app.sdk.session, "get").mockResolvedValueOnce(modelAck).mockResolvedValueOnce(variantAck)
    try {
      const model = app.lifecycle.onModelSelect?.({ providerID: "test", modelID: "session-b" }, "session")
      await arrived.promise
      const variant = app.lifecycle.onVariantSelect?.("default", "session")
      expect(change).toHaveBeenCalledTimes(1)
      expect(read).not.toHaveBeenCalled()
      ack.resolve()
      await Promise.all([model, variant])
      expect(change.mock.calls.map(([request]) => request)).toEqual([
        { sessionID: app.info.id, model: { providerID: "test", id: "session-b" } },
        { sessionID: app.info.id, model: { providerID: "test", id: "session-b", variant: "default" } },
      ])
      expect(read).toHaveBeenCalledTimes(2)
      expect(app.events).toContainEqual({ type: "selection", selection: modelAck })
      expect(app.events).toContainEqual({ type: "selection", selection: variantAck })
    } finally {
      ack.resolve()
      app.ui.api.close()
      await app.task
    }
  })

  test("a historical root selects the actual Agent with its captured Session model", async () => {
    const app = await canonicalRuntime()
    const selected = { ...app.info, agent: "plan" }
    const switchAgent = spyOn(app.sdk.session, "switchAgent").mockResolvedValue()
    const switchModel = spyOn(app.sdk.session, "switchModel")
    const selectExecutor = spyOn(app.sdk.session, "selectExecutor")
    spyOn(app.sdk.session, "get").mockResolvedValue(selected)
    try {
      await app.lifecycle.onAgentSelect?.("plan")
      expect(switchAgent.mock.calls[0]?.[0]).toEqual({ sessionID: app.info.id, agent: "plan", model: app.info.model })
      expect(switchModel).not.toHaveBeenCalled()
      expect(selectExecutor).not.toHaveBeenCalled()
      expect(app.events).toContainEqual({ type: "selection", selection: selected })
      expect(selected.executorPreference).toEqual(app.info.executorPreference)
    } finally {
      app.ui.api.close()
      await app.task
    }
  })

  test("a deferred legacy Meta target retains its selection without a controller", async () => {
    const info = { ...metaSession(), controller: undefined, executorPreference: undefined }
    const app = await canonicalRuntime({ info })
    try {
      expect(app.events).toContainEqual({ type: "selection", selection: info })
      expect(
        app.events.some(
          (event) => event.type === "stream.patch" && event.patch.status === "Could not confirm the Session selection",
        ),
      ).toBe(false)
    } finally {
      app.ui.api.close()
      await app.task
    }
  })

  test("first Meta selection waits for the new controller and model in canonical GET", async () => {
    const info = { ...metaSession(), agent: "build", controller: undefined, executorPreference: undefined }
    const app = await canonicalRuntime({ info })
    const readStarted = Promise.withResolvers<void>()
    const read = Promise.withResolvers<SessionInfo>()
    const canonical = { ...metaSession(), model: info.model }
    const switchAgent = spyOn(app.sdk.session, "switchAgent").mockResolvedValue()
    const selectExecutor = spyOn(app.sdk.session, "selectExecutor")
    spyOn(app.sdk.session, "get").mockImplementation(() => {
      readStarted.resolve()
      return read.promise
    })
    try {
      const start = app.events.length
      const choice = app.lifecycle.onAgentSelect?.("meta")
      await readStarted.promise
      expect(switchAgent.mock.calls[0]?.[0]).toEqual({ sessionID: info.id, agent: "meta", model: info.model })
      expect(app.events.slice(start).some((event) => event.type === "selection")).toBe(false)
      read.resolve(canonical)
      await choice
      expect(app.events).toContainEqual({ type: "selection", selection: canonical })
      expect(selectExecutor).not.toHaveBeenCalled()
    } finally {
      read.resolve(canonical)
      app.ui.api.close()
      await app.task
    }
  })

  test("first Meta selection cannot adopt a GET without its controller and model", async () => {
    const info = { ...metaSession(), agent: "build", controller: undefined, executorPreference: undefined }
    const app = await canonicalRuntime({ info })
    const invalid = { ...info, agent: "meta", model: undefined }
    spyOn(app.sdk.session, "switchAgent").mockResolvedValue()
    spyOn(app.sdk.session, "get").mockResolvedValue(invalid)
    try {
      const start = app.events.length
      await app.lifecycle.onAgentSelect?.("meta")
      expect(app.events.slice(start).some((event) => event.type === "selection")).toBe(false)
      expect(app.events).toContainEqual({
        type: "stream.patch",
        patch: { status: "Could not confirm the Session selection" },
      })
    } finally {
      app.ui.api.close()
      await app.task
    }
  })
  test("resolves the default model reactively without blocking catalog startup", async () => {
    const sdk = AigcForge.make({ baseUrl: "https://aigcfroge.test" })
    const events: FooterEvent[] = []
    const ui = createFooterApiFixture({ events })
    const api = ui.api
    const selected = defer<Awaited<ReturnType<typeof sdk.model.group.definition.get>>>()
    const catalogLoaded = defer<void>()
    const defaultModelReloaded = defer<void>()
    const modelShown = defer<void>()
    const turnStarted = defer<void>()
    const model = catalogModel({
      id: "resolved",
      providerID: "test",
      name: "Resolved Model",
      variants: ["low", "high"],
    })
    let lifecycle!: LifecycleInput
    let turnAgent: string | undefined
    let turnModel: RunInput["model"]
    let refreshCatalog: (() => Promise<unknown>) | undefined
    stubCatalogLists(sdk, {
      providers: [catalogProvider("test", "Test Provider")],
      models: [model],
    })
    let defaultModelCalls = 0
    const defaultModel = spyOn(sdk.model.group.definition, "get").mockImplementation(() => {
      defaultModelCalls++
      if (defaultModelCalls === 2) defaultModelReloaded.resolve()
      return selected.promise
    })
    const emit = api.event.bind(api)
    api.event = (event) => {
      emit(event)
      if (event.type === "model") modelShown.resolve()
    }

    const task = runInteractiveDeferredMode(
      {
        host: host(),
        sdk,
        directory: "/tmp",
        target: async () => ({
          sessionID: "ses_root",
          location: { directory: "/tmp", project: { id: "pro-1", directory: "/tmp", canonical: "/tmp" } },
          agent: "build",
          model: undefined,
          variant: undefined,
          resume: false,
        }),
        agent: "build",
        model: undefined,
        variant: undefined,
        files: [],
      },
      {
        createRuntimeLifecycle: async (input) => {
          lifecycle = input
          return {
            footer: api,
            onResize: () => () => {},
            refreshTheme: () => {},
            setTitle: () => {},
            resetForReplay: () => Promise.resolve(),
            close: () => Promise.resolve(),
          }
        },
        streamTransport: Promise.resolve({
          createSessionTransport: async (input) => {
            refreshCatalog = () => Promise.resolve(input.onCatalogRefresh?.())
            await refreshCatalog()
            catalogLoaded.resolve()
            return {
              runPromptTurn: async (input) => {
                turnAgent = input.agent
                turnModel = input.model
                turnStarted.resolve()
                api.close()
              },
              admitPromptTurn: async () => {},
              waitForIdle: async () => {},
              interruptActiveTurn: async () => {},
              selectSubagent: () => {},
              replayOnResize: async () => false,
              close: async () => {},
            }
          },
          formatUnknownError: (error: unknown) => String(error),
        }),
      },
    )

    await catalogLoaded.promise
    expect(events.some((event) => event.type === "model")).toBe(false)
    await refreshCatalog?.()
    expect(defaultModel).toHaveBeenCalledTimes(1)
    selected.resolve({
      location: { directory: "/tmp" },
      data: { targets: [], definitions: [], effective: [], defaultSelection: { providerID: model.providerID, id: model.id } },
    })
    await defaultModelReloaded.promise
    await modelShown.promise
    expect(events).toContainEqual({
      type: "model",
      model: "Resolved Model · Test Provider",
      selection: { providerID: "test", modelID: "resolved" },
    })
    expect(lifecycle.onCycleVariant?.()).toMatchObject({ status: "variant low", variant: "low" })
    lifecycle.onAgentSelect?.("review")
    await ui.promptReady
    expect(ui.submit("hello")).toBe(true)
    await turnStarted.promise
    expect(turnAgent).toBe("review")
    expect(turnModel).toEqual({ providerID: "test", modelID: "resolved" })
    await task
  })

  test("routes form responses to their owners with global location and local settlement", async () => {
    const sdk = AigcForge.make({ baseUrl: "https://aigcfroge.test" })
    const api = footer()
    const streamStarted = defer<void>()
    let lifecycle!: LifecycleInput
    const settled: Array<{ sessionID: string; formID: string }> = []
    stubCatalogLists(sdk)
    const reply = spyOn(sdk.session.form, "reply").mockImplementation(() => ok(undefined))

    const task = runInteractiveDeferredMode(
      {
        host: host(),
        sdk,
        directory: "/tmp",
        target: async () => ({
          sessionID: "ses_root",
          location: { directory: "/tmp", project: { id: "pro-1", directory: "/tmp", canonical: "/tmp" } },
          agent: "build",
          model: { providerID: "test", modelID: "model" },
          variant: undefined,
          resume: false,
        }),
        agent: "build",
        model: { providerID: "test", modelID: "model" },
        variant: undefined,
        files: [],
      },
      {
        createRuntimeLifecycle: async (input) => {
          lifecycle = input
          return {
            footer: api,
            onResize: () => () => {},
            refreshTheme: () => {},
            setTitle: () => {},
            resetForReplay: () => Promise.resolve(),
            close: () => Promise.resolve(),
          }
        },
        streamTransport: Promise.resolve({
          createSessionTransport: async () => {
            streamStarted.resolve()
            return {
              runPromptTurn: async () => {},
              admitPromptTurn: async () => {},
              waitForIdle: async () => {},
              interruptActiveTurn: async () => {},
              selectSubagent: () => {},
              settleForm: (sessionID: string, formID: string) => settled.push({ sessionID, formID }),
              replayOnResize: async () => false,
              close: async () => {},
            }
          },
          formatUnknownError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
        }),
      },
    )
    await streamStarted.promise

    await lifecycle.onFormReply({
      sessionID: "global",
      formID: "frm_global",
      answer: { value: "yes" },
      location: { directory: "/remote work" },
    })
    expect(reply).toHaveBeenCalledWith(
      {
        sessionID: "global",
        formID: "frm_global",
        answer: { value: "yes" },
        location: { directory: "/remote work" },
      },
      {
        headers: {
          "x-aigcfroge-directory": "%2Fremote%20work",
        },
      },
    )
    expect(settled).toEqual([{ sessionID: "global", formID: "frm_global" }])

    reply.mockImplementationOnce(() => Promise.reject({ _tag: "FormInvalidAnswerError", message: "Invalid answer" }))
    await expect(
      lifecycle.onFormReply({ sessionID: "ses_child", formID: "frm_invalid", answer: { value: 3 } }),
    ).rejects.toEqual({ _tag: "FormInvalidAnswerError", message: "Invalid answer" })
    expect(settled.some((item) => item.formID === "frm_invalid")).toBe(false)

    api.close()
    await task
  })

  test("resolves the deferred session only after first paint", async () => {
    const sdk = AigcForge.make({ baseUrl: "https://aigcfroge.test" })
    const lifecycleStarted = defer<void>()
    const painted = defer<void>()
    const api = footer()
    let resolved = 0
    api.idle = () => painted.promise
    stubCatalogLists(sdk)

    const task = runInteractiveDeferredMode(
      {
        host: host(),
        sdk,
        directory: "/tmp",
        target: async () => {
          resolved++
          api.close()
          return {
            sessionID: "ses-deferred",
            sessionTitle: "Deferred",
            location: { directory: "/tmp", project: { id: "pro-1", directory: "/tmp", canonical: "/tmp" } },
            agent: "build",
            model: { providerID: "openai", modelID: "gpt-5" },
            variant: undefined,
            resume: false,
          }
        },
        agent: "build",
        model: { providerID: "openai", modelID: "gpt-5" },
        variant: undefined,
        files: [],
      },
      {
        createRuntimeLifecycle: async () => {
          lifecycleStarted.resolve()
          return {
            footer: api,
            onResize: () => () => {},
            refreshTheme: () => {},
            setTitle: () => {},
            resetForReplay: () => Promise.resolve(),
            close: () => Promise.resolve(),
          }
        },
      },
    )

    await lifecycleStarted.promise
    expect(resolved).toBe(0)
    painted.resolve()
    await task
    expect(resolved).toBe(1)
  })

  test("restores deferred session history and model after first paint", async () => {
    const sdk = AigcForge.make({ baseUrl: "https://aigcfroge.test" })
    const lifecycleStarted = defer<void>()
    const painted = defer<void>()
    const events: FooterEvent[] = []
    const titles: Array<string | undefined> = []
    const api = footer(events)
    api.idle = () => painted.promise
    const event = api.event
    api.event = (value) => {
      event(value)
      if (value.type === "model" && value.model === "Little Frank · OpenAI · high") api.close()
    }
    spyOn(sdk.session, "get").mockImplementation(
      () =>
        ok({
          id: "ses-resume",
          projectID: "pro-1",
          title: "Resume",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 1 },
          location: { directory: "/tmp" },
          model: { providerID: "openai", id: "gpt-5", variant: "high" },
        }) as never,
    )
    spyOn(sdk.message, "list").mockImplementation(
      () =>
        ok({
          data: [{ id: "msg-user", type: "user", text: "previous prompt", time: { created: 1 } }],
          cursor: {},
        }) as never,
    )
    stubCatalogLists(sdk, {
      providers: [catalogProvider("openai", "OpenAI")],
      models: [
        catalogModel({
          id: "gpt-5",
          providerID: "openai",
          name: "Little Frank",
          variants: ["high"],
        }),
      ],
    })

    const task = runInteractiveDeferredMode(
      {
        host: host(),
        sdk,
        directory: "/tmp",
        target: async () => ({
          sessionID: "ses-resume",
          sessionTitle: "Resume",
          location: { directory: "/tmp", project: { id: "pro-1", directory: "/tmp", canonical: "/tmp" } },
          agent: "review",
          model: { providerID: "openai", modelID: "gpt-5" },
          variant: "high",
          resume: true,
        }),
        agent: "build",
        model: undefined,
        variant: undefined,
        files: [],
      },
      {
        createRuntimeLifecycle: async () => {
          lifecycleStarted.resolve()
          return {
            footer: api,
            onResize: () => () => {},
            refreshTheme: () => {},
            setTitle: (title) => titles.push(title),
            resetForReplay: () => Promise.resolve(),
            close: () => Promise.resolve(),
          }
        },
      },
    )

    await lifecycleStarted.promise
    expect(sdk.session.get).not.toHaveBeenCalled()
    painted.resolve()
    await task

    expect(events).toContainEqual({
      type: "history",
      history: [{ text: "previous prompt", parts: [] }],
    })
    expect(events).toContainEqual({ type: "agent", agent: "review" })
    expect(titles).toEqual(["Resume"])
    expect(events).toContainEqual({
      type: "model",
      model: "Little Frank · OpenAI · high",
      selection: { providerID: "openai", modelID: "gpt-5" },
    })
  })

  test("aborts deferred resume history on close and uses the cached exit title", async () => {
    const sdk = AigcForge.make({ baseUrl: "https://aigcfroge.test" })
    const painted = defer<void>()
    const readsStarted = defer<void>()
    const api = footer()
    api.idle = () => painted.promise
    let reads = 0
    let aborted = 0
    let closedTitle: string | undefined
    const pending = (signal: AbortSignal | undefined) =>
      new Promise<never>((_resolve, reject) => {
        reads++
        if (reads === 2) readsStarted.resolve()
        signal?.addEventListener(
          "abort",
          () => {
            aborted++
            reject(new Error("resume history aborted"))
          },
          { once: true },
        )
      })
    const messages = spyOn(sdk.message, "list").mockImplementation(
      (_request, options) => pending(options?.signal) as never,
    )
    const session = spyOn(sdk.session, "get").mockImplementation(
      (_request, options) => pending(options?.signal) as never,
    )
    stubCatalogLists(sdk)

    const task = runInteractiveDeferredMode(
      {
        host: host(),
        sdk,
        directory: "/tmp",
        target: async () => ({
          sessionID: "ses-resume-abort",
          sessionTitle: "Cached title",
          location: { directory: "/tmp", project: { id: "pro-1", directory: "/tmp", canonical: "/tmp" } },
          agent: "build",
          model: undefined,
          variant: undefined,
          resume: true,
        }),
        agent: "build",
        model: undefined,
        variant: undefined,
        files: [],
      },
      {
        createRuntimeLifecycle: async () => ({
          footer: api,
          onResize: () => () => {},
          refreshTheme: () => {},
          setTitle: () => {},
          resetForReplay: () => Promise.resolve(),
          close: async (input) => {
            closedTitle = input.sessionTitle
          },
        }),
      },
    )

    painted.resolve()
    await readsStarted.promise
    api.close()
    await task

    expect(aborted).toBe(2)
    expect(messages).toHaveBeenCalledWith(
      { sessionID: "ses-resume-abort", limit: 200, order: "desc" },
      { signal: expect.any(AbortSignal) },
    )
    expect(session).toHaveBeenCalledTimes(1)
    expect(session).toHaveBeenCalledWith({ sessionID: "ses-resume-abort" }, { signal: expect.any(AbortSignal) })
    expect(closedTitle).toBe("Cached title")
  })

  test("adopts deferred target placement and supplied TUI config", async () => {
    const sdk = AigcForge.make({ baseUrl: "https://aigcfroge.test" })
    const lifecycleStarted = defer<void>()
    const painted = defer<void>()
    const api = footer()
    api.idle = () => painted.promise
    let targets = 0
    let getDirectory: (() => string) | undefined
    let findFiles: ((query: string) => Promise<string[]>) | undefined
    let transportLocation: unknown
    let runtimeConfig: LifecycleInput["tuiConfig"] | undefined
    const tuiConfig = createTuiResolvedConfig({ keybinds: { "variant.cycle": "ctrl+g" } })
    const catalogs = stubCatalogLists(sdk, {
      location: { directory: "/session", workspaceID: "work-1" },
    })
    const fileFind = spyOn(sdk.file, "find").mockResolvedValue({
      location: {
        directory: "/session",
        workspaceID: "work-1",
        project: { id: "pro-1", directory: "/session", canonical: "/session" },
      },
      data: [{ path: "src/index.ts", type: "file" }],
    } as never)

    const task = runInteractiveDeferredMode(
      {
        host: host(),
        sdk,
        directory: "/launch",
        target: async () => {
          targets++
          return {
            sessionID: "ses-target",
            location: {
              directory: "/session",
              workspaceID: "work-1",
              project: { id: "location-project", directory: "/session", canonical: "/session" },
            },
            agent: "review",
            model: { providerID: "openai", modelID: "gpt-5" },
            variant: "high",
            resume: false,
          }
        },
        agent: undefined,
        model: undefined,
        variant: undefined,
        files: [],
        tuiConfig,
      },
      {
        createRuntimeLifecycle: async (input) => {
          getDirectory = input.getDirectory
          findFiles = input.findFiles
          runtimeConfig = input.tuiConfig
          lifecycleStarted.resolve()
          return {
            footer: api,
            onResize: () => () => {},
            refreshTheme: () => {},
            setTitle: () => {},
            resetForReplay: () => Promise.resolve(),
            close: () => Promise.resolve(),
          }
        },
        streamTransport: Promise.resolve({
          createSessionTransport: async (input) => {
            transportLocation = input.location
            await findFiles?.("index")
            setTimeout(() => input.footer.close(), 0)
            return {
              runPromptTurn: async () => {},
              admitPromptTurn: async () => {},
              waitForIdle: async () => {},
              interruptActiveTurn: async () => {},
              selectSubagent: () => {},
              replayOnResize: async () => false,
              close: async () => {},
            }
          },
          formatUnknownError: (error: unknown) => String(error),
        }),
      },
    )

    await lifecycleStarted.promise
    expect(targets).toBe(0)
    expect(getDirectory?.()).toBe("/launch")
    painted.resolve()
    await task

    const query = { location: { directory: "/session" } }
    expect(getDirectory?.()).toBe("/session")
    if (!runtimeConfig) throw new Error("runtime lifecycle did not receive TUI config")
    expect(await runtimeConfig).toBe(tuiConfig)
    expect(transportLocation).toMatchObject({ directory: "/session", workspaceID: "work-1" })
    expect(catalogs.provider).toHaveBeenCalledWith(query, { signal: expect.any(AbortSignal) })
    expect(catalogs.model).toHaveBeenCalledWith(query, { signal: expect.any(AbortSignal) })
    expect(catalogs.agent).toHaveBeenCalledWith(query, { signal: expect.any(AbortSignal) })
    expect(catalogs.reference).toHaveBeenCalledWith(query, { signal: expect.any(AbortSignal) })
    expect(catalogs.command).toHaveBeenCalledWith(query, { signal: expect.any(AbortSignal) })
    expect(fileFind).toHaveBeenCalledWith({ query: "index", type: "file", ...query })
  })
})
