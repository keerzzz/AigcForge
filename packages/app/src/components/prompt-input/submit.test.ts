import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { Schema } from "effect"
import { WorkContract } from "@aigcfroge/schema/work-contract"
import type { Session, SessionCreateData, SessionPromptAsyncData, V2SessionShellData } from "@aigcfroge/sdk/v2/client"
import type { Prompt } from "@/context/prompt"
import type { DraftTab } from "@/context/tabs"

type SentPrompt = NonNullable<SessionPromptAsyncData["body"]> & SessionPromptAsyncData["path"]

let createPromptSubmit: typeof import("./submit").createPromptSubmit

const createdClients: string[] = []
const createdSessions: string[] = []
const createdSessionRequests: Array<SessionCreateData["body"]> = []
const draftTabs: Array<Omit<DraftTab, "server" | "directory">> = []
const enabledAutoAccept: Array<{ sessionID: string; directory: string }> = []
const sentCommand: Array<{ command?: string; arguments?: string; parts?: unknown }> = []
const optimistic: Array<{
  directory?: string
  sessionID?: string
  message: {
    agent: string
    model: { providerID: string; modelID: string }
    variant?: string
  }
}> = []
const optimisticSeeded: boolean[] = []
const storedSessions: Record<
  string,
  Array<{ id: string; title?: string; directory?: string; mode?: Session["mode"] }>
> = {}
const promoted: Array<{ directory: string; sessionID: string }> = []
const placements: Array<{ server: string; leafID: string; rootID: string; directory: string }> = []
const sentShell: string[] = []
const admittedShell: Array<V2SessionShellData["body"] & V2SessionShellData["path"] & { directory: string }> = []
const restoredPrompts: Prompt[] = []
const syncedDirectories: string[] = []

let params: { id?: string } = {}
let search: { draftId?: string } = {}
let sentPrompt = Promise.withResolvers<SentPrompt>()
let selected = "/repo/worktree-a"
let variant: string | undefined
let canonicalSessionModes: Session["mode"][] = []
let capabilitiesError: Error | undefined
let shellError: Error | undefined

const promptValue: Prompt = [{ type: "text", content: "ls", start: 0, end: 2 }]
const prompt = {
  ready: Object.assign(() => true, { promise: Promise.resolve(true) }),
  current: () => promptValue,
  cursor: () => 0,
  dirty: () => true,
  reset: () => undefined,
  set: (value: Prompt) => {
    restoredPrompts.push(value.slice())
  },
  context: {
    add: () => undefined,
    remove: () => undefined,
    removeComment: () => undefined,
    updateComment: () => undefined,
    replaceComments: () => undefined,
    items: () => [],
  },
}

const clientFor = (directory: string) => {
  createdClients.push(directory)
  return {
    session: {
      create: async (input: SessionCreateData["body"]) => {
        createdSessions.push(directory)
        createdSessionRequests.push(input)
        return {
          data: {
            id: `session-${createdSessions.length}`,
            title: `New session ${createdSessions.length}`,
            // The real endpoint answers with the session's own directory, and
            // `submit.ts` records placement from it.
            directory,
            mode: input?.mode ?? "coding",
          },
        }
      },
      shell: async () => {
        sentShell.push(directory)
        return { data: undefined }
      },
      prompt: async () => ({ data: undefined }),
      promptAsync: async (input: SentPrompt) => {
        sentPrompt.resolve(input)
        return { data: undefined }
      },
      command: async (input: { command?: string; arguments?: string; parts?: unknown }) => {
        sentCommand.push(input)
        return { data: undefined }
      },
      abort: async () => ({ data: undefined }),
    },
    v2: {
      session: {
        shell: async (input: V2SessionShellData["body"] & V2SessionShellData["path"]) => {
          admittedShell.push({ ...input, directory })
          if (shellError) throw shellError
          return { data: { id: "input-shell" } }
        },
      },
    },
    worktree: {
      create: async () => ({ data: { directory: `${directory}/new` } }),
    },
  }
}

beforeAll(async () => {
  const rootClient = clientFor("/repo/main")

  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => params,
    useLocation: () => ({}),
    useSearchParams: () => [search, () => undefined],
    useBeforeLeave: () => undefined,
  }))

  mock.module("@aigcfroge/sdk/v2/client", () => ({
    createAigcfrogeClient: (input: { directory: string }) => {
      createdClients.push(input.directory)
      return clientFor(input.directory)
    },
  }))

  // Mock the V2 exports, not the aliases re-exported by @/utils/toast.
  mock.module("@aigcfroge/ui/v2/toast-v2", () => ({
    ToastV2: { Region: () => null },
    toasterV2: {},
    showToastV2: () => 0,
  }))

  mock.module("@aigcfroge/core/util/encode", () => ({
    base64Encode: (value: string) => value,
  }))

  mock.module("@/context/local", () => ({
    useLocal: () => ({
      model: {
        current: () => ({ id: "model", provider: { id: "provider" } }),
        variant: { current: () => variant },
      },
      agent: {
        current: () => ({ name: "agent" }),
      },
      session: {
        promote(directory: string, sessionID: string) {
          promoted.push({ directory, sessionID })
        },
      },
    }),
  }))

  mock.module("@/context/permission", () => ({
    usePermission: () => ({
      enableAutoAccept(sessionID: string, directory: string) {
        enabledAutoAccept.push({ sessionID, directory })
      },
    }),
  }))

  mock.module("@/context/server", () => ({
    useServer: () => ({ key: "server-key" }),
  }))

  // Mocked like every other context this module reads. `submit.ts` used to wrap
  // `useGlobal()` in a try/catch so this file could skip it — a test-only escape in
  // production code, and one that left the placement write unobserved.
  mock.module("@/context/global", () => ({
    useGlobal: () => ({
      sessionPlacement: {
        set: (input: { server: string; leafID: string; rootID: string; directory: string }) => {
          placements.push(input)
          return input
        },
      },
    }),
  }))

  mock.module("@/context/tabs", () => ({
    useTabs: () => ({
      store: draftTabs,
      promoteDraft: () => undefined,
    }),
  }))

  mock.module("@/context/prompt", () => ({
    usePrompt: () => prompt,
  }))

  mock.module("@/context/layout", () => ({
    useLayout: () => ({
      handoff: {
        setTabs: () => undefined,
      },
    }),
  }))

  mock.module("@/context/sdk", () => ({
    useSDK: () => {
      const sdk = {
        scope: "local",
        directory: "/repo/main",
        client: rootClient,
        url: "http://localhost:4096",
        createClient(opts: { directory: string }) {
          return clientFor(opts.directory)
        },
      }
      return () => sdk
    },
  }))

  mock.module("@/context/sync", () => ({
    useSync: () => () => ({
      data: { command: [] },
      session: {
        optimistic: {
          add: (value: {
            directory?: string
            sessionID?: string
            message: { agent: string; model: { providerID: string; modelID: string; variant?: string } }
          }) => {
            optimistic.push(value)
            optimisticSeeded.push(
              !!value.directory &&
                !!value.sessionID &&
                !!storedSessions[value.directory]?.find((item) => item.id === value.sessionID)?.title,
            )
          },
          remove: () => undefined,
        },
      },
      set: () => undefined,
    }),
  }))

  mock.module("@/context/server-sync", () => ({
    useServerSync: () => () => ({
      capabilities: async () => {
        if (capabilitiesError) throw capabilitiesError
        return { canonicalSessionModes }
      },
      child: (directory: string) => {
        syncedDirectories.push(directory)
        storedSessions[directory] ??= []
        return [
          { session: storedSessions[directory] },
          (...args: unknown[]) => {
            if (args[0] !== "session") return
            const next = args[1]
            if (typeof next === "function") {
              storedSessions[directory] = next(storedSessions[directory]) as Array<{ id: string; title?: string }>
              return
            }
            if (Array.isArray(next)) {
              storedSessions[directory] = next as Array<{ id: string; title?: string }>
            }
          },
        ]
      },
    }),
  }))

  mock.module("@/context/platform", () => ({
    usePlatform: () => ({
      fetch: fetch,
    }),
  }))

  mock.module("@/context/language", () => ({
    useLanguage: () => ({
      t: (key: string) => key,
    }),
  }))

  const mod = await import("./submit")
  createPromptSubmit = mod.createPromptSubmit
})

beforeEach(() => {
  promptValue.splice(0, promptValue.length, { type: "text", content: "ls", start: 0, end: 2 })
  createdClients.length = 0
  createdSessions.length = 0
  createdSessionRequests.length = 0
  draftTabs.length = 0
  enabledAutoAccept.length = 0
  optimistic.length = 0
  optimisticSeeded.length = 0
  promoted.length = 0
  placements.length = 0
  params = {}
  search = {}
  sentPrompt = Promise.withResolvers<SentPrompt>()
  sentShell.length = 0
  admittedShell.length = 0
  restoredPrompts.length = 0
  canonicalSessionModes = []
  capabilitiesError = undefined
  shellError = undefined
  syncedDirectories.length = 0
  selected = "/repo/worktree-a"
  variant = undefined
  for (const key of Object.keys(storedSessions)) delete storedSessions[key]
})

describe("prompt submit worktree selection", () => {
  test("reads the latest worktree accessor value per submit", async () => {
    const submit = createPromptSubmit({
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)
    selected = "/repo/worktree-b"
    await submit.handleSubmit(event)

    expect(createdClients).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(createdSessions).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(sentShell).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(syncedDirectories).toEqual(["/repo/worktree-a", "/repo/worktree-a", "/repo/worktree-b", "/repo/worktree-b"])
    expect(promoted).toEqual([
      { directory: "/repo/worktree-a", sessionID: "session-1" },
      { directory: "/repo/worktree-b", sessionID: "session-2" },
    ])
    expect(syncedDirectories).toEqual(["/repo/worktree-a", "/repo/worktree-a", "/repo/worktree-b", "/repo/worktree-b"])
  })

  test("applies auto-accept to newly created sessions", async () => {
    const submit = createPromptSubmit({
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => true,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)

    expect(enabledAutoAccept).toEqual([{ sessionID: "session-1", directory: "/repo/worktree-a" }])
    // The placement write that the removed try/catch used to make optional. A new
    // session is its own root, and it is recorded against the worktree it was created
    // in, not the directory the composer was opened from.
    expect(placements).toEqual([
      { server: "server-key", leafID: "session-1", rootID: "session-1", directory: "/repo/worktree-a" },
    ])
  })

  test("includes the selected variant on optimistic prompts", async () => {
    params = { id: "session-1" }
    variant = "high"

    const submit = createPromptSubmit({
      prompt,
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)

    expect(optimistic).toHaveLength(1)
    expect(optimistic[0]).toMatchObject({
      message: {
        agent: "agent",
        model: { providerID: "provider", modelID: "model", variant: "high" },
      },
    })
  })

  test("seeds new sessions before optimistic prompts are added", async () => {
    const submit = createPromptSubmit({
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)

    expect(storedSessions["/repo/worktree-a"]).toEqual([
      { id: "session-1", title: "New session 1", directory: "/repo/worktree-a", mode: "coding" },
    ])
    expect(optimisticSeeded).toEqual([true])
  })
})

describe("prompt submit canonical Shell admission", () => {
  function shellSubmit(info: { id: string; mode: Session["mode"] } | undefined, modes: string[]) {
    return createPromptSubmit({
      prompt,
      info: () => info,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: (mode) => modes.push(mode),
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
    })
  }

  test.each(["assistant", "custom", "coding"] as const)(
    "uses server-selected canonical admission for an existing %s session",
    async (mode) => {
      params = { id: "session-existing" }
      canonicalSessionModes = [mode]
      await shellSubmit({ id: "session-existing", mode }, []).handleSubmit(new Event("submit"))

      expect(admittedShell).toEqual([{ sessionID: "session-existing", command: "ls", directory: "/repo/main" }])
      expect(sentShell).toEqual([])
    },
  )

  test("keeps V1 Shell for a mode absent from the server capabilities", async () => {
    params = { id: "session-existing" }
    canonicalSessionModes = ["assistant", "custom"]
    await shellSubmit({ id: "session-existing", mode: "coding" }, []).handleSubmit(new Event("submit"))

    expect(admittedShell).toEqual([])
    expect(sentShell).toEqual(["/repo/main"])
  })

  test("uses the created Assistant session mode and selected worktree", async () => {
    search = { draftId: "draft-selected" }
    draftTabs.push({ type: "draft", draftID: "draft-selected", mode: "assistant" })
    canonicalSessionModes = ["assistant"]
    await shellSubmit(undefined, []).handleSubmit(new Event("submit"))

    expect(admittedShell).toEqual([{ sessionID: "session-1", command: "ls", directory: "/repo/worktree-a" }])
    expect(sentShell).toEqual([])
  })

  test.each(["admission", "capabilities"] as const)("restores the Shell draft after %s failure", async (boundary) => {
    params = { id: "session-existing" }
    canonicalSessionModes = ["assistant"]
    if (boundary === "admission") shellError = new Error("Shell admission rejected")
    if (boundary === "capabilities") capabilitiesError = new Error("Server capabilities unavailable")
    const modes: string[] = []
    await shellSubmit({ id: "session-existing", mode: "assistant" }, modes).handleSubmit(new Event("submit"))

    expect(restoredPrompts).toEqual([promptValue])
    expect(modes).toEqual(["normal", "shell"])
    expect(sentShell).toEqual([])
    expect(admittedShell).toHaveLength(boundary === "admission" ? 1 : 0)
  })
})

describe("prompt submit Work contracts", () => {
  const contracts = [
    {
      source: "preset",
      contractVersion: 1,
      presetID: "storyboard-video",
      revision: "a1".repeat(32),
      output: {
        outputType: "mixed",
        artifact: { title: "Storyboard", filename: "storyboard.md", relativeDir: "deliverables" },
      },
    },
    {
      source: "workflow",
      contractVersion: 1,
      workflowID: "review.md",
      revision: "b2".repeat(32),
      output: { outputType: "markdown", artifact: { title: "Review", filename: "review.md" } },
    },
    {
      source: "ad-hoc",
      contractVersion: 1,
      output: { outputType: "table", artifact: { title: "Results", filename: "results.md" } },
    },
  ].map((contract) => Schema.decodeUnknownSync(WorkContract.Snapshot)(contract))

  beforeEach(() => {
    search = { draftId: "draft-selected" }
  })

  test.each(contracts)("passes the $source draft contract to session.create unchanged", async (workContract) => {
    draftTabs.push(
      { type: "draft", draftID: "draft-other", mode: "work" },
      {
        type: "draft",
        draftID: "draft-selected",
        mode: "work",
        agent: "work-agent",
        presetCategoryId: "video-creation",
        permissionTier: "propose",
        workContract,
      },
    )

    const sent = await submitPrompt()

    expect(createdSessions).toEqual(["/repo/worktree-a"])
    expect(createdSessionRequests).toEqual([
      {
        mode: "work",
        agent: "work-agent",
        presetCategoryId: "video-creation",
        permissionTier: "propose",
        metadata: { workContract },
      },
    ])
    expect(sent.sessionID).toBe("session-1")
  })

  test("defaults a Work draft without a preset or contract to ad-hoc", async () => {
    draftTabs.push({ type: "draft", draftID: "draft-selected", mode: "work" })

    await submitPrompt()

    expect(createdSessionRequests).toEqual([
      {
        mode: "work",
        agent: undefined,
        presetCategoryId: undefined,
        permissionTier: undefined,
        metadata: { workContract: { source: "ad-hoc", contractVersion: 1 } },
      },
    ])
  })

  test.each(["coding", "chat", "assistant", "custom"] as const)(
    "does not attach Work metadata to %s drafts",
    async (mode) => {
      draftTabs.push(
        { type: "draft", draftID: "draft-other", mode: "work", workContract: contracts[0] },
        { type: "draft", draftID: "draft-selected", mode },
      )

      await submitPrompt()

      expect(createdSessionRequests).toHaveLength(1)
      expect(createdSessionRequests[0]?.mode).toBe(mode)
      expect(createdSessionRequests[0]?.metadata).toBeUndefined()
    },
  )

  test.each([
    { label: "no draftId", draftId: undefined },
    { label: "an unmatched draftId", draftId: "draft-missing" },
  ])("does not borrow another draft's contract with $label", async (route) => {
    search = { draftId: route.draftId }
    draftTabs.push({ type: "draft", draftID: "draft-other", mode: "work", workContract: contracts[0] })

    await submitPrompt()

    expect(createdSessionRequests).toHaveLength(1)
    expect(createdSessionRequests[0]?.mode).toBe("coding")
    expect(createdSessionRequests[0]?.metadata).toBeUndefined()
  })

  test.each([
    { label: "the route has been promoted", id: "session-existing" },
    { label: "the route has not been promoted yet", id: undefined },
  ])("reuses an existing session when $label", async (route) => {
    params = { id: route.id }
    draftTabs.push({ type: "draft", draftID: "draft-selected", mode: "work", workContract: contracts[0] })

    const sent = await submitPrompt({ id: "session-existing" })

    expect(createdSessions).toEqual([])
    expect(createdSessionRequests).toEqual([])
    expect(promoted).toEqual([])
    expect(placements).toEqual([])
    expect(sent.sessionID).toBe("session-existing")
  })

  async function submitPrompt(info?: { id: string }) {
    const submit = createPromptSubmit({
      prompt,
      info: () => info,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
    })

    await submit.handleSubmit(new Event("submit"))
    // handleSubmit starts the sender without awaiting it; wait for the SDK call,
    // not a timer, so this submission cannot leak into the next test's fixtures.
    return sentPrompt.promise
  }
})

describe("AI-TDD-S04-R02 existing prompt submission channel", () => {
  test("sends the structured mention only after explicit submit and preserves the current primary agent", async () => {
    params = { id: "session-existing" }
    promptValue.splice(
      0,
      promptValue.length,
      { type: "text", content: "Review ", start: 0, end: 7 },
      { type: "agent", name: "reviewer", content: "@reviewer", start: 7, end: 16 },
      { type: "text", content: " now", start: 16, end: 20 },
    )
    const submit = createPromptSubmit({
      prompt,
      info: () => ({ id: "session-existing" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
    })

    expect(createdSessions).toEqual([])
    expect(optimistic).toEqual([])
    expect(sentShell).toEqual([])
    const event = new Event("submit", { cancelable: true })
    await submit.handleSubmit(event)
    const sent = await sentPrompt.promise

    expect(event.defaultPrevented).toBe(true)
    expect(sent).toMatchObject({ sessionID: "session-existing", agent: "agent" })
    expect(sent.parts.map((part) => part.type)).toEqual(["text", "agent"])
    expect(sent.parts[1]).toMatchObject({
      type: "agent",
      name: "reviewer",
      source: { value: "@reviewer", start: 7, end: 16 },
    })
    expect(optimistic).toHaveLength(1)
    expect(optimistic[0]).toMatchObject({ sessionID: "session-existing", message: { agent: "agent" } })
    expect(createdSessionRequests).toEqual([])
    expect(createdSessions).toEqual([])
    expect(sentShell).toEqual([])
  })
})
