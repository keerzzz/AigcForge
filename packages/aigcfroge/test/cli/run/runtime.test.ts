import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { AigcfrogeClient, createAigcfrogeClient } from "@aigcfroge/sdk/v2"
import { runInteractiveMode, type RunRuntimeDeps } from "@/cli/cmd/run/runtime"
import { createRunDemo } from "@/cli/cmd/run/demo"
import { createQuestionBodyState, questionSelect, questionReject } from "@/cli/cmd/run/question.shared"
import type { FooterApi, FooterEvent, RunProvider } from "@/cli/cmd/run/types"

type SessionMessage = NonNullable<Awaited<ReturnType<AigcfrogeClient["session"]["messages"]>>["data"]>[number]

const provider: RunProvider = {
  id: "openai",
  name: "OpenAI",
  source: "api",
  env: [],
  options: {},
  models: {
    "gpt-5": {
      id: "gpt-5",
      providerID: "openai",
      api: {
        id: "openai",
        url: "https://openai.test",
        npm: "@ai-sdk/openai",
      },
      name: "Little Frank",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        interleaved: false,
      },
      cost: {
        input: 0,
        output: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      limit: {
        context: 128000,
        output: 8192,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2026-01-01",
    },
  },
}

const transportProviders: RunProvider[][] = []

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function ok<T>(data: T) {
  return Promise.resolve({
    data,
    error: undefined,
    request: new Request("https://aigcfroge.test"),
    response: new Response(),
  })
}

function footer(onReady?: () => void): FooterApi {
  let closed = false
  const closes = new Set<() => void>()

  const notify = () => {
    for (const fn of closes) fn()
  }

  return {
    get isClosed() {
      return closed
    },
    onPrompt: () => {
      onReady?.()
      return () => {}
    },
    onQueuedRemove: () => () => {},
    onClose(fn) {
      if (closed) {
        fn()
        return () => {}
      }

      closes.add(fn)
      return () => {
        closes.delete(fn)
      }
    },
    event() {},
    append() {},
    idle() {
      return Promise.resolve()
    },
    close() {
      if (closed) {
        return
      }

      closed = true
      notify()
    },
    destroy() {
      if (closed) {
        return
      }

      closed = true
      notify()
    },
  }
}

afterEach(() => {
  mock.restore()
  transportProviders.length = 0
})

describe("run interactive runtime", () => {
  test("waits for provider metadata before eager replay transport bootstrap", async () => {
    const providersStarted = defer<void>()
    const providers = defer<void>()

    const sdk = new AigcfrogeClient()
    spyOn(sdk.config, "providers").mockImplementation(async () => {
      providersStarted.resolve()
      await providers.promise
      return ok({ providers: [provider], default: {} })
    })
    spyOn(sdk.session, "messages").mockImplementation(() =>
      ok([
        {
          info: {
            id: "msg-user-1",
            sessionID: "ses-1",
            role: "user",
            time: {
              created: 1,
            },
            agent: "build",
            model: {
              providerID: "openai",
              modelID: "gpt-5",
              variant: undefined,
            },
          },
          parts: [
            {
              id: "part-user-1",
              sessionID: "ses-1",
              messageID: "msg-user-1",
              type: "text",
              text: "hello",
            },
          ],
        } satisfies SessionMessage,
      ]),
    )
    spyOn(sdk.session, "get").mockRejectedValue(new Error("not needed"))
    spyOn(sdk.app, "agents").mockImplementation(() => ok([]))
    spyOn(sdk.experimental.resource, "list").mockImplementation(() => ok({}))
    spyOn(sdk.command, "list").mockImplementation(() => ok([]))

    const task = runInteractiveMode(
      {
        sdk,
        directory: "/tmp",
        sessionID: "ses-1",
        sessionTitle: "Session",
        resume: true,
        replay: true,
        replayLimit: 100,
        agent: "build",
        model: {
          providerID: "openai",
          modelID: "gpt-5",
        },
        variant: undefined,
        files: [],
        thinking: true,
        backgroundSubagents: false,
      },
      {
        createRuntimeLifecycle: async () => ({
          footer: footer(),
          onResize: () => () => {},
          refreshTheme: () => {},
          resetForReplay: () => Promise.resolve(),
          close: () => Promise.resolve(),
        }),
        streamTransport: Promise.resolve({
          createSessionTransport: async (input: { providers?: () => RunProvider[]; footer: FooterApi }) => {
            transportProviders.push(input.providers?.() ?? [])
            setTimeout(() => {
              input.footer.close()
            }, 0)
            return {
              runPromptTurn: async () => {},
              selectSubagent: () => {},
              replayOnResize: async () => false,
              close: async () => {},
            }
          },
          formatUnknownError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
        }),
      },
    )

    await providersStarted.promise

    expect(transportProviders).toEqual([])

    providers.resolve()

    await task

    expect(transportProviders).toEqual([[provider]])
  })
})

test("runtime Question callbacks preserve child ownership, accept 204 and reject native errors", async () => {
  const ready = defer<Parameters<NonNullable<RunRuntimeDeps["createRuntimeLifecycle"]>>[0]>()
  const interactive = defer<void>()
  const ui = footer(() => interactive.resolve())
  const requests: Request[] = []
  let status = 204
  const sdk = createAigcfrogeClient({
    baseUrl: "https://aigcfroge.test",
    fetch: Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(input instanceof Request ? input : new Request(input, init))
        if (status === 204) return new Response(null, { status })
        return Response.json({ message: "Question is no longer pending" }, { status })
      },
      { preconnect() {} },
    ),
  })
  spyOn(sdk.config, "providers").mockImplementation(() => ok({ providers: [], default: {} }))
  spyOn(sdk.app, "agents").mockImplementation(() => ok([]))
  spyOn(sdk.experimental.resource, "list").mockImplementation(() => ok({}))
  spyOn(sdk.command, "list").mockImplementation(() => ok([]))
  spyOn(sdk.session, "get").mockRejectedValue(new Error("not needed"))
  const running = runInteractiveMode(
    {
      sdk,
      directory: "/selected-directory",
      sessionID: "selected-session",
      agent: "build",
      model: undefined,
      variant: undefined,
      files: [],
      thinking: false,
      backgroundSubagents: true,
    },
    {
      createRuntimeLifecycle: async (input) => {
        ready.resolve(input)
        return {
          footer: ui,
          onResize: () => () => {},
          refreshTheme: () => {},
          resetForReplay: async () => {},
          close: async () => {},
        }
      },
      streamTransport: Promise.resolve({
        createSessionTransport: async () => ({
          runPromptTurn: async () => {},
          selectSubagent: () => {},
          replayOnResize: async () => false,
          close: async () => {},
        }),
        formatUnknownError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
      }),
    },
  )

  try {
    const lifecycle = await ready.promise
    await interactive.promise
    const reply = { sessionID: "child-session", requestID: "child-question", questionV2Reply: { answers: [["Fast"]] } }
    const reject = { sessionID: "child-session", requestID: "child-question" }
    await expect(Promise.resolve(lifecycle.onQuestionReply(reply))).resolves.toBeUndefined()
    await expect(Promise.resolve(lifecycle.onQuestionReject(reject))).resolves.toBeUndefined()
    expect(requests).toHaveLength(2)
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/api/session/child-session/question/child-question/reply",
      "/api/session/child-session/question/child-question/reject",
    ])
    expect(await requests[0].json()).toEqual({ answers: [["Fast"]] })
    expect(await requests[1].text()).toBe("")

    status = 404
    await expect(Promise.resolve(lifecycle.onQuestionReply(reply))).rejects.toThrow("Question is no longer pending")
    await expect(Promise.resolve(lifecycle.onQuestionReject(reject))).rejects.toThrow("Question is no longer pending")
  } finally {
    ui.close()
    await running
  }
})

for (const action of ["reply", "reject"] as const) {
  test(`demo Question ${action} uses native events and refuses a different session owner`, async () => {
    const events: FooterEvent[] = []
    const ui = footer()
    spyOn(ui, "event").mockImplementation((event) => events.push(event))
    const demo = createRunDemo({ sessionID: "demo-session", thinking: false, limits: () => ({}), footer: ui })
    expect(await demo.prompt({ text: "/question single", parts: [] })).toBe(true)
    const event = events.findLast((event) => event.type === "stream.view")
    if (event?.type !== "stream.view" || event.view.type !== "question") throw new Error("Question was not displayed")
    const request = event.view.request
    expect(request.sessionID).toBe("demo-session")

    if (action === "reply") {
      const reply = questionSelect(createQuestionBodyState(request.id), request).reply
      if (!reply) throw new Error("Single selection did not produce a reply")
      expect(demo.questionReply({ ...reply, sessionID: "other-session" })).toBe(false)
      expect(demo.questionReply(reply)).toBe(true)
    }
    if (action === "reject") {
      const reject = questionReject(request)
      expect(demo.questionReject({ ...reject, sessionID: "other-session" })).toBe(false)
      expect(demo.questionReject(reject)).toBe(true)
    }
    expect(events.findLast((event) => event.type === "stream.view")).toEqual({
      type: "stream.view",
      view: { type: "prompt" },
    })
  })
}
