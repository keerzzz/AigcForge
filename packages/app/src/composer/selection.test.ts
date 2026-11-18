import { afterEach, expect, mock, test } from "bun:test"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import type {
  AigcForgeClient,
  AigcForgeEvent,
  SessionExecutorPreference,
  SessionInfo,
  SessionPromptInput,
  SessionSwitchAgentInput,
  ModelGroupCurrent,
  ModelListOutput,
  ProviderListOutput,
} from "@aigcfroge/client/promise"
import type { CreateDataInput, Data } from "@aigcfroge/client/solid"
import type { ComposerAdapter, ComposerSelection, ComposerSession } from "./adapter"
import type { ModelKey } from "@/providers/models/selection"
import type { Agent } from "@/runtime/server/types"

type PromptBody = Omit<SessionPromptInput, "sessionID">

// Keep browser conditions and module substitutes isolated from the unit suite.
// The existing browser fixture covers legacy agent/model choices; these cases
// exercise Meta/executor choices through the same real providers and persistence.
const browser = process.env.AIGCFROGE_COMPOSER_SELECTION_BROWSER_TEST === "1"

if (!browser) {
  test("Agent selection LocalProvider integration", async () => {
    const pattern = process.env.AIGCFROGE_COMPOSER_SELECTION_BROWSER_PATTERN

    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--conditions=browser",
        "--only-failures",
        "--preload",
        "./happydom.ts",
        "./src/composer/selection.test.ts",
        ...(pattern ? ["--test-name-pattern", pattern] : []),
      ],
      {
        cwd: fileURLToPath(new URL("../../", import.meta.url)),
        env: { ...process.env, AIGCFROGE_COMPOSER_SELECTION_BROWSER_TEST: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    )

    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])

    process.stdout.write(stdout)
    process.stderr.write(stderr)
    expect(status, stdout + stderr).toBe(0)
  }, 30_000)
}

if (browser) await browserKeepers()

async function browserKeepers() {
  // Compile the actual shared context provider with the installed Vite presets.
  const require = createRequire(import.meta.url)
  const solid = createRequire(require.resolve("vite-plugin-solid"))
  const { transformSync } = solid("@babel/core")

  Bun.plugin({
    name: "composer-selection-solid-context",
    setup(build) {
      build.onLoad({ filter: /[\\/]ui[\\/]src[\\/]context[\\/]helper\.tsx$/ }, async (args) => ({
        contents: transformSync(await Bun.file(args.path).text(), {
          filename: args.path,
          presets: [solid.resolve("babel-preset-solid"), solid.resolve("@babel/preset-typescript")],
        }).code,
        loader: "js",
      }))
    },
  })

  const { createComponent, createComputed, createRoot } = await import("solid-js")
  const { createStore, unwrap } = await import("solid-js/store")
  const { Match, Predicate, Schema } = await import("effect")

  let active: ReturnType<typeof fixture> | undefined

  const currentFixture = () => {
    if (!active) throw new Error("LocalProvider fixture is not mounted")

    return active
  }

  mock.module("@solidjs/router", () => ({ useParams: () => currentFixture().state.route }))
  mock.module("@/runtime/server/current", () => ({
    useData: () => currentFixture().data,
    useServer: () => ({ key: "sidecar" }),
  }))
  mock.module("@/runtime/server/client", () => ({ useServerSDK: () => currentFixture().sdk }))
  mock.module("@/runtime/server/runtime", () => ({ useGlobal: () => ({ models: currentFixture().preferences }) }))
  mock.module("@/workspaces/location", () => ({
    useWorkspaceLocation: () => {
      const fixture = currentFixture()

      return () => ({ directory: fixture.directory })
    },
  }))
  mock.module("@/settings/model", () => ({
    useSettings: () => {
      const fixture = currentFixture()

      return { visibility: { customAgents: () => fixture.state.visible } }
    },
  }))
  mock.module("@/composer/persistence", () => ({ useComposerState: () => currentFixture().prompt }))
  mock.module("@/shell/tabs/tabs", () => ({ useTabs: () => currentFixture().tabs }))
  mock.module("@/runtime/i18n/language", () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
  mock.module("@/new-session/project/controller", () => ({ createComposerProjectControls: () => () => undefined }))
  mock.module("@/shell/notifications/toast", () => ({ showToast() {} }))
  mock.module("@/shell/state/layout", () => ({ useLayout: () => undefined }))
  mock.module("@/runtime/platform/platform", () => ({
    usePlatform: () => ({
      platform: "web",
      openExternal() {},
      restart: async () => {},
      notify: async () => {},
    }),
  }))

  const { LocalProvider, useLocal } = await import("@/providers/models/selection")
  const { ModelsProvider } = await import("@/providers/models/models")
  const { Persist, removePersisted } = await import("@/runtime/persistence/storage")
  const { flushPersisted } = await import("@/runtime/persistence/persist")
  const { createMemoryComposerState } = await import("@/composer/state")
  const { createComposerControls, createComposerModelSelection } = await import("@/composer/selection")
  const { ServerScope } = await import("@/runtime/server/scope")
  const { AigcForge } = await import("@aigcfroge/client/promise")
  const { createData } = await import("@aigcfroge/client/solid")
  const { createComposerSubmit, SelectionReadbackError } = await import("@/composer/submit")
  const { createActiveComposerAdapter } = await import("@/session/composer/adapter")
  const { createNewSessionComposerAdapter } = await import("@/new-session/composer-adapter")

  function client(input: { baseUrl: string; fetch: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch> }) {
    return AigcForge.make({
      ...input,
      fetch: Object.assign(input.fetch, { preconnect() {} }),
    })
  }

  type Canonical = Pick<SessionInfo, "agent" | "model" | "controller" | "executorPreference">

  type SelectedEvent = { data: { sessionID: string } }

  const cleanups: Array<() => void> = []

  afterEach(() => {
    cleanups
      .splice(0)
      .reverse()
      .forEach((dispose) => dispose())
    active = undefined
  })

  const key = (modelID: string) => ({ providerID: "provider", modelID }) satisfies ModelKey

  const executor = (agent: string, modelID?: string, variant?: string): SessionExecutorPreference => ({
    agent,
    model: modelID ? { id: modelID, providerID: "provider", variant } : undefined,
  })

  const root = (modelID: string, variant?: string, preference = executor("build", "b", "low")): Canonical => ({
    agent: "meta",
    model: { id: modelID, providerID: "provider", variant },
    executorPreference: preference,
    controller: { kind: "root", metaAgentID: "meta_a", rootSessionID: "ses_a" },
  })

  const agent = (name: string, mode: Agent["mode"], modelID?: string, variant?: string, hidden = false): Agent => ({
    name,
    mode,
    model: modelID ? key(modelID) : undefined,
    variant,
    hidden,
    native: true,
    permission: [],
    options: {},
  })

  function fixture(
    input: {
      session?: Canonical
      agents?: Agent[]
      groups?: ModelGroupCurrent[]
      newSession?: boolean
      empty?: boolean
      preferredVariants?: Record<string, string>
      data?: Pick<Data, "session">
      api?: () => AigcForgeClient
    } = {},
  ) {
    const directory = "/agent-selection-test/" + crypto.randomUUID()

    const transport = {
      api:
        input.api?.() ??
        client({
          baseUrl: "http://aigcfroge.local",
          fetch: async () => {
            throw new Error("Unexpected selection fixture request")
          },
        }),
    }

    const [state, set] = createStore<{
      visible: boolean
      route: { id: string | undefined }
      agents: Agent[]
      sessions: Record<string, Canonical | undefined>
      providers: ProviderListOutput["data"]
      groups: ModelGroupCurrent[]
      models: ModelListOutput["data"]
    }>({
      visible: true,
      route: { id: input.newSession ? undefined : "ses_a" },
      agents: input.agents ?? [
        agent("meta", "primary", "a", "high"),
        agent("build", "all", "b", "low"),
        agent("explore", "subagent", "c", "high"),
        agent("plan", "primary", "b", "high"),
        agent("hidden", "all", "c", "low", true),
      ],
      sessions: {
        ses_a: input.session ?? (input.newSession || input.empty ? undefined : root("a", "high")),
      },
      providers: [{ id: "provider", name: "Provider", package: "@ai-sdk/test", activation: "enabled" }],
      groups: input.groups ?? [],
      models: ["a", "b", "c"].map((id) => ({
        id,
        modelID: id,
        providerID: "provider",
        name: "Model " + id,
        settings: {},
        headers: {},
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        variants: ["default", "low", "high"].map((id) => ({ id, settings: {} })),
        time: { released: 1 },
        cost: [],
        status: "active",
        enabled: true,
        limit: { context: 128_000, output: 8192 },
      })),
    })

    const [preferences, setPreferences] = createStore<{
      user: Array<ModelKey & { visibility: "show" | "hide" }>
      recent: ModelKey[]
      variant: Record<string, string>
    }>({
      user: [],
      recent: [],
      variant: input.preferredVariants ?? { "provider/a": "low", "provider/b": "high", "provider/c": "default" },
    })

    const events = new Map<string, Set<(event: SelectedEvent) => void>>()

    const result = {
      directory,
      transport,
      state,
      set,
      prompt: createMemoryComposerState(),
      tabs: {
        draft: () => ({ location: { directory } }),
        updateDraft() {},
        promoteDraft(_draftID: string, input: { sessionId: string }) {
          set("route", "id", input.sessionId)
        },
      },
      preferences: {
        store: preferences,
        set: setPreferences,
        ready: Object.assign(() => true, { promise: undefined }),
        recent: () => preferences.recent,
      },
      data: {
        session: input.data?.session ?? { get: (id: string) => state.sessions[id] },
        location: {
          info: () => ({ project: { canonical: directory } }),
          agent: { list: () => state.agents },
          config: { list: () => [], sync: async () => {} },
          provider: { list: () => state.providers, sync: async () => {} },
          model: { list: () => state.models, sync: async () => {}, group: { definition: { list: () => ({ targets: [], definitions: [], effective: state.groups }), sync: async () => {} } } },
          integration: { list: () => [], sync: async () => {} },
        },
      },
      sdk: {
        scope: ServerScope.local,
        get api() {
          return input.api?.() ?? transport.api
        },
        connection: { status: () => "connected" },
        event: {
          on(type: string, handler: (event: SelectedEvent) => void) {
            const handlers = events.get(type) ?? new Set<(event: SelectedEvent) => void>()
            events.set(type, handlers)
            handlers.add(handler)

            return () => handlers.delete(handler)
          },
        },
      },
      publish(session: Canonical, type = "session.model.selected") {
        set("sessions", "ses_a", session)
        events.get(type)?.forEach((handler) => handler({ data: { sessionID: "ses_a" } }))
      },
      mount(draftID?: string, newSession = false) {
        active = result

        type MountedComposer = {
          local?: ReturnType<typeof useLocal>
          controls?: ReturnType<typeof createComposerControls>
          composer?: ReturnType<typeof createComposerModelSelection>
          newSession?: ReturnType<typeof createNewSessionComposerAdapter>
        }

        const holder: MountedComposer = {}

        const dispose = createRoot((dispose) => {
          createComponent(ModelsProvider, {
            directory,
            get children() {
              return createComponent(LocalProvider, {
                get children() {
                  holder.local = useLocal()

                  if (draftID) holder.composer = createComposerModelSelection({ draftID })

                  if (draftID && newSession)
                    holder.newSession = createNewSessionComposerAdapter({
                      draftID,
                      mode: () => "chat",
                      worktree: () => "main",
                      branch: () => undefined,
                      submitted() {},
                      mcp: {
                        controls: { preview: false, states: {}, pending: false, change() {} },
                        directory: () => directory,
                        capture: () => ({}),
                        prepare: async () => true,
                        remember() {},
                      },
                    })
                  holder.controls = createComposerControls({ model: holder.composer })

                  return null
                },
              })
            },
          })

          return dispose
        })

        cleanups.push(dispose)

        if (!holder.local || !holder.controls) throw new Error("LocalProvider did not mount")

        return {
          local: holder.local,
          controls: holder.controls,
          composer: holder.composer,
          newSession: holder.newSession,
          dispose,
        }
      },
    }

    cleanups.push(() => removePersisted(Persist.serverWorkspace(ServerScope.local, directory, "model-selection")))

    return result
  }

  function selection(local: ReturnType<typeof useLocal>) {
    const preference = local.executor.preference()

    const executorPreference: SessionExecutorPreference | undefined = preference
      ? {
          ...preference,
          model: preference.model ? { ...preference.model } : undefined,
        }
      : undefined

    return {
      model: local.model.current()?.id,
      variant: local.model.variant.current(),
      executorPreference,
    }
  }

  function commit(local: ReturnType<typeof useLocal>) {
    const model = local.model.current()

    if (!model) throw new Error("Meta model is unavailable")
    const selected = selection(local)

    return {
      agent: "meta",
      model: key(model.id),
      variant: selected.variant,
      executorPreference: selected.executorPreference,
    }
  }

  function canonical(selection: Canonical, updated = 1): SessionInfo {
    return {
      ...selection,
      id: "ses_a",
      projectID: "project_a",
      location: { directory: "/meta-submit-test" },
      time: { created: 1, updated },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }
  }

  test("Meta and executor groups retain distinct identities through canonical ACK and persisted choices", () => {
    const group = (groupID: string, modelID: string): ModelGroupCurrent => ({ groupID, definition: {
      name: groupID, enabled: true, members: [{ providerID: "provider", id: modelID }], strategy: "order", affinity: "turn",
    } })

    const f = fixture({ groups: [group("meta-route", "a"), group("executor-route", "b"), group("alternate-route", "c")] })
    const mounted = f.mount()
    const local = mounted.local
    local.model.set({ type: "group", groupID: "meta-route" }, { recent: true })
    local.executor.model.set({ type: "group", groupID: "executor-route" }, { recent: true })

    const expected = { agent: "meta", model: { type: "group" as const, groupID: "meta-route" },
      executorPreference: { agent: "build", model: { type: "group" as const, groupID: "executor-route" } } }

    const actual: Canonical = { ...root("a"), model: expected.model, executorPreference: expected.executorPreference }
    const acknowledge = local.model.trackSessionCommit("ses_a", expected)
    const other: Canonical = { ...actual, executorPreference: { agent: "build", model: { type: "group", groupID: "alternate-route" } } }
    f.publish(other, "session.executor.selected")
    expect(acknowledge(canonical(other))).toBe("failed")
    expect(local.model.key()).toEqual(expected.model)
    expect(local.executor.preference()).toEqual(expected.executorPreference)
    f.publish(actual, "session.model.selected")
    expect(acknowledge(canonical(actual))).toBe("acknowledged")
    expect(local.model.key()).toEqual(expected.model)
    expect(local.executor.model.key()).toEqual(expected.executorPreference.model)
    expect(local.model.identity()).toMatchObject({ type: "group", groupID: "meta-route", unavailable: undefined })
    expect(local.executor.model.identity()).toMatchObject({ type: "group", groupID: "executor-route", unavailable: undefined })
    expect(local.model.variant.current()).toBeUndefined()
    expect(local.executor.model.variant.current()).toBeUndefined()
    flushPersisted()
    mounted.dispose()
    const restored = f.mount().local
    expect(restored.model.key()).toEqual(expected.model)
    expect(restored.executor.preference()).toEqual(expected.executorPreference)
    f.set("groups", 0, "unavailable", "disabled")
    expect(restored.model.key()).toEqual(expected.model)
    expect(restored.model.identity()).toMatchObject({ type: "group", groupID: "meta-route", name: "meta-route", unavailable: "model.group.unavailable.disabled" })
    expect(restored.model.identity()).not.toHaveProperty("provider")
  })

  function submitSelection(
    controls: ReturnType<typeof createComposerControls>,
    session: ComposerSession,
    failed: Parameters<typeof createComposerSubmit>[0]["notify"]["failed"] = () => {},
    execute: (() => void) | "prompt" = () => {},
  ) {
    return createComposerSubmit({
      adapter: {
        kind: "active-session",
        state: createMemoryComposerState({
          prompt: execute === "prompt" ? "ship it" : "/btw inspect the selection",
        }).capture(),
        ready: () => true,
        controls,
        working: () => false,
        session: () => session,
        interrupt: async () => {},
        submitted() {},
        setEditor() {},
      },
      mode: () => "normal",
      commands: () => [],
      clientCommand: execute === "prompt" ? undefined : () => execute,
      editor: () => undefined,
      queueScroll() {},
      addToHistory() {},
      removeFromHistory() {},
      resetHistory() {},
      setMode() {},
      closePopover() {},
      notify: { missingSelection() {}, unqueueable() {}, failed },
      comments: { capture: () => [], clear() {}, restore() {} },
    }).submit(new Event("submit"))
  }

  function activeAdmissionFixture(initial: SessionInfo, read: (request: Request) => Response | Promise<Response>) {
    const requests: Request[] = []
    const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()

    const owner = {
      api: client({
        baseUrl: "http://aigcfroge.local",
        fetch: async (input, init) => {
          const request = input instanceof Request ? input : new Request(input, init)
          requests.push(request.clone())

          return read(request)
        },
      }),
    }

    const setup = createRoot((dispose) => ({
      data: createData({
        api: () => owner.api,
        directory: initial.location.directory,
        event: {
          on: () => () => {},
          listen(handler) {
            listeners.add(handler)

            return () => listeners.delete(handler)
          },
        },
      }),
      dispose,
    }))

    cleanups.push(setup.dispose)
    const admissions: Promise<unknown>[] = []

    // Observe settlement while every call still uses the actual Data admission implementation.
    const data = {
      ...setup.data,
      session: {
        ...setup.data.session,
        prompt: (input: Parameters<Data["session"]["prompt"]>[0]) => {
          const request = setup.data.session.prompt(input)
          admissions.push(request)

          return request
        },
      },
    }

    setup.data.session.remember(structuredClone(initial))
    const f = fixture({ data, api: () => owner.api })
    const mounted = f.mount()

    const view = createRoot((dispose) => ({
      adapter: createActiveComposerAdapter({
        sessionID: initial.id,
        controls: mounted.controls,
        submitted() {},
        setEditor() {},
      }),
      dispose,
    }))

    cleanups.push(view.dispose)

    return {
      data: setup.data,
      owner,
      f,
      mounted,
      adapter: view.adapter,
      dispose: view.dispose,
      requests,
      admissions,
      emit: (details: AigcForgeEvent) => listeners.forEach((listener) => listener({ name: details.type, details })),
    }
  }

  function submitActive(
    adapter: ComposerAdapter,
    delivery: "steer" | "queue",
    failed: Parameters<typeof createComposerSubmit>[0]["notify"]["failed"],
  ) {
    return createComposerSubmit({
      adapter,
      delivery: () => delivery,
      mode: () => "normal",
      commands: () => [],
      editor: () => undefined,
      queueScroll() {},
      addToHistory() {},
      removeFromHistory() {},
      resetHistory() {},
      setMode() {},
      closePopover() {},
      notify: { missingSelection() {}, unqueueable() {}, failed },
      comments: { capture: () => [], clear() {}, restore() {} },
    }).submit(new Event("submit"))
  }

  test("Meta submission keeper: first activation uses the captured model and waits for full canonical ACK", async () => {
    const initial = canonical({ agent: "plan", model: { id: "old", providerID: "unavailable" } })
    const selected = canonical(root("a", "high", executor("build")), 3)

    if (selected.controller?.kind !== "root") throw new Error("Meta activation fixture is not a root")
    const agentEntered = Promise.withResolvers<Omit<SessionSwitchAgentInput, "sessionID">>()
    const agentResponse = Promise.withResolvers<Response>()
    const readEntered = Promise.withResolvers<void>()
    const readResponse = Promise.withResolvers<Response>()
    const admitted = Promise.withResolvers<PromptBody>()
    const failed = Promise.withResolvers<never>()

    const setup = activeAdmissionFixture(initial, async (request) => {
      const path = new URL(request.url).pathname

      if (path === "/api/session/ses_a/agent") {
        agentEntered.resolve(await request.json())

        return agentResponse.promise
      }

      if (path === "/api/session/ses_a/executor") return Response.json({ data: selected })

      if (path === "/api/session/ses_a/model") return new Response(null, { status: 204 })

      if (path === "/api/session/ses_a") {
        readEntered.resolve()

        return readResponse.promise
      }

      if (path === "/api/session/ses_a/prompt") {
        const body = await request.json()
        admitted.resolve(body)

        return Response.json({
          data: {
            id: body.id,
            sessionID: initial.id,
            type: "user",
            delivery: "steer",
            payload: { text: body.text },
            time: { created: 4 },
          },
        })
      }

      throw new Error("Unexpected activation request: " + path)
    })

    try {
      const local = setup.mounted.local
      local.agent.set("meta")
      local.model.set(key("a"))
      local.model.variant.set("high")
      local.executor.set(executor("build"))
      setup.adapter.state.set([{ type: "text", content: "Activate Meta", start: 0, end: 13 }], 13)
      await submitActive(setup.adapter, "steer", (_kind, error) => failed.reject(error))
      expect(await Promise.race([agentEntered.promise, failed.promise])).toEqual({
        agent: "meta",
        model: { id: "a", providerID: "provider", variant: "high" },
      })
      setup.emit({
        type: "session.agent.selected",
        id: "evt_activation",
        created: 2,
        durable: { aggregateID: initial.id, seq: 1, version: 1 },
        data: { sessionID: initial.id, agent: "meta", model: selected.model, controller: selected.controller },
      })
      expect(setup.data.session.get(initial.id)?.agent).toBe("meta")
      expect(setup.data.session.get(initial.id)?.controller).toBeUndefined()
      expect(setup.data.session.get(initial.id)?.model).toMatchObject({ id: "old" })
      expect(selection(local)).toEqual({ model: "a", variant: "high", executorPreference: executor("build") })
      expect(setup.admissions).toEqual([])
      agentResponse.resolve(new Response(null, { status: 204 }))
      await Promise.race([readEntered.promise, failed.promise])
      expect(setup.admissions).toEqual([])
      expect(selection(local)).toEqual({ model: "a", variant: "high", executorPreference: executor("build") })
      readResponse.resolve(Response.json({ data: selected }))
      expect(await Promise.race([admitted.promise, failed.promise])).toMatchObject({
        metadata: {
          agent: "meta",
          model: { modelID: "a", providerID: "provider", variant: "high" },
          executorPreference: { agent: "build" },
        },
      })
      await Promise.all(setup.admissions)
      expect(setup.data.session.get(initial.id)).toMatchObject({
        id: initial.id,
        agent: "meta",
        model: selected.model,
        controller: selected.controller,
        executorPreference: { agent: "build" },
        time: { updated: 3 },
      })
      setup.data.session.remember(canonical({ ...root("b", "low"), agent: "build" }, 5))
      expect(local.agent.current()?.name).toBe("build")
      expect(local.executor.preference()).toBeUndefined()
      expect(local.model.current()?.id).toBe("b")
    } finally {
      agentResponse.resolve(new Response(null, { status: 204 }))
      readResponse.resolve(Response.json({ data: selected }))
    }
  })

  test("Meta admission preserves an absent canonical executor preference", async () => {
    const initial = canonical({ ...root("a", "high"), executorPreference: undefined })
    const admitted = Promise.withResolvers<PromptBody>()
    const failed = Promise.withResolvers<never>()

    const setup = activeAdmissionFixture(initial, async (request) => {
      const path = new URL(request.url).pathname

      if (path === "/api/session/ses_a/model") return new Response(null, { status: 204 })

      if (path === "/api/session/ses_a") return Response.json({ data: initial })

      if (path === "/api/session/ses_a/prompt") {
        const body = await request.json()
        admitted.resolve(body)

        return Response.json({
          data: {
            id: body.id,
            sessionID: initial.id,
            type: "user",
            delivery: "steer",
            payload: { text: body.text },
            time: { created: 4 },
          },
        })
      }

      throw new Error("Unexpected implicit executor request: " + path)
    })

    setup.mounted.local.model.set(key("a"))
    setup.mounted.local.model.variant.set("high")
    setup.adapter.state.set([{ type: "text", content: "Inspect directory", start: 0, end: 17 }], 17)
    await submitActive(setup.adapter, "steer", (_kind, error) => failed.reject(error))
    const body = await Promise.race([admitted.promise, failed.promise])
    expect(body.metadata).not.toHaveProperty("executorPreference")
    await Promise.all(setup.admissions)
    expect(setup.requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/api/session/ses_a/model",
      "/api/session/ses_a",
      "/api/session/ses_a/prompt",
    ])
    expect(setup.data.session.get(initial.id)?.executorPreference).toBeUndefined()
    expect(setup.mounted.local.executor.preference()).toBeUndefined()
  })

  test.each([
    { agent: "build", publication: "coherent" },
    { agent: "plan", publication: "coherent" },
    { agent: "build", publication: "newer selection" },
  ] as const)(
    "Meta submission keeper: deactivation captures $agent after $publication publication",
    async ({ agent, publication }) => {
      const initial = canonical(root("a", "high"))
      const selected = canonical({ ...root("b", "low"), agent }, 3)
      const newer = canonical(root("c", "high"), 4)
      const entered = Promise.withResolvers<PromptBody>()
      const readEntered = Promise.withResolvers<void>()
      const readResponse = Promise.withResolvers<Response>()
      const failed = Promise.withResolvers<never>()

      const setup = activeAdmissionFixture(initial, async (request) => {
        const path = new URL(request.url).pathname

        if (path === "/api/session/ses_a/agent") {
          expect(await request.json()).toEqual({ agent, model: { id: "b", providerID: "provider", variant: "low" } })

          return new Response(null, { status: 204 })
        }

        if (path === "/api/session/ses_a/model") return new Response(null, { status: 204 })

        if (path === "/api/session/ses_a") {
          readEntered.resolve()

          return readResponse.promise
        }

        if (path === "/api/session/ses_a/prompt") {
          const body = await request.json()
          entered.resolve(body)

          return Response.json({
            data: {
              id: body.id,
              sessionID: initial.id,
              type: "user",
              delivery: "steer",
              payload: { text: body.text },
              time: { created: 4 },
            },
          })
        }

        throw new Error("Unexpected deactivation request: " + path)
      })

      try {
        setup.mounted.local.agent.set(agent)
        setup.mounted.local.model.set(key("b"))
        setup.mounted.local.model.variant.set("low")
        setup.adapter.state.set([{ type: "text", content: "Ordinary work", start: 0, end: 13 }], 13)
        await submitActive(setup.adapter, "steer", (_kind, error) => failed.reject(error))
        await Promise.race([readEntered.promise, failed.promise])
        setup.emit({
          id: "evt_deactivation_selected",
          type: "session.agent.selected",
          created: selected.time.updated,
          durable: { aggregateID: initial.id, seq: 1, version: 1 },
          data: { sessionID: initial.id, agent },
        })

        if (publication === "newer selection") setup.data.session.remember(structuredClone(newer))
        expect(setup.requests.filter((request) => new URL(request.url).pathname.endsWith("/prompt"))).toHaveLength(0)
        const result = Promise.race([entered.promise, failed.promise])
        readResponse.resolve(Response.json({ data: selected }))

        if (publication === "newer selection") {
          await expect(result).rejects.toMatchObject({ reason: "mismatch" })
          expect(setup.data.session.get(initial.id)).toEqual(newer)
          expect(setup.admissions).toEqual([])

          return
        }

        const body = await result
        expect(body.metadata).toMatchObject({ agent, model: { modelID: "b", providerID: "provider", variant: "low" } })
        expect(body.metadata).not.toHaveProperty("executorPreference")
        await Promise.all(setup.admissions)
        expect(setup.admissions).toHaveLength(1)
        expect(setup.requests.map((request) => new URL(request.url).pathname)).toEqual([
          "/api/session/ses_a/agent",
          "/api/session/ses_a/model",
          "/api/session/ses_a",
          "/api/session/ses_a/prompt",
        ])
        expect(setup.mounted.local.executor.preference()).toBeUndefined()
        expect(setup.mounted.local.agent.current()?.name).toBe(agent)
      } finally {
        readResponse.resolve(Response.json({ data: selected }))
        await Promise.allSettled(setup.admissions)
      }
    },
  )

  test.each(["steer", "queue"] as const)(
    "Meta active admission owner keeper: an old %s failure never retries on a replacement SDK",
    async (delivery) => {
      const initial = canonical(root("a", "default"))
      const entered = Promise.withResolvers<PromptBody>()
      const response = Promise.withResolvers<Response>()
      const replacementEntered = Promise.withResolvers<void>()
      const replacementRequests: Request[] = []
      const failed = Promise.withResolvers<void>()
      const errors: unknown[] = []

      const replacement = client({
        baseUrl: "http://replacement.local",
        fetch: async (input, init) => {
          replacementRequests.push(input instanceof Request ? input : new Request(input, init))
          replacementEntered.resolve()
          throw new TypeError("Unexpected cross-owner replay")
        },
      })

      const setup = activeAdmissionFixture(initial, async (request) => {
        const path = new URL(request.url).pathname

        if (path === "/api/session/ses_a/model") return new Response(null, { status: 204 })

        if (path === "/api/session/ses_a") return Response.json({ data: initial })

        if (path === "/api/session/ses_a/prompt") {
          entered.resolve(await request.json())

          return response.promise
        }

        throw new Error("Unexpected active admission request: " + path)
      })

      try {
        setup.adapter.state.set([{ type: "text", content: "captured draft", start: 0, end: 14 }], 14)
        await submitActive(setup.adapter, delivery, (_kind, error) => {
          errors.push(error)
          failed.resolve()
        })
        const captured = await entered.promise
        expect(captured).toMatchObject({
          text: "captured draft",
          delivery,
          metadata: {
            agent: "meta",
            model: { providerID: "provider", modelID: "a", variant: "default" },
            executorPreference: initial.executorPreference,
          },
        })
        expect(Schema.is(Schema.String)(captured.id)).toBe(true)
        setup.adapter.state.set([{ type: "text", content: "newer draft", start: 0, end: 11 }], 11)
        const newer = structuredClone(unwrap(setup.adapter.state.current()))
        setup.owner.api = replacement
        response.reject(new TypeError("Old response lost"))
        await Promise.race([failed.promise, replacementEntered.promise])
        expect(replacementRequests).toEqual([])
        expect(setup.admissions).toHaveLength(1)
        expect(errors).toMatchObject([{ reason: "Transport" }])
        expect(setup.adapter.state.current()).toEqual(newer)
        expect(
          setup.requests.filter(
            (request) => new URL(request.url).pathname === "/api/session/" + initial.id + "/prompt",
          ),
        ).toHaveLength(1)
      } finally {
        response.resolve(new Response(null, { status: 204 }))
        await Promise.allSettled(setup.admissions)
      }
    },
  )

  test.each(["steer", "queue"] as const)(
    "Meta active admission owner keeper: same-owner %s retries keep the ID and acknowledged draft",
    async (delivery) => {
      const initial = canonical(root("a", "default"))
      const entered = Promise.withResolvers<PromptBody>()
      const retried = Promise.withResolvers<void>()
      const response = Promise.withResolvers<Response>()
      const bodies: PromptBody[] = []
      const errors: unknown[] = []

      const setup = activeAdmissionFixture(initial, async (request) => {
        const path = new URL(request.url).pathname

        if (path === "/api/session/ses_a/model") return new Response(null, { status: 204 })

        if (path === "/api/session/ses_a") return Response.json({ data: initial })

        if (path === "/api/session/ses_a/prompt") {
          const body: PromptBody = await request.json()
          bodies.push(body)

          if (bodies.length === 1) {
            entered.resolve(body)

            return response.promise
          }

          retried.resolve()

          return Response.json({
            data: {
              id: body.id,
              sessionID: initial.id,
              type: "user",
              delivery,
              payload: { text: body.text, metadata: body.metadata },
              time: { created: 4 },
            },
          })
        }

        throw new Error("Unexpected same-owner admission request: " + path)
      })

      try {
        setup.adapter.state.set([{ type: "text", content: "captured draft", start: 0, end: 14 }], 14)
        await submitActive(setup.adapter, delivery, (_kind, error) => errors.push(error))
        const captured = await entered.promise

        const promptID = Schema.decodeUnknownSync(Schema.String)(captured.id)

        setup.emit({
          id: "evt_active_durable_ack",
          created: 4,
          type: "session.inbox.enqueued",
          durable: { aggregateID: initial.id, seq: 1, version: 1 },
          data: {
            sessionID: initial.id,
            inboxID: promptID,
            item: { type: "user", delivery, payload: { text: "captured draft" } },
          },
        })
        expect(setup.data.session.input.has(initial.id, promptID)).toBe(true)
        response.reject(new TypeError("Same-owner response lost"))
        await retried.promise
        await Promise.allSettled(setup.admissions)
        expect(bodies).toHaveLength(2)
        expect(bodies[1]).toEqual(captured)
        expect(setup.admissions).toHaveLength(2)
        expect(errors).toEqual([])
        expect(setup.adapter.state.current()).toEqual([{ type: "text", content: "", start: 0, end: 0 }])
        expect(setup.data.session.input.has(initial.id, promptID)).toBe(true)
      } finally {
        response.resolve(new Response(null, { status: 204 }))
        await Promise.allSettled(setup.admissions)
      }
    },
  )

  test.each([
    ["gate", "SDK replaced"],
    ["prepare", "SDK replaced"],
    ["gate", "view disposed"],
    ["prepare", "view disposed"],
    ["gate", "directory changed"],
    ["prepare", "directory changed"],
  ] as const)("Meta active admission owner keeper: %s waiting respects %s", async (phase, change) => {
    const initial = canonical(root("a", "default"))
    const ready = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const replacementRequests: Request[] = []

    const replacement = client({
      baseUrl: "http://replacement.local",
      fetch: async (input, init) => {
        replacementRequests.push(input instanceof Request ? input : new Request(input, init))
        throw new TypeError("Unexpected replacement request")
      },
    })

    const setup = activeAdmissionFixture(initial, (request) => {
      throw new Error("Waiting admission reached the HTTP boundary: " + request.url)
    })

    const bound = setup.adapter.session()

    const sending = bound.data.session.prompt({
      id: "msg_active_wait",
      sessionID: initial.id,
      text: "wait for this owner",
      delivery: "queue",
      gate: phase === "gate" ? release.promise : undefined,
      prepare:
        phase === "prepare"
          ? () => {
              ready.resolve()

              return release.promise
            }
          : undefined,
    })

    const settled = Promise.allSettled([sending])

    try {
      if (phase === "prepare") await Promise.race([ready.promise, settled])
      expect(setup.data.session.input.has(initial.id, "msg_active_wait")).toBe(true)

      if (change === "SDK replaced") setup.owner.api = replacement

      if (change === "view disposed") setup.dispose()

      if (change === "directory changed") setup.f.directory = setup.f.directory + "/other"
      release.resolve()
      expect(await settled).toMatchObject([{ status: "rejected", reason: { reason: "Transport" } }])
      expect(setup.requests).toEqual([])
      expect(replacementRequests).toEqual([])
    } finally {
      release.resolve()
      await settled
    }
  })

  test.each([
    { operation: "executor", change: "SDK replaced" },
    { operation: "readback", change: "SDK replaced" },
    { operation: "readback", change: "Session deleted" },
  ] as const)(
    "Meta active admission owner keeper: held $operation results respect $change",
    async ({ operation, change }) => {
      const initial = canonical(root("a", "default"))
      const selected = canonical(root("a", "default", executor("explore", "c", "high")), 2)
      const started = Promise.withResolvers<void>()
      const release = Promise.withResolvers<Response>()
      const replacementRequests: Request[] = []

      const replacement = client({
        baseUrl: "http://replacement.local",
        fetch: async (input, init) => {
          replacementRequests.push(input instanceof Request ? input : new Request(input, init))
          throw new TypeError("Unexpected post-owner operation")
        },
      })

      const setup = activeAdmissionFixture(initial, (request) => {
        const path = new URL(request.url).pathname

        if (path !== (operation === "executor" ? "/api/session/ses_a/executor" : "/api/session/ses_a"))
          throw new Error("Unexpected held owner request: " + path)
        started.resolve()

        return release.promise
      })

      const bound = setup.adapter.session()
      bound.data.session.invalidate!(initial.id)

      const sending =
        operation === "executor"
          ? bound.data.session.selectExecutor!({
              sessionID: initial.id,
              executorPreference: selected.executorPreference!,
            })
          : bound.data.session.readback!(initial.id)

      const settled = Promise.allSettled([sending])

      try {
        await Promise.race([started.promise, settled])
        expect(setup.requests).toHaveLength(1)

        if (change === "SDK replaced") setup.owner.api = replacement

        if (change === "Session deleted")
          setup.emit({
            id: "evt_held_ack_deleted",
            created: 3,
            type: "session.deleted",
            durable: { aggregateID: initial.id, seq: 1, version: 2 },
            data: { sessionID: initial.id },
          })
        release.resolve(Response.json({ data: selected }))

        if (change === "SDK replaced") {
          expect(await settled).toMatchObject([{ status: "rejected", reason: { reason: "Transport" } }])
          await expect(
            bound.api.switchModel({
              sessionID: initial.id,
              model: { id: "b", providerID: "provider", variant: "low" },
            }),
          ).rejects.toMatchObject({ reason: "Transport", message: "Transport: Session submission owner changed" })
          expect(setup.data.session.get(initial.id)?.executorPreference).toEqual(initial.executorPreference)
        }

        if (change === "Session deleted") {
          expect(await settled).toEqual([{ status: "fulfilled", value: undefined }])
          expect(setup.data.session.get(initial.id)).toBeUndefined()
        }

        expect(replacementRequests).toEqual([])
      } finally {
        release.resolve(Response.json({ data: selected }))
        await settled
      }
    },
  )

  test.each([
    { agent: "build", variant: "low" },
    { agent: "plan", variant: "high" },
  ])("ordinary root selection captures $agent with its own model and variant", async (row) => {
    const f = fixture({ newSession: true, preferredVariants: {} })
    const { local, controls } = f.mount("draft_a")
    expect(controls().agents.options).toEqual(["meta", "build", "plan"])
    expect(local.agent.list().map((item) => item.name)).toEqual(["meta", "build", "plan"])
    local.agent.set(row.agent)
    expect(local.metaSelected()).toBe(false)
    expect(local.agent.current()?.name).toBe(row.agent)
    expect(controls().agents.current).toBe(row.agent)
    expect(local.model.current()?.id).toBe("b")
    expect(local.model.variant.current()).toBe(row.variant)
    const captured: ComposerSelection[] = []
    const errors: unknown[] = []
    f.prompt.set([{ type: "text", content: "ordinary root", start: 0, end: 13 }], 13)
    await submitActive(
      {
        kind: "new-session",
        state: f.prompt.capture(),
        ready: () => true,
        controls,
        working: () => false,
        submitted() {},
        async start(value) {
          captured.push(value)

          return undefined
        },
      },
      "steer",
      (_kind, error) => errors.push(error),
    )
    expect(errors).toEqual([])
    expect(captured).toEqual([
      { agent: row.agent, model: key("b"), variant: row.variant, executorPreference: undefined },
    ])
  })

  test("ordinary root selection preserves the backend default with custom-Agent visibility disabled", () => {
    const f = fixture({
      newSession: true,
      preferredVariants: {},
      agents: [
        agent("plan", "primary", "b", "low"),
        agent("build", "all", "c", "high"),
        agent("meta", "primary", "a", "high"),
        agent("explore", "subagent", "c"),
      ],
    })

    f.set("visible", false)
    const { local, controls } = f.mount("draft_a")
    expect(local.metaSelected()).toBe(false)
    expect(controls().agents.options).toEqual(["plan", "build", "meta"])
    expect(controls().agents.visible).toBe(true)
    expect(local.agent.current()?.name).toBe("plan")
    expect(local.model.current()?.id).toBe("b")
    expect(local.model.variant.current()).toBe("low")
    expect(local.executor.preference()).toBeUndefined()
  })

  test.each([
    { agent: "build", modelID: "c", variant: "high" },
    { agent: "plan", modelID: "b", variant: "low" },
    { agent: "meta", modelID: "a", variant: "high" },
  ])("NewSession adapter creates the captured $agent through the real SDK", async (row) => {
    const requested: unknown[] = []
    const created = new Map<string, SessionInfo>()
    const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
    const admitted = Promise.withResolvers<unknown>()
    const failed = Promise.withResolvers<never>()

    const api = client({
      baseUrl: "http://aigcfroge.local",
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init)
        const path = new URL(request.url).pathname

        if (path === "/api/session") {
          const body: unknown = await request.json()
          requested.push(body)

          if (!Predicate.hasProperty(body, "id") || !Predicate.isString(body.id))
            throw new Error("Session ID was not captured")

          const info: SessionInfo = {
            ...canonical(
              row.agent === "meta"
                ? {
                    ...root(row.modelID, row.variant, executor("build")),
                    executorPreference: undefined,
                    controller: { kind: "root", metaAgentID: "meta_new", rootSessionID: body.id },
                  }
                : {
                    agent: row.agent,
                    model: { id: row.modelID, providerID: "provider", variant: row.variant },
                  },
            ),
            id: body.id,
            location: { directory: f.directory },
          }

          created.set(info.id, info)

          return Response.json({ data: info })
        }

        if (path.endsWith("/model")) return new Response(null, { status: 204 })

        if (request.method === "GET" && path.startsWith("/api/session/")) {
          const info = created.get(path.split("/").at(-1) ?? "")

          if (!info?.model) throw new Error("Created Session was not found")
          const selected: SessionInfo = { ...info, time: { ...info.time, updated: 2 } }

          const event: AigcForgeEvent = {
            id: "evt_new_ack_selected",
            type: "session.model.selected",
            created: 2,
            durable: { aggregateID: info.id, seq: 1, version: 1 },
            data: { sessionID: info.id, model: info.model },
          }

          listeners.forEach((listener) => listener({ name: event.type, details: event }))

          return Response.json({ data: selected })
        }

        if (path.endsWith("/prompt")) {
          const body: unknown = await request.json()

          if (
            !Predicate.hasProperty(body, "id") ||
            !Predicate.hasProperty(body, "text") ||
            !Predicate.hasProperty(body, "metadata")
          )
            throw new Error("Prompt payload was not captured")
          admitted.resolve(body)

          return Response.json({
            data: {
              id: body.id,
              sessionID: path.split("/").at(-2),
              type: "user",
              delivery: "steer",
              payload: { text: body.text, metadata: body.metadata },
              time: { created: 4 },
            },
          })
        }

        throw new Error("Unexpected NewSession request: " + path)
      },
    })

    const setup = createRoot((dispose) => ({
      data: createData({
        api: () => api,
        directory: "/new-session-selection-test",
        event: {
          on: () => () => {},
          listen(handler) {
            listeners.add(handler)

            return () => listeners.delete(handler)
          },
        },
      }),
      dispose,
    }))

    cleanups.push(setup.dispose)

    const f = fixture({
      newSession: true,
      data: setup.data,
      preferredVariants: {},
      api: () => api,
      agents: [
        agent("plan", "primary", "b", "low"),
        agent("build", "all", "c", "high"),
        agent("meta", "primary", "a", "high"),
        agent("explore", "subagent", "c"),
      ],
    })

    f.set("visible", false)
    const mounted = f.mount("draft_a", true)

    if (!mounted.newSession) throw new Error("NewSession adapter did not mount")

    if (row.agent !== "plan") mounted.local.agent.set(row.agent)
    expect(mounted.local.agent.current()?.name).toBe(row.agent)
    expect(mounted.controls().agents.visible).toBe(true)
    f.prompt.set([{ type: "text", content: "ordinary root", start: 0, end: 13 }], 13)
    await submitActive(mounted.newSession.adapter, "steer", (_kind, error) => failed.reject(error))
    const prompt = await Promise.race([admitted.promise, failed.promise])

    if (!Predicate.hasProperty(prompt, "metadata")) throw new Error("Prompt payload was not captured")
    expect(requested).toHaveLength(1)
    expect(requested[0]).toMatchObject({
      agent: row.agent,
      mode: "chat",
      model: { id: row.modelID, providerID: "provider", variant: row.variant },
      location: { directory: f.directory },
    })
    expect(requested[0]).not.toHaveProperty("control")

    expect(requested[0]).not.toHaveProperty("executorPreference")
    expect(prompt.metadata).toMatchObject({
      agent: row.agent,
      model: { modelID: row.modelID, providerID: "provider", variant: row.variant },
    })
  })

  test("Meta and executor model/effort choices stay independent", () => {
    const f = fixture()
    const { local } = f.mount()
    const preferred = { ...f.preferences.store.variant }
    local.executor.set(executor("explore"))
    local.executor.model.set(key("c"))
    local.executor.model.variant.set("low")
    expect(selection(local)).toEqual({
      model: "a",
      variant: "high",
      executorPreference: executor("explore", "c", "low"),
    })
    expect(f.preferences.store.variant).toEqual(preferred)
    local.model.set(key("b"))
    local.model.variant.set("high")
    expect(selection(local)).toEqual({
      model: "b",
      variant: "high",
      executorPreference: executor("explore", "c", "low"),
    })
    expect(local.executor.model.current()?.id).toBe("c")
    expect(local.executor.model.variant.current()).toBe("low")
  })

  test("historical user selection retains its ID while ordinary options require the public mode projection", () => {
    const f = fixture({
      session: { agent: "user-root", model: { id: "a", providerID: "provider" } },
      agents: [
        agent("build", "all", "b"),
        { ...agent("user-root", "primary", "a"), originKind: "user", ordinaryModes: ["custom"] },
        { ...agent("user-worker", "subagent", "c"), originKind: "user", ordinaryModes: ["custom"] },
      ],
    })

    const { local, controls } = f.mount()
    expect(local.agent.current()?.name).toBe("user-root")
    expect(controls().agents.current).toBe("user-root")
    expect(controls().agents.options).toEqual(["build"])
    expect(controls().agents.available.map((agent) => agent.name)).toEqual(["build"])
    local.agent.set("build")
    expect(controls().agents.current).toBe("build")
  })

  test("a Meta child keeps its fixed Agent, model and executor binding", () => {
    const binding = {
      agent: "build",
      model: { id: "b", providerID: "provider", variant: "low" },
      source: "preference" as const,
    }

    const f = fixture({
      session: {
        agent: binding.agent,
        model: binding.model,
        controller: {
          kind: "child",
          metaAgentID: "meta_a",
          rootSessionID: "ses_root",
          executor: binding,
          source: { kind: "subagent", assistantMessageID: "msg_parent", toolCallID: "call_worker" },
        },
      },
    })

    const { local, controls } = f.mount()
    local.agent.set("plan")
    local.model.set(key("c"))
    local.model.variant.set("high")
    local.executor.set(executor("explore", "c", "high"))
    local.executor.model.set(key("c"))
    expect(local.locked()).toBe(true)
    expect(local.metaSelected()).toBe(false)
    expect(controls().agents.options).toEqual(["build"])
    expect(local.agent.current()?.name).toBe("build")
    expect(selection(local)).toEqual({ model: "b", variant: "low", executorPreference: undefined })
  })

  test("ordinary Build memory survives Meta's Build executor edits", () => {
    const f = fixture({ newSession: true })
    const { local } = f.mount("draft_a")
    local.agent.set("build")
    local.model.set(key("c"))
    local.model.variant.set("low")
    local.agent.set("meta")
    local.executor.model.set(key("b"))
    local.executor.model.variant.set("high")
    expect(local.agent.current()?.name).toBe("meta")
    expect(local.executor.preference()).toEqual(executor("build", "b", "high"))
    local.agent.set("build")
    expect(local.agent.current()?.name).toBe("build")
    expect(selection(local)).toEqual({ model: "c", variant: "low", executorPreference: undefined })
  })

  test("legacy Meta Agent memory is restored in the executor domain", () => {
    const f = fixture()
    const target = Persist.serverWorkspace(ServerScope.local, f.directory, "model-selection")
    localStorage.setItem(
      [target.storage, target.key].join(":"),
      JSON.stringify({
        session: {
          ses_a: {
            agent: "meta",
            executorPreference: executor("build", "b", "low"),
            choices: { explore: { model: key("c"), variant: "high" } },
          },
        },
      }),
    )
    const { local } = f.mount()
    local.executor.set(executor("explore"))
    expect(local.agent.current()?.name).toBe("meta")
    expect(selection(local)).toEqual({
      model: "a",
      variant: "high",
      executorPreference: executor("explore", "c", "high"),
    })
    local.executor.set(executor("build"))
    expect(local.executor.preference()).toEqual(executor("build", "b", "low"))
  })

  test.each(["Meta", "executor"] as const)(
    "releases a %s-only edit only through its captured canonical ACK",
    (domain) => {
      const f = fixture()
      const { local } = f.mount()

      if (domain === "Meta") {
        local.model.set(key("b"))
        local.model.variant.set("low")
      }

      if (domain === "executor") {
        local.executor.set(executor("explore"))
        local.executor.model.set(key("c"))
        local.executor.model.variant.set("low")
      }

      const attempted = commit(local)
      const before = selection(local)
      const acknowledge = local.model.trackSessionCommit("ses_a", attempted)
      f.publish(
        root(attempted.model.modelID, attempted.variant, attempted.executorPreference),
        domain === "executor" ? "session.executor.selected" : "session.model.selected",
      )
      f.publish(root("c", "default", executor("build", "a", "high")))
      expect(selection(local)).toEqual(before)
      f.publish(root(attempted.model.modelID, attempted.variant, attempted.executorPreference))
      expect(
        acknowledge(canonical(root(attempted.model.modelID, attempted.variant, attempted.executorPreference))),
      ).toBe("acknowledged")
      f.publish(root("c", "default", executor("build", "a", "high")))
      expect(selection(local)).toEqual({
        model: "c",
        variant: "default",
        executorPreference: executor("build", "a", "high"),
      })
    },
  )

  test.each([
    {
      domain: "Meta",
      stored: { agent: "meta", model: key("b"), variant: "low" },
      canonical: root("b", "low"),
    },
    {
      domain: "executor",
      stored: { agent: "meta", executorPreference: executor("explore", "c", "low") },
      canonical: root("a", "high", executor("explore", "c", "low")),
    },
  ])("keeps a hydrated partial %p overlay until its captured canonical ACK", (item) => {
    const f = fixture()
    const target = Persist.serverWorkspace(ServerScope.local, f.directory, "model-selection")
    localStorage.setItem([target.storage, target.key].join(":"), JSON.stringify({ session: { ses_a: item.stored } }))
    const { local } = f.mount()
    const before = selection(local)
    const acknowledge = local.model.trackSessionCommit("ses_a", commit(local))
    f.publish(item.canonical, "session.executor.selected")
    f.publish(root("c", "default", executor("build", "a", "high")))
    expect(selection(local)).toEqual(before)
    f.publish(item.canonical)
    expect(acknowledge(canonical(item.canonical))).toBe("acknowledged")
    f.publish(root("c", "default", executor("build", "a", "high")))
    expect(selection(local)).toEqual({
      model: "c",
      variant: "default",
      executorPreference: executor("build", "a", "high"),
    })
  })

  test.each([
    [undefined, undefined],
    ["default", undefined],
    [undefined, "default"],
    ["default", "default"],
    ["removed-meta", "removed-executor"],
  ] as const)("preserves canonical raw Meta %p and executor %p efforts", (metaVariant, executorVariant) => {
    const f = fixture({ session: root("a", metaVariant, executor("build", "b", executorVariant)) })
    const { local } = f.mount()
    expect(local.model.variant.current()).toBe(metaVariant)
    expect(local.executor.model.variant.current()).toBe(executorVariant)
    expect(local.executor.preference()?.model).toMatchObject({ variant: executorVariant })
  })

  test("explicit undefined effort differs from literal default and from executor inheritance", () => {
    const f = fixture({ session: root("a", "default", executor("build", "b", "default")) })
    const { local } = f.mount()
    local.model.variant.set(undefined)
    expect(local.model.variant.current()).toBeUndefined()
    expect(local.executor.model.variant.current()).toBe("default")
    local.executor.model.variant.set(undefined)
    expect(local.executor.preference()).toEqual(executor("build", "b"))
    expect(local.executor.model.variant.current()).toBeUndefined()
    local.model.variant.set("default")
    expect(local.model.variant.current()).toBe("default")
    expect(local.executor.model.variant.current()).toBeUndefined()
    local.executor.model.variant.set("default")
    expect(local.executor.preference()).toEqual(executor("build", "b", "default"))
    local.executor.model.set(undefined)
    expect(local.executor.preference()).toEqual(executor("build"))
  })

  test("unavailable explicit models stay unavailable in their own domain", () => {
    const f = fixture({ session: root("removed", "high", executor("build", "b", "low")) })
    const { local } = f.mount()
    expect(local.model.current()).toBeUndefined()
    expect(local.executor.model.current()?.id).toBe("b")
    f.publish(root("a", "high", executor("explore", "removed", "low")), "session.executor.selected")
    expect(local.model.current()?.id).toBe("a")
    expect(local.executor.model.current()).toBeUndefined()
    expect(local.executor.preference()).toEqual(executor("explore", "removed", "low"))
  })

  test("bound drafts restore their own Meta, executor, and raw efforts", () => {
    const f = fixture({ newSession: true })
    const { local } = f.mount("draft_a")
    local.model.set(key("b"))
    local.model.variant.set("low")
    local.executor.set(executor("explore"))
    local.executor.model.set(key("c"))
    local.executor.model.variant.set("high")
    const first = selection(local)

    local.session.bindDraft("draft_b")
    expect(local.session.draftID()).toBe("draft_b")
    expect(local.model.current()?.id).toBe("a")
    expect(local.executor.preference()?.model).toBeUndefined()
    local.model.set(key("c"))
    local.model.variant.set("default")
    local.executor.set(executor("build"))
    local.executor.model.set(key("a"))
    local.executor.model.variant.set(undefined)
    const second = selection(local)

    local.session.bindDraft("draft_a")
    expect(selection(local)).toEqual(first)
    local.session.bindDraft("draft_b")
    expect(selection(local)).toEqual(second)
  })

  test("a fresh draft does not adopt the previous draft's promotion", () => {
    const f = fixture({ newSession: true })
    const { local } = f.mount("draft_a")
    local.model.set(key("b"))
    local.model.variant.set("low")
    local.executor.set(executor("explore"))
    local.executor.model.set(key("c"))
    local.executor.model.variant.set("default")
    local.session.promote(f.directory, "ses_a")
    local.session.bindDraft("draft_b")
    expect(local.session.draftID()).toBe("draft_b")
    expect(local.model.current()?.id).toBe("a")
    expect(local.model.variant.current()).toBe("high")
    expect(local.executor.preference()?.model).toBeUndefined()
    expect(local.session.choices()).toBeUndefined()
  })

  test.each(["saved", "handoff"] as const)(
    "keeps a promoted %s after remount until its captured canonical ACK",
    (transfer) => {
      const origin = fixture({ newSession: true })
      const first = origin.mount("draft_a")
      first.local.model.set(key("b"))
      first.local.model.variant.set("default")
      first.local.executor.set(executor("explore"))
      first.local.executor.model.set(key("c"))
      first.local.executor.model.variant.set(undefined)
      const target = transfer === "saved" ? origin : fixture({ empty: true })
      first.local.session.promote(target.directory, "ses_a")
      first.dispose()
      target.set("route", "id", "ses_a")

      const { local } = target.mount()
      expect(local.model.current()?.id).toBe("b")
      target.publish(root("b", "default", executor("explore", "c")), "session.executor.selected")
      expect(selection(local)).toEqual({
        model: "b",
        variant: "default",
        executorPreference: executor("explore", "c"),
      })
      const attempted = commit(local)
      const before = selection(local)
      const acknowledge = local.model.trackSessionCommit("ses_a", attempted)
      target.publish(root("c", "low", executor("build", "a", "default")))
      expect(selection(local)).toEqual(before)
      target.publish(root(attempted.model.modelID, attempted.variant, attempted.executorPreference))
      expect(
        acknowledge(canonical(root(attempted.model.modelID, attempted.variant, attempted.executorPreference))),
      ).toBe("acknowledged")
      target.publish(root("c", "low", executor("build", "a", "default")))
      expect(selection(local)).toEqual({
        model: "c",
        variant: "low",
        executorPreference: executor("build", "a", "default"),
      })
    },
  )

  test("the same draft and Session IDs stay scoped to their workspace", () => {
    const firstFixture = fixture({ newSession: true })
    const first = firstFixture.mount("draft_a")
    const secondFixture = fixture({ newSession: true })
    const second = secondFixture.mount("draft_a")
    first.local.model.set(key("b"))
    first.local.model.variant.set("low")
    first.local.executor.set(executor("explore"))
    first.local.executor.model.set(key("c"))
    second.local.model.set(key("c"))
    second.local.model.variant.set("default")
    second.local.executor.set(executor("build"))
    second.local.executor.model.set(key("a"))
    const firstSelection = selection(first.local)
    const secondSelection = selection(second.local)
    first.dispose()
    second.dispose()
    expect(selection(firstFixture.mount("draft_a").local)).toEqual(firstSelection)
    expect(selection(secondFixture.mount("draft_a").local)).toEqual(secondSelection)
  })

  test("Meta admitted selection keeper: captures separate Meta and executor references before admission", async () => {
    const initial = canonical(root("a", "high"))
    const preference = executor("explore", "c", "default")
    const selected = canonical(root("b", "high", preference), 3)
    const calls: string[] = []
    const requests: unknown[] = []
    const admitted = Promise.withResolvers<PromptBody>()
    const completed = Promise.withResolvers<void>()

    const api = client({
      baseUrl: "http://aigcfroge.local",
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init)
        const path = new URL(request.url).pathname

        if (path === "/api/session/ses_a/executor") {
          calls.push("select-executor")
          requests.push(await request.json())

          return Response.json({ data: canonical(root("a", "high", preference), 2) })
        }

        if (path === "/api/session/ses_a/model") {
          calls.push("switch-model")
          expect(await request.json()).toEqual({ model: { id: "b", providerID: "provider", variant: "high" } })

          return new Response(null, { status: 204 })
        }

        if (path === "/api/session/ses_a") {
          calls.push("get")

          return Response.json({ data: selected })
        }

        if (path === "/api/session/ses_a/prompt") {
          calls.push("prompt")
          const body: PromptBody = await request.json()
          admitted.resolve(body)

          return Response.json({
            data: {
              id: body.id,
              sessionID: initial.id,
              type: "user",
              delivery: "steer",
              payload: { text: body.text },
              time: { created: 4 },
            },
          })
        }

        throw new Error("Unexpected admission request: " + path)
      },
    })

    const setup = createRoot((dispose) => ({
      data: createData({
        api: () => api,
        directory: initial.location.directory,
        event: { on: () => () => {}, listen: () => () => {} },
      }),
      dispose,
    }))

    const data = {
      ...setup.data,
      session: {
        ...setup.data.session,
        prompt: (input: Parameters<Data["session"]["prompt"]>[0]) => {
          const result = setup.data.session.prompt(input)
          result.then(() => completed.resolve(), completed.reject)

          return result
        },
      },
    }

    try {
      setup.data.session.remember(initial)
      const f = fixture({ data, api: () => api })
      const mounted = f.mount()
      mounted.local.model.set(key("b"))
      mounted.local.model.variant.set("high")
      mounted.local.executor.set(executor("explore"))
      mounted.local.executor.model.set(key("c"))
      mounted.local.executor.model.variant.set("default")
      const failed = Promise.withResolvers<never>()
      const admission = Promise.race([admitted.promise, failed.promise])
      await submitSelection(
        mounted.controls,
        {
          id: initial.id,
          directory: initial.location.directory,
          api: api.session,
          data,
          current: () => data.session.get(initial.id),
          admitted: (id) => data.session.input.has(initial.id, id),
        },
        (_kind, error) => failed.reject(error),
        "prompt",
      )
      const request = await admission
      await completed.promise
      expect(calls).toEqual(["select-executor", "switch-model", "get", "prompt"])
      expect(requests).toEqual([preference])
      expect(request.metadata).toMatchObject({
        agent: "meta",
        model: { providerID: "provider", modelID: "b", variant: "high" },
        executorPreference: preference,
      })
    } finally {
      setup.dispose()
    }
  })

  test.each(["remembered", "older read"] as const)(
    "Meta submission keeper: refreshes a %s canonical snapshot before releasing raw effort choices",
    async (cache) => {
      const initial = canonical(root("a", undefined))
      const selected = canonical(root("a", undefined, executor("explore", "c", "default")), 2)
      const refreshed = { ...selected, time: { created: 1, updated: 3 } }
      const stale = Promise.withResolvers<Response>()
      const readStarted = Promise.withResolvers<void>()
      const modelSwitched = Promise.withResolvers<void>()
      const requests: string[] = []

      const api = client({
        baseUrl: "http://aigcfroge.local",
        fetch: async (input, init) => {
          const request = input instanceof Request ? input : new Request(input, init)
          const path = new URL(request.url).pathname

          if (path === "/api/session/ses_a/executor") {
            requests.push("executor")

            return Response.json({ data: selected })
          }

          if (path === "/api/session/ses_a/model") {
            requests.push("model")
            modelSwitched.resolve()

            return new Response(null, { status: 204 })
          }

          if (path === "/api/session/ses_a") {
            requests.push("get")

            if (cache === "older read" && requests.length === 1) {
              readStarted.resolve()

              return stale.promise
            }

            return Response.json({ data: refreshed })
          }

          throw new Error("Unexpected submission request: " + path)
        },
      })

      const setup = createRoot((dispose) => ({
        data: createData({
          api: () => api,
          directory: initial.location.directory,
          event: { on: () => () => {}, listen: () => () => {} },
        }),
        dispose,
      }))

      try {
        setup.data.session.remember(initial)

        const older =
          cache === "older read"
            ? (() => {
                setup.data.session.invalidate(initial.id)

                return setup.data.session.sync(initial.id)
              })()
            : Promise.resolve()

        if (cache === "older read") await readStarted.promise
        const f = fixture({ data: setup.data, api: () => api })
        const mounted = f.mount()
        mounted.local.model.variant.set("default")
        mounted.local.executor.set(executor("explore"))
        mounted.local.executor.model.set(key("c"))
        mounted.local.executor.model.variant.set("default")

        const submitting = submitSelection(mounted.controls, {
          id: initial.id,
          directory: initial.location.directory,
          api: api.session,
          data: setup.data,
          current: () => setup.data.session.get(initial.id),
          admitted: (id) => setup.data.session.input.has(initial.id, id),
        })

        await modelSwitched.promise
        stale.resolve(Response.json({ data: initial }))
        await Promise.all([older, submitting])
        expect(requests).toEqual(
          cache === "older read" ? ["get", "executor", "model", "get"] : ["executor", "model", "get"],
        )
        expect(setup.data.session.get(initial.id)?.time.updated).toBe(3)
        expect(selection(mounted.local)).toEqual({
          model: "a",
          variant: undefined,
          executorPreference: executor("explore", "c", "default"),
        })
        setup.data.session.remember(canonical(root("c", "low", executor("build", "b", "high")), 4))
        expect(selection(mounted.local)).toEqual({
          model: "c",
          variant: "low",
          executorPreference: executor("build", "b", "high"),
        })
      } finally {
        stale.resolve(Response.json({ data: initial }))
        setup.dispose()
      }
    },
  )

  test.each(["model", "raw effort"] as const)(
    "Meta submission keeper: an invalidated same-API %s read retains the pending selection",
    async (change) => {
      const initial = canonical(root("a", undefined))
      const selected = canonical(root(change === "model" ? "b" : "a", change === "model" ? "low" : undefined), 2)
      const response = Promise.withResolvers<Response>()
      const started = Promise.withResolvers<void>()
      const requests: string[] = []

      const api = client({
        baseUrl: "http://aigcfroge.local",
        fetch: async (input, init) => {
          const request = input instanceof Request ? input : new Request(input, init)
          const path = new URL(request.url).pathname

          if (path === "/api/session/ses_a/model") {
            requests.push("model")

            return new Response(null, { status: 204 })
          }

          if (path === "/api/session/ses_a") {
            requests.push("get")

            if (requests.filter((item) => item === "get").length === 1) {
              started.resolve()

              return response.promise
            }

            return Response.json({ data: selected })
          }

          throw new Error("Unexpected same-owner submission request: " + path)
        },
      })

      const setup = createRoot((dispose) => ({
        data: createData({
          api: () => api,
          directory: initial.location.directory,
          event: { on: () => () => {}, listen: () => () => {} },
        }),
        dispose,
      }))

      try {
        setup.data.session.remember(initial)
        const f = fixture({ data: setup.data, api: () => api })
        const mounted = f.mount()
        mounted.local.model.set(key(change === "model" ? "b" : "a"))
        mounted.local.model.variant.set(change === "model" ? "low" : "default")
        const attempted = selection(mounted.local)
        const errors: unknown[] = []

        const session = {
          id: initial.id,
          directory: initial.location.directory,
          api: api.session,
          data: setup.data,
          current: () => setup.data.session.get(initial.id),
          admitted: (id) => setup.data.session.input.has(initial.id, id),
        } satisfies ComposerSession

        const submitting = submitSelection(mounted.controls, session, (_kind, error) => errors.push(error))
        await started.promise
        expect(f.sdk.api).toBe(api)
        setup.data.session.invalidate(initial.id)
        response.resolve(Response.json({ data: selected }))
        await submitting
        expect(f.sdk.api).toBe(api)
        expect(requests).toEqual(["model", "get"])
        expect(setup.data.session.get(initial.id)).toEqual(initial)
        expect(selection(mounted.local)).toEqual(attempted)
        expect(errors).toEqual([new SelectionReadbackError({ reason: "unadopted" })])

        await submitSelection(mounted.controls, session, (_kind, error) => errors.push(error))
        expect(requests).toEqual(["model", "get", "model", "get"])
        expect(setup.data.session.get(initial.id)).toEqual(selected)
        expect(errors).toHaveLength(1)
        const selectedModel = selected.model && !("type" in selected.model) ? selected.model : undefined
        expect(selection(mounted.local)).toEqual({
          model: selectedModel?.id,
          variant: selectedModel?.variant,
          executorPreference: selected.executorPreference,
        })
        setup.data.session.remember(canonical(root("c", "default", executor("explore", "a", "high")), 3))
        expect(selection(mounted.local)).toEqual({
          model: "c",
          variant: "default",
          executorPreference: executor("explore", "a", "high"),
        })
      } finally {
        response.resolve(Response.json({ data: selected }))
        setup.dispose()
      }
    },
  )

  test.each([
    ["Meta mismatch", false],
    ["executor mismatch", false],
    ["Meta publication drift", false],
    ["executor publication drift", false],
    ["Meta mismatch", true],
    ["executor mismatch", true],
    ["Meta publication drift", true],
    ["executor publication drift", true],
  ] as const)("Meta submission keeper: %s cannot acknowledge or submit (later edit: %s)", async (mode, laterEdit) => {
    const initial = canonical(root("a", "high"))
    const requested = root("b", "default")

    const readback = canonical(
      Match.value(mode).pipe(
        Match.when("Meta mismatch", () => root("c", "high")),
        Match.when("executor mismatch", () => root("b", "default", executor("explore", "c", "high"))),
        Match.orElse(() => requested),
      ),
      2,
    )

    const started = Promise.withResolvers<void>()
    const response = Promise.withResolvers<Response>()
    const requests: string[] = []
    const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
    const state = { observed: false, executions: 0 }

    const api = client({
      baseUrl: "http://aigcfroge.local",
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init)
        const path = new URL(request.url).pathname

        if (path === "/api/session/ses_a/model") {
          expect(await request.json()).toEqual({ model: { id: "b", providerID: "provider", variant: "default" } })
          requests.push("model")

          return new Response(null, { status: 204 })
        }

        if (path === "/api/session/ses_a") {
          requests.push("get")
          started.resolve()

          return response.promise
        }

        throw new Error("Unexpected canonical confirmation request: " + path)
      },
    })

    const setup = createRoot((dispose) => ({
      data: createData({
        api: () => api,
        directory: initial.location.directory,
        event: {
          on: () => () => {},
          listen(handler) {
            listeners.add(handler)

            return () => listeners.delete(handler)
          },
        },
      }),
      dispose,
    }))

    const observer = createRoot((dispose) => {
      createComputed(() => {
        if (
          !mode.endsWith("publication drift") ||
          state.observed ||
          setup.data.session.get(initial.id)?.time.updated !== 2
        )
          return
        state.observed = true

        const details =
          mode === "Meta publication drift"
            ? {
                id: "evt_confirmation_meta",
                type: "session.model.selected" as const,
                created: 3,
                durable: { aggregateID: initial.id, seq: 1, version: 1 as const },
                data: { sessionID: initial.id, model: { id: "c", providerID: "provider", variant: "high" } },
              }
            : {
                id: "evt_confirmation_executor",
                type: "session.executor.selected" as const,
                created: 3,
                durable: { aggregateID: initial.id, seq: 1, version: 1 as const },
                data: { sessionID: initial.id, executorPreference: executor("explore", "c", "high") },
              }

        listeners.forEach((handler) => handler({ name: details.type, details }))
      })

      return dispose
    })

    try {
      setup.data.session.remember(initial)
      const f = fixture({ data: setup.data, api: () => api })
      const mounted = f.mount()
      mounted.local.model.set(key("b"))
      mounted.local.model.variant.set("default")
      const errors: unknown[] = []

      const submitting = submitSelection(
        mounted.controls,
        {
          id: initial.id,
          directory: initial.location.directory,
          api: api.session,
          data: setup.data,
          current: () => setup.data.session.get(initial.id),
          admitted: (id) => setup.data.session.input.has(initial.id, id),
        },
        (_kind, error) => errors.push(error),
        () => {
          state.executions++
        },
      )

      await started.promise

      if (laterEdit) mounted.local.model.variant.set("low")
      const attempted = selection(mounted.local)
      response.resolve(Response.json({ data: readback }))
      await submitting
      expect(state.observed).toBe(mode.endsWith("publication drift"))
      expect(requests).toEqual(["model", "get"])
      expect(state.executions).toBe(0)
      expect(errors).toEqual([new SelectionReadbackError({ reason: "mismatch" })])
      expect(selection(mounted.local)).toEqual(attempted)
    } finally {
      response.resolve(Response.json({ data: readback }))
      observer()
      setup.dispose()
    }
  })

  test.each(["success", "failure"] as const)(
    "Meta submission keeper: pre-ACK same-API equality cannot release a %s attempt",
    async (settlement) => {
      const initial = canonical(root("a", "default"))
      const selected = canonical(root("a", "default"), 4)
      const later = canonical(root("b", "high", executor("explore", "c", "low")), 5)
      const response = Promise.withResolvers<Response>()
      const started = Promise.withResolvers<void>()
      const requests: string[] = []

      const api = client({
        baseUrl: "http://aigcfroge.local",
        fetch: async (input, init) => {
          const request = input instanceof Request ? input : new Request(input, init)
          const path = new URL(request.url).pathname

          if (path === "/api/session/ses_a/model") {
            requests.push("model")
            started.resolve()

            return response.promise
          }

          if (path === "/api/session/ses_a") {
            requests.push("get")

            return Response.json({ data: selected })
          }

          throw new Error("Unexpected pre-ACK submission request: " + path)
        },
      })

      const setup = createRoot((dispose) => ({
        data: createData({
          api: () => api,
          directory: initial.location.directory,
          event: { on: () => () => {}, listen: () => () => {} },
        }),
        dispose,
      }))

      try {
        setup.data.session.remember(initial)
        const f = fixture({ data: setup.data, api: () => api })
        const mounted = f.mount()
        mounted.local.model.variant.set("default")
        const attempted = selection(mounted.local)
        const errors: unknown[] = []

        const submitting = submitSelection(
          mounted.controls,
          {
            id: initial.id,
            directory: initial.location.directory,
            api: api.session,
            data: setup.data,
            current: () => setup.data.session.get(initial.id),
            admitted: (id) => setup.data.session.input.has(initial.id, id),
          },
          (_kind, error) => errors.push(error),
        )

        await started.promise
        expect(f.sdk.api).toBe(api)
        setup.data.session.remember(canonical(root("a", "default"), 2))
        f.publish(root("a", "default"))
        setup.data.session.remember(canonical(root("c", "low", executor("explore", "b", "high")), 3))
        f.publish(root("c", "low", executor("explore", "b", "high")), "session.executor.selected")
        expect(requests).toEqual(["model"])
        expect(selection(mounted.local)).toEqual(attempted)

        if (settlement === "success") response.resolve(new Response(null, { status: 204 }))

        if (settlement === "failure") response.reject(new TypeError("Connection closed before model ACK"))
        await submitting
        expect(requests).toEqual(settlement === "success" ? ["model", "get"] : ["model"])
        expect(errors).toHaveLength(settlement === "success" ? 0 : 1)
        setup.data.session.remember(later)
        expect(selection(mounted.local)).toEqual(
          settlement === "success"
            ? {
                model: "b",
                variant: "high",
                executorPreference: executor("explore", "c", "low"),
              }
            : attempted,
        )
        mounted.dispose()
        flushPersisted()
        expect(selection(f.mount().local)).toEqual(
          settlement === "success"
            ? {
                model: "b",
                variant: "high",
                executorPreference: executor("explore", "c", "low"),
              }
            : attempted,
        )
      } finally {
        response.resolve(new Response(null, { status: 204 }))
        setup.dispose()
      }
    },
  )

  test.each(["read", "failure"] as const)(
    "Meta submission keeper: an older API's %s cannot release the current Meta/executor draft",
    async (settlement) => {
      const initial = canonical(root("a", undefined))
      const response = Promise.withResolvers<Response>()
      const started = Promise.withResolvers<void>()
      const replacementRequests: string[] = []

      const owner = client({
        baseUrl: "http://aigcfroge.local",
        fetch: async (input, init) => {
          const request = input instanceof Request ? input : new Request(input, init)
          const path = new URL(request.url).pathname

          if (path === "/api/session/ses_a/model" && settlement === "read") return new Response(null, { status: 204 })

          if (path === "/api/session/ses_a/model" || path === "/api/session/ses_a") {
            started.resolve()

            return response.promise
          }

          throw new Error("Unexpected old-owner request: " + path)
        },
      })

      const replacement = client({
        baseUrl: "http://replacement.local",
        fetch: async (input, init) => {
          const request = input instanceof Request ? input : new Request(input, init)
          replacementRequests.push(request.url)
          throw new Error("Unexpected replacement-owner request")
        },
      })

      const api = { current: owner }

      const setup = createRoot((dispose) => ({
        data: createData({
          api: () => api.current,
          directory: initial.location.directory,
          event: { on: () => () => {}, listen: () => () => {} },
        }),
        dispose,
      }))

      try {
        setup.data.session.remember(initial)

        if (settlement === "read") setup.data.session.invalidate(initial.id)
        const f = fixture({ data: setup.data, api: () => api.current })
        const mounted = f.mount()
        mounted.local.model.variant.set("default")
        const attempted = selection(mounted.local)
        const errors: unknown[] = []

        const submitting = submitSelection(
          mounted.controls,
          {
            id: initial.id,
            directory: initial.location.directory,
            api: owner.session,
            data: setup.data,
            current: () => setup.data.session.get(initial.id),
            admitted: (id) => setup.data.session.input.has(initial.id, id),
          },
          (_kind, error) => errors.push(error),
        )

        await started.promise
        api.current = replacement

        if (settlement === "read") response.resolve(Response.json({ data: canonical(root("c", "high"), 2) }))

        if (settlement === "failure") response.reject(new TypeError("Connection closed"))
        await submitting
        expect(replacementRequests).toEqual([])
        expect(setup.data.session.get(initial.id)?.time.updated).toBe(1)
        expect(selection(mounted.local)).toEqual(attempted)
        expect(errors).toEqual([])
        mounted.dispose()
        flushPersisted()
        expect(selection(f.mount().local)).toEqual(attempted)
      } finally {
        response.resolve(new Response(null, { status: 204 }))
        setup.dispose()
      }
    },
  )

  test("an older API's acknowledgement cannot release the retained current draft", () => {
    const f = fixture()
    const { local } = f.mount()
    local.model.set(key("b"))
    local.model.variant.set("default")
    local.executor.set(executor("explore"))
    local.executor.model.set(key("c"))
    local.executor.model.variant.set("low")
    const attempted = commit(local)
    const before = selection(local)
    const release = local.model.trackSessionCommit("ses_a", attempted)
    f.transport.api = { ...f.transport.api }
    f.publish(
      root(attempted.model.modelID, attempted.variant, attempted.executorPreference),
      "session.executor.selected",
    )
    release()
    f.publish(root("c", "high", executor("build", "a", "default")))
    expect(selection(local)).toEqual(before)
  })

  test("an owned Meta failure retires its attempt and preserves the Meta/executor draft", () => {
    const f = fixture()
    const { local } = f.mount()
    local.model.set(key("c"))
    local.model.variant.set("default")
    local.executor.set(executor("explore"))
    local.executor.model.set(key("a"))
    local.executor.model.variant.set("high")
    const attempted = commit(local)
    const before = selection(local)
    const cancel = local.model.trackSessionCommit("ses_a", attempted)
    cancel()
    expect(selection(local)).toEqual(before)
    f.publish(root(attempted.model.modelID, attempted.variant, attempted.executorPreference))
    f.publish(root("b", "low", executor("explore", "c", "default")))
    expect(selection(local)).toEqual(before)
    const acknowledge = local.model.trackSessionCommit("ses_a", attempted)
    f.publish(root(attempted.model.modelID, attempted.variant, attempted.executorPreference))
    expect(acknowledge(canonical(root(attempted.model.modelID, attempted.variant, attempted.executorPreference)))).toBe(
      "acknowledged",
    )
    f.publish(root("b", "low", executor("explore", "c", "default")))
    expect(selection(local)).toEqual({
      model: "b",
      variant: "low",
      executorPreference: executor("explore", "c", "default"),
    })
  })

  test.each(["failure", "success"] as const)(
    "an older same-owner %s cannot retire a newer identical Meta attempt",
    (settlement) => {
      const f = fixture()
      const { local } = f.mount()
      local.model.set(key("b"))
      local.model.variant.set("low")
      const attempted = commit(local)
      const before = selection(local)
      const older = local.model.trackSessionCommit("ses_a", attempted)
      const acknowledge = local.model.trackSessionCommit("ses_a", commit(local))

      if (settlement === "failure") older()

      if (settlement === "success")
        older(canonical(root(attempted.model.modelID, attempted.variant, attempted.executorPreference)))
      f.publish(root(attempted.model.modelID, attempted.variant, attempted.executorPreference))
      f.publish(root("c", "high", executor("explore", "a", "default")))
      expect(selection(local)).toEqual(before)
      f.publish(root(attempted.model.modelID, attempted.variant, attempted.executorPreference))
      expect(
        acknowledge(canonical(root(attempted.model.modelID, attempted.variant, attempted.executorPreference))),
      ).toBe("acknowledged")
      f.publish(root("c", "high", executor("explore", "a", "default")))
      expect(selection(local)).toEqual({
        model: "c",
        variant: "high",
        executorPreference: executor("explore", "a", "default"),
      })
    },
  )

  test("a late failure preserves a newer executor choice with the same Meta selection", () => {
    const f = fixture()
    const { local } = f.mount()
    local.model.set(key("b"))
    local.model.variant.set("high")
    local.executor.set(executor("explore"))
    local.executor.model.set(key("c"))
    local.executor.model.variant.set("low")
    const cancel = local.model.trackSessionCommit("ses_a", commit(local))

    local.executor.set(executor("build"))
    local.executor.model.set(key("c"))
    local.executor.model.variant.set("default")
    const newer = selection(local)
    cancel()
    f.publish(root("b", "high", executor("explore", "c", "low")))
    expect(selection(local)).toEqual(newer)
    const acknowledge = local.model.trackSessionCommit("ses_a", commit(local))
    f.publish(root("b", "high", executor("build", "c", "default")), "session.executor.selected")
    acknowledge(canonical(root("b", "high", executor("build", "c", "default"))))
    f.publish(root("c", "low", executor("explore", "a")))
    expect(selection(local)).toEqual({
      model: "c",
      variant: "low",
      executorPreference: executor("explore", "a"),
    })
  })

  test("a disposed provider's late failure cannot erase a remounted draft", () => {
    const f = fixture()
    const first = f.mount()
    first.local.model.set(key("b"))
    first.local.model.variant.set("high")
    first.local.executor.set(executor("explore"))
    first.local.executor.model.set(key("c"))
    first.local.executor.model.variant.set("low")
    const cancel = first.local.model.trackSessionCommit("ses_a", commit(first.local))
    first.dispose()

    const second = f.mount()
    second.local.model.set(key("c"))
    second.local.model.variant.set("default")
    second.local.executor.set(executor("build"))
    second.local.executor.model.set(key("a"))
    second.local.executor.model.variant.set(undefined)
    const newer = selection(second.local)
    second.dispose()
    cancel()
    flushPersisted()

    expect(selection(f.mount().local)).toEqual(newer)
  })
}
