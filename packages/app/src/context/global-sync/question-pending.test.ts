import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { createAigcfrogeClient, type QuestionV2Request, type Session } from "@aigcfroge/sdk/v2/client"
import { loadQuestionPending, loadV2PermissionPending } from "./bootstrap"
import { applyDirectoryEvent } from "./event-reducer"
import type { State } from "./types"

const session = {
  id: "ses_snapshot",
  slug: "snapshot",
  projectID: "project",
  directory: "/repo",
  title: "Snapshot",
  mode: "coding",
  agent: "build",
  version: "test",
  time: { created: 1, updated: 1 },
} satisfies Session
const question = (id = "que_snapshot"): QuestionV2Request => ({
  id,
  sessionID: session.id,
  questions: [{ question: "Choose", header: "Choice", options: [{ label: "One", description: "First" }] }],
})

function fixture(initial: QuestionV2Request[] = []) {
  const [store, setStore] = createStore<State>({
    status: "complete",
    agent: [],
    command: [],
    project: "project",
    projectMeta: undefined,
    icon: undefined,
    provider_ready: true,
    provider: { all: new Map(), default: {}, connected: [] },
    config: {},
    path: { home: "/home", state: "/state", config: "/config", directory: "/repo", worktree: "/repo" },
    session: [session],
    sessionTotal: 1,
    session_status: {},
    session_working: () => false,
    session_diff: {},
    permission: {},
    permission_v2: {},
    permission_v2_revision: 0,
    permission_v2_load_epoch: 0,
    permission_v2_events: [],
    question_revision: 0,
    question_load_epoch: 0,
    question_events: [],
    question: { [session.id]: initial },
    mcp_ready: true,
    mcp: {},
    lsp_ready: true,
    lsp: [],
    vcs: undefined,
    limit: 10,
    message: {},
    part: {},
    part_text_accum_delta: {},
  })
  const snapshots = Array.from({ length: 3 }, () => ({
    started: Promise.withResolvers<void>(),
    response: Promise.withResolvers<Response>(),
  }))
  const reads: URL[] = []
  const sdk = createAigcfrogeClient({
    baseUrl: "http://question.test",
    fetch: Object.assign(
      async (input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        if (url.pathname === `/session/${session.id}`) return Response.json(session)
        if (url.pathname !== "/api/question/request" && url.pathname !== "/api/permission/request")
          throw new Error(`Unexpected request: ${url.pathname}`)
        const next = snapshots[reads.length]
        if (!next) throw new Error("Unexpected extra pending snapshot")
        reads.push(url)
        next.started.resolve()
        return next.response.promise
      },
      { preconnect() {} },
    ),
  })
  return {
    store,
    setStore,
    snapshots,
    reads,
    load: () => loadQuestionPending({ directory: "/repo", sdk, store, setStore }),
    loadPermission: () => loadV2PermissionPending({ sdk, store, setStore }),
    finish: (index: number, data: unknown[]) =>
      snapshots[index].response.resolve(
        Response.json({
          location: { directory: "/repo", project: { id: "project", directory: "/repo" } },
          data,
        }),
      ),
    event: (type: string, properties: unknown) =>
      applyDirectoryEvent({
        event: { type, properties },
        store,
        setStore,
        directory: "/repo",
        push() {},
        loadLsp() {},
      }),
  }
}

describe("AI-TDD-S03 Question snapshot and native event ordering", () => {
  for (const type of ["question.v2.replied", "question.v2.rejected"]) {
    test(`a late snapshot cannot revive a request removed by ${type}`, async () => {
      const current = question()
      const state = fixture([current])
      const loading = state.load()
      await state.snapshots[0].started.promise
      state.event(type, { sessionID: current.sessionID, requestID: current.id, answers: [["One"]] })
      expect(state.store.question[session.id]).toEqual([])
      state.finish(0, [current])
      await loading
      expect(state.store.question[session.id] ?? []).toEqual([])
    })
  }

  test("a late empty snapshot cannot discard a newly asked request", async () => {
    const current = question()
    const state = fixture()
    const loading = state.load()
    await state.snapshots[0].started.promise
    state.event("question.v2.asked", current)
    state.finish(0, [])
    await loading
    expect(state.store.question[session.id]).toEqual([current])
    expect(state.reads[0].searchParams.get("location[directory]")).toBe("/repo")
  })

  test("an older load cannot overwrite a newer completed snapshot", async () => {
    const state = fixture()
    const older = state.load()
    await state.snapshots[0].started.promise
    const newer = state.load()
    await state.snapshots[1].started.promise
    state.finish(1, [question("que_newer")])
    await newer
    state.finish(0, [question("que_older")])
    await older
    expect(state.store.question[session.id]?.map((request) => request.id)).toEqual(["que_newer"])
  })

  for (const domain of ["question", "permission"] as const) {
    test(`${domain} refetches instead of applying an evicted event window`, async () => {
      const state = fixture()
      const loading = domain === "question" ? state.load() : state.loadPermission()
      await state.snapshots[0].started.promise
      const requests = Array.from({ length: 620 }, (_, index) =>
        domain === "question"
          ? question(`que_overflow_${index}`)
          : { id: `per_overflow_${index}`, sessionID: session.id, action: "read", resources: ["*"] },
      )
      requests.forEach((request) => state.event(`${domain}.v2.asked`, request))
      state.finish(0, [])
      await state.snapshots[1].started.promise
      state.finish(1, requests)
      await loading
      expect(state.reads).toHaveLength(2)
      expect(
        domain === "question" ? state.store.question[session.id] : state.store.permission_v2[session.id],
      ).toHaveLength(620)
      expect(domain === "question" ? state.store.question_events : state.store.permission_v2_events).toEqual([])
    })
  }

  test("a failed snapshot does not clear the pending state", async () => {
    const current = question()
    const state = fixture([current])
    const loading = state.load()
    await state.snapshots[0].started.promise
    state.snapshots[0].response.resolve(Response.json({ message: "Unavailable" }, { status: 500 }))
    await expect(loading).rejects.toThrow("Unavailable")
    expect(state.store.question[session.id]).toEqual([current])
  })
})
