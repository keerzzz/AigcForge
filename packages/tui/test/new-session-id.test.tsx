import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import type { SessionCreateInput, SessionInfo } from "@omnixa/client/promise"
import { createAppFixture } from "./fixture/app"
import { json } from "./fixture/tui-client"
import { Cause, Effect, Exit } from "effect"
import path from "node:path"
import { access } from "node:fs/promises"
import type { TuiInput } from "../src/app"
import type { LogLevel, LogTags } from "../src/context/log"
import { StorageLifecycle } from "./fixture/storage-lifecycle"
import { tmpdir } from "./fixture/fixture"
import { it, awaitWithTimeout } from "../../core/test/lib/effect"

type SessionInput = { id?: string; location?: { directory: string } }

const location = {
  directory: "/tmp/omnixa/packages/tui",
  project: { id: "project", directory: "/tmp/omnixa", canonical: "/tmp/omnixa" },
}

function sessionInfo(record: SessionInput) {
  return {
    ...record,
    location: record.location ?? { directory: location.directory },
    projectID: "project",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
}

async function launch(options: { failCreates?: number; state?: string; log?: TuiInput["log"] } = {}) {
  const attempts: (string | undefined)[] = []
  const created: SessionInput[] = []
  const prompts: string[] = []
  let failures = options.failCreates ?? 0
  const setup = await createAppFixture({
    args: { newSessionID: "ses_chosen" },
    state: options.state,
    log: options.log,
    config: { animations: false, keybinds: { "session.new": "f6" } },
    fetch: async (url, request) => {
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "all", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
      if (url.pathname === "/api/session" && request.method === "POST") {
        const record: SessionInput = await request.json()
        attempts.push(record.id)
        if (failures > 0) {
          failures--
          return json({ message: "create failed" }, { status: 500 })
        }
        const canonical = {
          ...record,
          agent: "meta",
          model: { providerID: "demo", id: "model" },
          executorPreference: { agent: "build" },
          controller: { kind: "root", metaAgentID: "mag_launch_" + (created.length + 1), rootSessionID: record.id },
        }
        created.push(canonical)
        return json({ data: sessionInfo(canonical) })
      }
      if (/^\/api\/session\/[^/]+\/prompt$/.test(url.pathname)) {
        prompts.push(url.pathname.split("/")[3] ?? "")
        return json({ data: {} })
      }
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (/^\/api\/session\/[^/]+\/(agent|model)$/.test(url.pathname)) return new Response(null, { status: 204 })
      if (/^\/api\/session\/[^/]+$/.test(url.pathname)) {
        const record = created.find((item) => item.id === url.pathname.split("/")[3])
        if (!record) return json({ message: "not found" }, { status: 404 })
        return json({ data: sessionInfo(record) })
      }
      return undefined
    },
  })
  return { setup, attempts, created, prompts }
}

test("the first new session uses the launch session ID and later ones mint their own", async () => {
  const run = await launch()
  await using setup = run.setup

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Demo Model"))
  await setup.mockInput.typeText("hello")
  setup.mockInput.pressEnter()
  await setup.waitForFrame(() => run.prompts.length === 1)
  expect(run.prompts[0]).toBe("ses_chosen")
  expect(run.created.map((item) => item.id)).toEqual(["ses_chosen"])

  setup.mockInput.pressKey("F6")
  await setup.renderOnce()
  await setup.mockInput.typeText("again")
  setup.mockInput.pressEnter()
  await setup.waitForFrame(() => run.created.length === 2)
  expect(run.created[1]?.id).toMatch(/^ses/)
  expect(run.created[1]?.id).not.toBe("ses_chosen")
})

test("a failed first create keeps the launch session ID for the retry", async () => {
  const run = await launch({ failCreates: 1 })
  await using setup = run.setup

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Demo Model"))
  await setup.mockInput.typeText("hello")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Creating a session failed") && frame.includes("hello"))
  expect(run.attempts).toEqual(["ses_chosen"])

  setup.mockInput.pressEnter()
  await setup.waitForFrame(() => run.created.length === 1)
  expect(run.attempts).toEqual(["ses_chosen", "ses_chosen"])
})

test("ordinary TUI creates Meta sessions with delegation preferences and consumes the launch ID once", async () => {
  const metaModel = { providerID: "demo", id: "meta", variant: "default" }
  const build = { agent: "build", model: { providerID: "demo", id: "build", variant: "low" } }
  const explore = { agent: "explore", model: { providerID: "demo", id: "explore", variant: "high" } }
  const attempts: SessionCreateInput[] = []
  const created: SessionInfo[] = []
  const prompts: string[] = []
  const selectionMutations: string[] = []
  await using setup = await createAppFixture({
    args: { newSessionID: "ses_chosen" },
    config: {
      animations: false,
      keybinds: { "session.new": "f6", "agent.list": "f10", "variant.list": "f9" },
    },
    fetch: async (url, request) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/agent")
        return json({
          location,
          data: [
            {
              id: "build",
              mode: "all",
              hidden: false,
              permissions: [],
              model: { providerID: "demo", id: "build", variant: "high" },
            },
            {
              id: "meta",
              mode: "primary",
              hidden: false,
              permissions: [],
              model: { providerID: "demo", id: "meta", variant: "high" },
            },
            { id: "plan", mode: "primary", hidden: false, permissions: [] },
            {
              id: "explore",
              mode: "subagent",
              hidden: false,
              permissions: [],
              model: { providerID: "demo", id: "explore", variant: "low" },
            },
          ],
        })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: ["meta", "build", "explore"].map((id) => ({
            id,
            providerID: "demo",
            name: id + " model",
            variants: [{ id: "default" }, { id: "low" }, { id: "high" }],
            cost: [],
            time: { released: 0 },
          })),
        })
      if (url.pathname === "/api/session" && request.method === "POST") {
        const record: SessionCreateInput = await request.json()
        attempts.push(record)
        if (typeof record.id !== "string") throw new Error("The ordinary TUI must propose its session ID")
        expect(record.id).toMatch(/^ses/)
        if (created.length === 0) expect(record.id).toBe("ses_chosen")
        if (created.length === 1) expect(record.id).not.toBe("ses_chosen")
        expect(record).toEqual({
          id: record.id,
          location: { directory: location.directory },
          agent: "meta",
          model: metaModel,
          executorPreference: created.length === 0 ? build : explore,
        })
        // Predetermined canonical facts follow the request assertions.
        const info: SessionInfo = {
          ...sessionInfo({ id: record.id }),
          id: record.id,
          title: "Meta creation " + (created.length + 1),
          agent: "meta",
          model: metaModel,
          executorPreference: created.length === 0 ? build : explore,
          controller: { kind: "root", metaAgentID: "mag_creation_" + (created.length + 1), rootSessionID: record.id },
        }
        created.push(info)
        return json({ data: info })
      }
      if (/^\/api\/session\/[^/]+\/prompt$/.test(url.pathname)) {
        prompts.push(url.pathname.split("/")[3] ?? "")
        return json({ data: {} })
      }
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (/^\/api\/session\/[^/]+\/(agent|executor|model)$/.test(url.pathname)) {
        selectionMutations.push(url.pathname)
        throw new Error("Creation must adopt its canonical response before sending the prompt")
      }
      if (/^\/api\/session\/[^/]+$/.test(url.pathname)) {
        const info = created.find((item) => item.id === url.pathname.split("/")[3])
        return info ? json({ data: info }) : json({ message: "not found" }, { status: 404 })
      }
      return undefined
    },
  })

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Build · build model Demo · high"))
  setup.mockInput.pressKey("F10")
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Select agent") &&
      frame.includes("meta") &&
      frame.includes("plan") &&
      setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  await setup.mockInput.typeText("meta")
  await setup.renderOnce()
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Meta · meta model Demo · high") &&
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
    (frame) => frame.includes("Select executor") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  await setup.mockInput.typeText("build")
  await setup.renderOnce()
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Select executor model") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  await setup.mockInput.typeText("build")
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
      frame.includes("Meta · meta model Demo · high") &&
      setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )

  // Read the saved executor marker without selecting another sorted model.
  setup.mockInput.pressKey("F10")
  await setup.waitForFrame(
    (frame) => frame.includes("Select agent") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  setup.mockInput.pressTab()
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Select executor") &&
      frame.split("\n").some((line) => /●\s+build(?:\s|$)/.test(line)) &&
      setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  setup.mockInput.pressEscape()
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Meta · meta model Demo · high") &&
      setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )

  // F9 uses the unchanged direct app entry; the unfiltered second row is the literal catalog ID.
  setup.mockInput.pressKey("F9")
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Default") &&
      frame.includes("default") &&
      setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  setup.mockInput.pressKey("HOME")
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Meta · meta model Demo · default") &&
      setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )
  await setup.mockInput.typeText("hello")
  setup.mockInput.pressEnter()
  await setup.waitForFrame(() => created.length === 1 && prompts.length === 1)
  expect(prompts).toEqual(["ses_chosen"])
  expect(created[0]?.controller).toEqual({ kind: "root", metaAgentID: "mag_creation_1", rootSessionID: "ses_chosen" })
  await setup.waitForFrame((frame) => frame.includes("Meta · meta model Demo · default"))

  setup.mockInput.pressKey("F6")
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Meta · meta model Demo · default") &&
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
    (frame) => frame.includes("Select executor") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  await setup.mockInput.typeText("explore")
  await setup.renderOnce()
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Select executor model") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  await setup.mockInput.typeText("explore")
  await setup.renderOnce()
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) => frame.includes("Select variant") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  await setup.mockInput.typeText("high")
  await setup.renderOnce()
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Meta · meta model Demo · default") &&
      setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )

  setup.mockInput.pressKey("F10")
  await setup.waitForFrame(
    (frame) => frame.includes("Select agent") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  setup.mockInput.pressTab()
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Select executor") &&
      frame.split("\n").some((line) => /●\s+explore(?:\s|$)/.test(line)) &&
      setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  setup.mockInput.pressEscape()
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Meta · meta model Demo · default") &&
      setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )
  await setup.mockInput.typeText("again")
  setup.mockInput.pressEnter()
  await setup.waitForFrame(() => created.length === 2 && prompts.length === 2)
  expect(created[1]?.id).toMatch(/^ses/)
  expect(created[1]?.id).not.toBe("ses_chosen")
  expect(attempts.filter((item) => item.id === "ses_chosen")).toHaveLength(1)
  expect(prompts).toEqual(created.map((item) => item.id))
  expect(created.map((item) => item.model)).toEqual([metaModel, metaModel])
  expect(created.map((item) => item.executorPreference)).toEqual([build, explore])
  expect(created[1]?.controller).toEqual({
    kind: "root",
    metaAgentID: "mag_creation_2",
    rootSessionID: created[1]?.id,
  })
  expect(selectionMutations).toEqual([])
  await setup.waitForFrame((frame) => frame.includes("Meta · meta model Demo · default"))
})

it.live("real Tui.run finishes tab persistence and lease release before fixture disposal", () =>
  Effect.gen(function* () {
    const temporary = yield* Effect.acquireRelease(Effect.promise(tmpdir), (value) =>
      Effect.promise(() => value[Symbol.asyncDispose]()),
    )
    const logs: { level: LogLevel; message: string; tags: LogTags }[] = []
    const run = yield* Effect.acquireRelease(
      Effect.promise(() => launch({ state: temporary.path, log: StorageLifecycle.captureLog(logs) })),
      (value) => Effect.promise(() => value.setup[Symbol.asyncDispose]()),
    )
    yield* awaitWithTimeout(
      Effect.promise(() => run.setup.ready),
      "real Tui.run did not become ready",
    )
    yield* Effect.promise(() => run.setup.waitForFrame((frame) => frame.includes("Demo Model")))
    const file = path.join(temporary.path, "test", "tui", "tabs.json")
    const lock = yield* StorageLifecycle.holdLock(file, path.join(temporary.path, "test", "locks"))
    try {
      yield* Effect.promise(() => run.setup.mockInput.typeText("persist before stop"))
      run.setup.mockInput.pressEnter()
      yield* Effect.promise(() => run.setup.waitForFrame(() => run.prompts.length === 1))
      const disposal = run.setup[Symbol.asyncDispose]()
      expect(run.setup[Symbol.asyncDispose]()).toBe(disposal)
      yield* lock.release
      yield* lock.done
      yield* awaitWithTimeout(
        Effect.promise(() => disposal),
        "real Tui.run did not finish storage shutdown",
        "5 seconds",
      )
      const saved: unknown = yield* Effect.promise(() => Bun.file(file).json())
      expect(JSON.stringify(saved)).toContain('"sessionID":"ses_chosen"')
      expect(logs.filter((entry) => entry.level === "error")).toEqual([])
      yield* Effect.promise(async () => {
        await expect(access(run.setup.directory)).rejects.toMatchObject({ code: "ENOENT" })
      })
    } finally {
      yield* lock.release
      yield* lock.done
      yield* Effect.promise(() => run.setup[Symbol.asyncDispose]())
    }
  }),
)

it.live("a renderer destroy listener failure still waits for real tab writes before fixture cleanup", () =>
  Effect.gen(function* () {
    const temporary = yield* Effect.acquireRelease(Effect.promise(tmpdir), (value) =>
      Effect.promise(() => value[Symbol.asyncDispose]()),
    )
    const failure = new Error("renderer destroy listener failed")
    const run = yield* Effect.acquireRelease(
      Effect.promise(() => launch({ state: temporary.path })),
      (value) =>
        Effect.promise(async () => {
          await expect(value.setup[Symbol.asyncDispose]()).rejects.toBe(failure)
        }),
    )
    yield* awaitWithTimeout(
      Effect.promise(() => run.setup.ready),
      "destroy fixture did not become ready",
    )
    yield* Effect.promise(() => run.setup.waitForFrame((frame) => frame.includes("Demo Model")))
    const file = path.join(temporary.path, "test", "tui", "tabs.json")
    const lock = yield* StorageLifecycle.holdLock(file, path.join(temporary.path, "test", "locks"))
    const entered = Promise.withResolvers<void>()
    let settled = false
    try {
      yield* Effect.promise(() => run.setup.mockInput.typeText("persist through destroy failure"))
      run.setup.mockInput.pressEnter()
      yield* Effect.promise(() => run.setup.waitForFrame(() => run.prompts.length === 1))
      run.setup.renderer.once("destroy", () => {
        entered.resolve()
        throw failure
      })
      const disposal = run.setup[Symbol.asyncDispose]()
      const result = disposal
        .then(
          () => undefined,
          (error: unknown) => error,
        )
        .finally(() => {
          settled = true
        })
      expect(run.setup[Symbol.asyncDispose]()).toBe(disposal)
      yield* awaitWithTimeout(
        Effect.promise(() => entered.promise),
        "real renderer destroy listener did not run",
      )
      yield* Effect.promise(() => access(run.setup.directory))
      expect(settled).toBe(false)
      expect(
        yield* Effect.promise(() =>
          fetch(new URL("/api/info", run.setup.server.url)).then((response) => response.status),
        ),
      ).toBe(200)
      yield* lock.release
      yield* lock.done
      expect(
        yield* awaitWithTimeout(
          Effect.promise(() => result),
          "destroy failure did not finish its task barrier",
        ),
      ).toBe(failure)
      expect(run.setup[Symbol.asyncDispose]()).toBe(disposal)
      expect(Exit.isSuccess(yield* Effect.promise(() => run.setup.exit))).toBe(true)
      expect(JSON.stringify(yield* Effect.promise(() => Bun.file(file).json()))).toContain('"sessionID":"ses_chosen"')
      yield* Effect.promise(async () => {
        await expect(access(run.setup.directory)).rejects.toMatchObject({ code: "ENOENT" })
        await expect(fetch(new URL("/api/info", run.setup.server.url))).rejects.toThrow()
      })
    } finally {
      yield* lock.release
      yield* lock.done
    }
  }),
)

it.live("real Tui.run retains its epilogue and full Scope failure when renderer cleanup fails", () =>
  Effect.gen(function* () {
    const temporary = yield* Effect.acquireRelease(Effect.promise(tmpdir), (value) =>
      Effect.promise(() => value[Symbol.asyncDispose]()),
    )
    const output = yield* StorageLifecycle.captureOutput()
    const failure = new Error("renderer title cleanup failed")
    const run = yield* Effect.acquireRelease(
      Effect.promise(() => launch({ state: temporary.path })),
      (value) =>
        Effect.promise(async () => {
          await expect(value.setup[Symbol.asyncDispose]()).rejects.toBe(failure)
        }),
    )
    yield* awaitWithTimeout(
      Effect.promise(() => run.setup.ready),
      "output fixture did not become ready",
    )
    yield* Effect.promise(() => run.setup.waitForFrame((frame) => frame.includes("Demo Model")))
    yield* Effect.promise(() => run.setup.mockInput.typeText("finish before cleanup fails"))
    run.setup.mockInput.pressEnter()
    yield* Effect.promise(() => run.setup.waitForFrame(() => run.prompts.length === 1))
    const setTitle = run.setup.renderer.setTerminalTitle.bind(run.setup.renderer)
    run.setup.renderer.setTerminalTitle = (title) => {
      if (title === "") throw failure
      setTitle(title)
    }
    const disposal = run.setup[Symbol.asyncDispose]()
    const rejected = disposal.then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(
      yield* awaitWithTimeout(
        Effect.promise(() => rejected),
        "output fixture did not finish",
      ),
    ).toBe(failure)
    const exit = yield* Effect.promise(() => run.setup.exit)
    expect(Exit.hasDies(exit)).toBe(true)
    if (Exit.isSuccess(exit)) return yield* Effect.die(new Error("App cleanup failure became success"))
    expect(exit.cause.reasons.some((reason) => reason._tag === "Die" && reason.defect === failure)).toBe(true)
    expect(output.join("")).toContain("omnixa -s ses_chosen")
    expect(run.setup[Symbol.asyncDispose]()).toBe(disposal)
    yield* Effect.promise(async () => {
      await expect(access(run.setup.directory)).rejects.toMatchObject({ code: "ENOENT" })
    })
  }),
)

it.live("a destroy listener before the shutdown event cancels and joins the existing run after its pending write", () =>
  Effect.gen(function* () {
    const temporary = yield* Effect.acquireRelease(Effect.promise(tmpdir), (value) =>
      Effect.promise(() => value[Symbol.asyncDispose]()),
    )
    const failure = new Error("renderer destroy failed before shutdown")
    const run = yield* Effect.acquireRelease(
      Effect.promise(() => launch({ state: temporary.path })),
      (value) =>
        Effect.promise(async () => {
          await expect(value.setup[Symbol.asyncDispose]()).rejects.toBeInstanceOf(SuppressedError)
        }),
    )
    yield* awaitWithTimeout(
      Effect.promise(() => run.setup.ready),
      "pre-shutdown fixture did not become ready",
    )
    yield* Effect.promise(() => run.setup.waitForFrame((frame) => frame.includes("Demo Model")))
    const file = path.join(temporary.path, "test", "tui", "tabs.json")
    const lock = yield* StorageLifecycle.holdLock(file, path.join(temporary.path, "test", "locks"))
    const entered = Promise.withResolvers<void>()
    let settled = false
    try {
      yield* Effect.promise(() => run.setup.mockInput.typeText("persist through cancellation"))
      run.setup.mockInput.pressEnter()
      yield* Effect.promise(() => run.setup.waitForFrame(() => run.prompts.length === 1))
      run.setup.renderer.prependOnceListener("destroy", () => {
        entered.resolve()
        throw failure
      })
      const disposal = run.setup[Symbol.asyncDispose]()
      const result = disposal
        .then(
          () => undefined,
          (error: unknown) => error,
        )
        .finally(() => {
          settled = true
        })
      yield* awaitWithTimeout(
        Effect.promise(() => entered.promise),
        "pre-shutdown destroy listener did not run",
      )
      yield* Effect.promise(() => access(run.setup.directory))
      expect(settled).toBe(false)
      yield* lock.release
      yield* lock.done
      const error = yield* awaitWithTimeout(
        Effect.promise(() => result),
        "cancelled run did not drain its pending write",
      )
      expect(error).toBeInstanceOf(SuppressedError)
      if (!(error instanceof SuppressedError))
        return yield* Effect.die(new Error("Destroy and task errors were not retained"))
      expect(error.suppressed).toBe(failure)
      const exit = yield* Effect.promise(() => run.setup.exit)
      if (Exit.isSuccess(exit)) return yield* Effect.die(new Error("Cancelled App run became success"))
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(run.setup[Symbol.asyncDispose]()).toBe(disposal)
      expect(JSON.stringify(yield* Effect.promise(() => Bun.file(file).json()))).toContain('"sessionID":"ses_chosen"')
      yield* Effect.promise(async () => {
        await expect(access(run.setup.directory)).rejects.toMatchObject({ code: "ENOENT" })
        await expect(fetch(new URL("/api/info", run.setup.server.url))).rejects.toThrow()
      })
    } finally {
      yield* lock.release
      yield* lock.done
    }
  }),
)

it.live("a ready failure releases the acquired App fixture before its outer state directory", () =>
  Effect.gen(function* () {
    const temporary = yield* Effect.acquireRelease(Effect.promise(tmpdir), (value) =>
      Effect.promise(() => value[Symbol.asyncDispose]()),
    )
    const captured = Promise.withResolvers<Awaited<ReturnType<typeof createAppFixture>>>()
    const startupError = Promise.withResolvers<unknown>()
    const exit = yield* Effect.gen(function* () {
      const setup = yield* Effect.acquireRelease(
        Effect.promise(() =>
          createAppFixture({
            state: temporary.path,
            fetch: (url) =>
              ["/api/fs/list", "/api/location"].includes(url.pathname)
                ? json({ message: "isolated startup unavailable" }, { status: 404 })
                : undefined,
          }),
        ),
        (value) => Effect.promise(() => value[Symbol.asyncDispose]()),
      )
      captured.resolve(setup)
      void setup.task.then(
        () => startupError.resolve(undefined),
        (error: unknown) => startupError.resolve(error),
      )
      yield* awaitWithTimeout(
        Effect.promise(() => setup.ready),
        "ready stage failed before first frame",
      )
    }).pipe(Effect.scoped, Effect.exit)
    const setup = yield* Effect.promise(() => captured.promise)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isSuccess(exit)) return yield* Effect.die(new Error("Ready failure was lost"))
    expect(
      exit.cause.reasons.some(
        (reason) =>
          reason._tag === "Fail" &&
          reason.error instanceof Error &&
          reason.error.message === "ready stage failed before first frame",
      ),
    ).toBe(true)
    const original = yield* Effect.promise(() => startupError.promise)
    expect(exit.cause.reasons.some((reason) => reason._tag === "Die" && reason.defect === original)).toBe(true)
    expect(Exit.isFailure(yield* Effect.promise(() => setup.exit))).toBe(true)
    const disposal = setup[Symbol.asyncDispose]()
    expect(setup[Symbol.asyncDispose]()).toBe(disposal)
    yield* Effect.promise(async () => {
      await expect(disposal).rejects.toBe(original)
      await expect(access(setup.directory)).rejects.toMatchObject({ code: "ENOENT" })
      await expect(fetch(new URL("/api/info", setup.server.url))).rejects.toThrow()
      await access(temporary.path)
    })
    expect(setup.renderer.isDestroyed).toBe(true)
  }),
)

it.live("a first-frame precondition failure disposes the acquired App fixture", () =>
  Effect.gen(function* () {
    const temporary = yield* Effect.acquireRelease(Effect.promise(tmpdir), (value) =>
      Effect.promise(() => value[Symbol.asyncDispose]()),
    )
    const captured = Promise.withResolvers<Awaited<ReturnType<typeof launch>>>()
    const failure = new Error("first-frame precondition failed")
    const exit = yield* Effect.gen(function* () {
      const run = yield* Effect.acquireRelease(
        Effect.promise(() => launch({ state: temporary.path })),
        (value) => Effect.promise(() => value.setup[Symbol.asyncDispose]()),
      )
      captured.resolve(run)
      yield* awaitWithTimeout(
        Effect.promise(() => run.setup.ready),
        "frame fixture did not become ready",
      )
      yield* Effect.promise(() =>
        run.setup.waitForFrame(() => {
          throw failure
        }),
      )
    }).pipe(Effect.scoped, Effect.exit)
    const run = yield* Effect.promise(() => captured.promise)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isSuccess(exit)) return yield* Effect.die(new Error("First-frame failure was lost"))
    expect(exit.cause.reasons.some((reason) => reason._tag === "Die" && reason.defect === failure)).toBe(true)
    expect(Exit.isSuccess(yield* Effect.promise(() => run.setup.exit))).toBe(true)
    const disposal = run.setup[Symbol.asyncDispose]()
    expect(run.setup[Symbol.asyncDispose]()).toBe(disposal)
    yield* Effect.promise(() => disposal)
    yield* Effect.promise(async () => {
      await expect(access(run.setup.directory)).rejects.toMatchObject({ code: "ENOENT" })
      await expect(fetch(new URL("/api/info", run.setup.server.url))).rejects.toThrow()
      await access(temporary.path)
    })
    expect(run.setup.renderer.isDestroyed).toBe(true)
  }),
)
