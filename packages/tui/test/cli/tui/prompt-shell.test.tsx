/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import type { ProductMode } from "@aigcfroge/sdk/v2"
import { expect, test } from "bun:test"
import { createEffect, onCleanup } from "solid-js"
import { Prompt, type PromptRef } from "../../../src/component/prompt"
import { ArgsProvider } from "../../../src/context/args"
import { DataProvider } from "../../../src/context/data"
import { EditorContextProvider } from "../../../src/context/editor"
import { ExitProvider } from "../../../src/context/exit"
import { KVProvider } from "../../../src/context/kv"
import { LocalProvider, useLocal } from "../../../src/context/local"
import { LocationProvider } from "../../../src/context/location"
import { ProjectProvider } from "../../../src/context/project"
import { RouteProvider } from "../../../src/context/route"
import { SDKProvider } from "../../../src/context/sdk"
import { SyncProvider, useSync } from "../../../src/context/sync"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider } from "../../../src/config"
import { AigcfrogeKeymapProvider, registerAigcfrogeKeymap } from "../../../src/keymap"
import { FrecencyProvider } from "../../../src/prompt/frecency"
import { PromptHistoryProvider } from "../../../src/prompt/history"
import { PromptStashProvider } from "../../../src/prompt/stash"
import { DialogProvider } from "../../../src/ui/dialog"
import { ToastProvider, useToast } from "../../../src/ui/toast"
import { tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { createFetch, directory, eventSource, json } from "../../fixture/tui-sdk"

async function mountShell(
  root: string,
  mode: ProductMode,
  canonicalSessionModes: ProductMode[],
  reject = false,
  response?: Promise<void>,
) {
  await Bun.write(`${root}/kv.json`, JSON.stringify({ animations_enabled: false }))
  const calls = createFetch((url) => {
    if (url.pathname === "/config/providers")
      return json({
        providers: [{ id: "test", models: { model: { id: "model", name: "Model" } } }],
        default: { test: "model" },
      })
    if (url.pathname === "/experimental/capabilities")
      return json({ backgroundSubagents: false, canonicalSessionModes })
    if (url.pathname === "/agent") return json([{ name: "build", mode: "primary", permission: {} }])
    if (url.pathname === "/provider")
      return json({
        all: [{ id: "test", name: "Test", models: { model: { id: "model", name: "Model" } } }],
        default: { test: "model" },
        connected: ["test"],
      })
    if (url.pathname === "/session")
      return json([{ id: "session-shell", mode, title: "Shell", directory, time: { created: 1, updated: 1 } }])
    return undefined
  })
  const requests: Array<{ path: string; body: unknown }> = []
  const received = Promise.withResolvers<void>()
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname.endsWith("/shell")) {
      requests.push({ path: url.pathname, body: await request.json() })
      received.resolve()
      await response
      return reject
        ? json({ name: "InvalidRequestError", message: "Shell rejected" }, { status: 400 })
        : json({ id: "input-shell" })
    }
    return calls.fetch(request)
  }) satisfies (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>
  const ready = Promise.withResolvers<void>()
  const submitted = Promise.withResolvers<void>()
  const failed = Promise.withResolvers<void>()
  let prompt: PromptRef | undefined

  function Probe() {
    const sync = useSync()
    const local = useLocal()
    const toast = useToast()
    createEffect(() => {
      if (sync.status === "complete" && local.model.ready && prompt) ready.resolve()
      if (toast.currentToast?.variant === "error") failed.resolve()
    })
    return (
      <Prompt
        sessionID="session-shell"
        ref={(value) => {
          prompt = value
        }}
        onSubmit={() => submitted.resolve()}
      />
    )
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig({ keybinds: { input_submit: "return" } })
    onCleanup(registerAigcfrogeKeymap(keymap, renderer, config))
    return (
      <TestTuiContexts directory={directory} paths={{ home: root, state: root }}>
        <AigcfrogeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <ExitProvider exit={() => {}}>
              <ArgsProvider model="test/model">
                <KVProvider>
                  <RouteProvider initialRoute={{ type: "session", sessionID: "session-shell" }}>
                    <SDKProvider url="http://test" directory={directory} fetch={fetcher} events={eventSource()}>
                      <ProjectProvider>
                        <SyncProvider>
                          <DataProvider>
                            <ThemeProvider mode="dark">
                              <ToastProvider>
                                <LocalProvider>
                                  <DialogProvider>
                                    <PromptStashProvider>
                                      <PromptHistoryProvider>
                                        <FrecencyProvider>
                                          <EditorContextProvider>
                                            <LocationProvider>
                                              <Probe />
                                            </LocationProvider>
                                          </EditorContextProvider>
                                        </FrecencyProvider>
                                      </PromptHistoryProvider>
                                    </PromptStashProvider>
                                  </DialogProvider>
                                </LocalProvider>
                              </ToastProvider>
                            </ThemeProvider>
                          </DataProvider>
                        </SyncProvider>
                      </ProjectProvider>
                    </SDKProvider>
                  </RouteProvider>
                </KVProvider>
              </ArgsProvider>
            </ExitProvider>
          </TuiConfigProvider>
        </AigcfrogeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />)
  await ready.promise
  if (!prompt) throw new Error("Prompt ref unavailable")
  prompt.reset()
  prompt.focus()
  app.mockInput.pressKey("!")
  prompt.set({ input: "printf canonical", parts: [] })
  return { app, prompt, requests, received: received.promise, submitted: submitted.promise, failed: failed.promise }
}

test.each(["assistant", "custom", "coding"] as const)(
  "Prompt sends %s Shell through the server-selected canonical route",
  async (mode) => {
    await using tmp = await tmpdir()
    const fixture = await mountShell(tmp.path, mode, [mode])
    try {
      fixture.prompt.submit()
      await fixture.received
      expect(fixture.requests).toEqual([
        { path: "/api/session/session-shell/shell", body: { command: "printf canonical" } },
      ])
      await fixture.submitted
      expect(fixture.prompt.current.input).toBe("")
    } finally {
      fixture.prompt.reset()
      fixture.app.renderer.destroy()
    }
  },
)

test("Prompt preserves the V1 Shell payload for the server's default runtime", async () => {
  await using tmp = await tmpdir()
  const fixture = await mountShell(tmp.path, "coding", ["assistant", "custom"])
  try {
    fixture.prompt.submit()
    await fixture.received
    expect(fixture.requests).toEqual([
      {
        path: "/session/session-shell/shell",
        body: { agent: "build", model: { providerID: "test", modelID: "model" }, command: "printf canonical" },
      },
    ])
    await fixture.submitted
  } finally {
    fixture.prompt.reset()
    fixture.app.renderer.destroy()
  }
})

test("Prompt retains a rejected canonical Shell draft and reports the error", async () => {
  await using tmp = await tmpdir()
  const fixture = await mountShell(tmp.path, "assistant", ["assistant"], true)
  try {
    fixture.prompt.submit()
    await fixture.received
    await fixture.failed
    expect(fixture.prompt.current.input).toBe("printf canonical")
    expect(fixture.requests).toHaveLength(1)
  } finally {
    fixture.prompt.reset()
    fixture.app.renderer.destroy()
  }
})

test("Prompt preserves edits made while Shell admission is pending and submits once", async () => {
  await using tmp = await tmpdir()
  const response = Promise.withResolvers<void>()
  const fixture = await mountShell(tmp.path, "assistant", ["assistant"], false, response.promise)
  try {
    fixture.prompt.submit()
    await fixture.received
    fixture.prompt.set({ input: "next command", parts: [] })
    fixture.prompt.submit()
    response.resolve()
    await fixture.submitted
    expect(fixture.requests).toEqual([
      { path: "/api/session/session-shell/shell", body: { command: "printf canonical" } },
    ])
    expect(fixture.prompt.current.input).toBe("next command")
  } finally {
    response.resolve()
    fixture.prompt.reset()
    fixture.app.renderer.destroy()
  }
})
