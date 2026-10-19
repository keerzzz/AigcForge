/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import type { QuestionV2Request } from "@aigcfroge/sdk/v2"
import { onCleanup, onMount } from "solid-js"
import { TuiConfigProvider } from "../../../src/config"
import { KVProvider } from "../../../src/context/kv"
import { SDKProvider } from "../../../src/context/sdk"
import { ThemeProvider } from "../../../src/context/theme"
import { AigcfrogeKeymapProvider, registerAigcfrogeKeymap } from "../../../src/keymap"
import { QuestionPrompt } from "../../../src/routes/session/question"
import { ToastProvider, useToast } from "../../../src/ui/toast"
import { tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { eventSource, json } from "../../fixture/tui-sdk"
import { wait } from "../cmd/tui/sync-fixture"

const request: QuestionV2Request = {
  id: "question-child",
  sessionID: "child-session",
  questions: [
    { header: "Mode", question: "Mode?", custom: false, options: [{ label: "Fast", description: "Quick pass" }] },
  ],
}

async function mount(state: string, question: QuestionV2Request, respond: (request: Request) => Response) {
  const ready = Promise.withResolvers<ReturnType<typeof useToast>>()
  const config = createTuiResolvedConfig()
  const fetcher = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      respond(input instanceof Request ? input : new Request(input, init)),
    { preconnect() {} },
  )

  function Probe() {
    const toast = useToast()
    onMount(() => ready.resolve(toast))
    return <QuestionPrompt request={question} />
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    onCleanup(registerAigcfrogeKeymap(keymap, renderer, config))
    return (
      <AigcfrogeKeymapProvider keymap={keymap}>
        <TestTuiContexts paths={{ state }}>
          <TuiConfigProvider config={config}>
            <KVProvider>
              <ThemeProvider mode="dark">
                <ToastProvider>
                  <SDKProvider
                    url="http://test"
                    directory="/selected-session-directory"
                    fetch={fetcher}
                    events={eventSource()}
                  >
                    <Probe />
                  </SDKProvider>
                </ToastProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </TestTuiContexts>
      </AigcfrogeKeymapProvider>
    )
  }

  const app = await testRender(() => <Harness />, { width: 80, height: 24 })
  const toast = await ready.promise
  await app.renderOnce()
  return { ...app, toast }
}

for (const action of ["reply", "reject", "confirm"] as const) {
  test(`QuestionPrompt ${action} uses the request owner and accepts native 204`, async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const requests: Request[] = []
    const question =
      action === "confirm" ? { ...request, questions: [...request.questions, ...request.questions] } : request
    const app = await mount(tmp.path, question, (input) => {
      requests.push(input)
      return new Response(null, { status: 204 })
    })

    try {
      if (action === "reject") app.mockInput.pressKey("ESCAPE")
      if (action !== "reject") app.mockInput.pressKey("1")
      if (action === "confirm") {
        await app.renderOnce()
        app.mockInput.pressKey("1")
        await app.renderOnce()
        app.mockInput.pressEnter()
      }
      await wait(() => requests.length > 0)
      await app.renderOnce()
      expect(requests).toHaveLength(1)
      const outgoing = requests[0]
      expect(outgoing.method).toBe("POST")
      expect(new URL(outgoing.url).pathname).toBe(
        `/api/session/child-session/question/question-child/${action === "reject" ? "reject" : "reply"}`,
      )
      expect(new URL(outgoing.url).search).toBe("")
      if (action === "reject") expect(await outgoing.text()).toBe("")
      if (action !== "reject") {
        expect(await outgoing.json()).toEqual({ answers: action === "confirm" ? [["Fast"], ["Fast"]] : [["Fast"]] })
      }
      expect(app.toast.currentToast).toBeNull()
    } finally {
      app.renderer.destroy()
    }
  })
}

for (const action of ["reply", "reject"] as const) {
  test(`QuestionPrompt handles native ${action} failure through the error toast and permits retry`, async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const requests: Request[] = []
    const app = await mount(tmp.path, request, (input) => {
      requests.push(input)
      if (requests.length === 1) return json({ message: "Question is no longer pending" }, { status: 404 })
      return new Response(null, { status: 204 })
    })

    try {
      app.mockInput.pressKey(action === "reject" ? "ESCAPE" : "1")
      await wait(() => app.toast.currentToast?.variant === "error")
      expect(requests).toHaveLength(1)
      expect(app.toast.currentToast?.message).toBe("Question is no longer pending")
      expect(app.captureCharFrame()).toContain("Mode?")
      app.mockInput.pressKey(action === "reject" ? "ESCAPE" : "1")
      await wait(() => requests.length === 2)
      expect(new URL(requests[1].url).pathname).toBe(`/api/session/child-session/question/question-child/${action}`)
    } finally {
      app.renderer.destroy()
    }
  })
}
