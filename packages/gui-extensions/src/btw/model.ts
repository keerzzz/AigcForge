import { batch, createRoot, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { errorMessage } from "@omnixa/util/error"
import { showToast } from "@omnixa/ui/toast"
import type { SessionForkBoundary, SessionGetConsultationOutput, SessionMessageAssistant } from "@omnixa/client/promise"
import {
  createKeyed,
  type MountedSession,
  type Mutable,
  type ServerRef,
  type SessionTargetRef,
  type SetupContext,
} from "../sdk"
import type Btw from "./index"
import type { BtwChat } from "./index"

export type FirstQuestionState =
  | SessionGetConsultationOutput["admission"]
  | { state: "missing" | "unsubmitted" | "unknown" }

/** Source-owned view bindings. Conversation execution and drafts belong to the target Session. */
export function createBtw(ctx: SetupContext<typeof Btw>) {
  const [requests, setRequests] = createStore<{ pending: string[] }>({ pending: [] })
  const saved = (session: MountedSession) => ctx.stores.chats(session)
  const entry = (session: MountedSession, id: string) => saved(session).value?.chats.find((chat) => chat.id === id)
  const key = (session: MountedSession, id: string) => session.key + "\n" + id
  const pending = (session: MountedSession, id: string) => requests.pending.includes(key(session, id))

  const live = (server: ServerRef, client: ServerRef["client"], data: ServerRef["data"], attempt: number) => {
    const current = ctx.servers.get(server.id)

    return (
      !ctx.signal.aborted &&
      !!current &&
      current.client === client &&
      current.data === data &&
      current.attempt === attempt
    )
  }

  const failure = (session: MountedSession, id: string, message: string) => {
    saved(session).update((draft) => {
      const chat = draft.chats.find((item) => item.id === id)

      if (chat) chat.error = message
    })
  }

  // Only explicit actions wait for an IPC store load. Restoring saved tabs never schedules this work.
  const ready = (session: MountedSession) => {
    const store = saved(session)

    if (store.ready() || ctx.signal.aborted) return Promise.resolve(!ctx.signal.aborted)

    return new Promise<boolean>((resolve) =>
      createRoot((dispose) => {
        const abort = () => {
          dispose()
          resolve(false)
        }

        ctx.signal.addEventListener("abort", abort, { once: true })
        onCleanup(() => ctx.signal.removeEventListener("abort", abort))
        createKeyed(
          () => store.ready(),
          () => {
            resolve(true)
            dispose()
          },
        )
      }),
    )
  }

  const target = (session: MountedSession, id: string) => {
    const chat = entry(session, id)
    const server = chat?.intent ? ctx.servers.get(chat.intent.serverID) : undefined

    return chat?.intent && chat.request && server
      ? ctx.sessions.target({ server, sessionID: chat.intent.targetID })
      : undefined
  }

  const reading = (session: MountedSession, id: string) => {
    const current = target(session, id)
    const message = current?.server.data.session.message.list(current.id).findLast((item) => item.type === "assistant")

    return message
      ? {
          messageID: message.id,
          length: message.content.reduce(
            (length, content) =>
              length + (content.type === "text" || content.type === "reasoning" ? content.text.length : 0),
            0,
          ),
          completed: message.time.completed !== undefined,
        }
      : undefined
  }

  const markRead = (session: MountedSession, id: string) => {
    const read = reading(session, id)

    if (!read) return
    saved(session).update((draft) => {
      const chat = draft.chats.find((item) => item.id === id)

      if (chat) chat.read = read
    })
  }

  const open = (session: MountedSession, id: string) => {
    markRead(session, id)
    ctx.layout.open(ctx.id + ":" + id, session, { tab: ctx.layout.narrow() ? "open" : "select" })
  }

  const legacyMaterial = (session: MountedSession, id: string) => {
    const chat = entry(session, id)

    return [
      "Legacy BTW client material / 旧版BTW客户端材料",
      "Saved in the client; not verified as a server source reference.",
      "由客户端保存，未由服务参考核验。",
      "",
      "Question / 问题",
      chat?.question ?? "",
      "",
      "Answer / 回答",
      chat?.answer ?? "(No saved answer / 无保存的回答)",
    ].join("\n")
  }

  // Reuse the Timeline's completion rule only after an explicit slash/legacy action.
  const latestBoundary = async (source: SessionTargetRef) => {
    const server = source.server
    const client = server.client
    const data = server.data
    const attempt = server.attempt
    const { createTimelineProjection } = await import("@omnixa/session-ui/timeline/projection")

    if (!live(server, client, data, attempt)) return
    await data.session.message.sync(source.id)

    if (!live(server, client, data, attempt)) return

    return [
      ...createTimelineProjection({
        sessionMessages: data.session.message.list(source.id),
        status: data.session.status(source.id) === "running" ? { type: "busy" } : { type: "idle" },
        reasoningMode: "hidden",
        pendingInputIDs: new Set(data.session.pending.list(source.id).map((item) => item.id)),
      }).responseByParent.values(),
    ].findLast((group) => group.completed)?.boundary
  }

  const draft = async (input: {
    source: MountedSession
    target: SessionTargetRef
    boundary?: SessionForkBoundary
    question?: string
    legacyID?: string
  }) => {
    const captured = {
      source: input.source,
      server: input.target.server,
      sourceSessionID: input.target.id,
      location: input.target.location ? { ...input.target.location } : undefined,
      boundary: input.boundary ? { ...input.boundary } : undefined,
      question: input.question ?? "",
      legacyID: input.legacyID,
    }

    const client = captured.server.client
    const data = captured.server.data
    const attempt = captured.server.attempt

    if (!captured.server.connected || !captured.location) {
      showToast({ title: ctx.t("source.unavailable") })

      return
    }

    const [{ SessionID }, { SessionMessage }] = await Promise.all([
      import("@omnixa/schema/session-id"),
      import("@omnixa/schema/session-message"),
    ])

    if (!live(captured.server, client, data, attempt)) return

    if (!(await ready(captured.source)) || !live(captured.server, client, data, attempt)) return
    const id = crypto.randomUUID()

    batch(() => {
      saved(captured.source).update((store) => {
        store.chats.push({
          id,
          question: captured.question,
          legacyID: captured.legacyID,
          intent: {
            serverID: captured.server.id,
            sessionID: captured.sourceSessionID,
            boundary: captured.boundary,
            location: captured.location,
            targetID: SessionID.create(),
            firstID: SessionMessage.ID.create(),
          },
        })
      })
      open(captured.source, id)
    })

    return id
  }

  const send = async (session: MountedSession, id: string, request: NonNullable<BtwChat["request"]>) => {
    const chat = entry(session, id)

    if (!chat?.intent) return
    const intent = { ...chat.intent }
    const server = ctx.servers.get(intent.serverID)

    if (!server?.connected) throw new Error(ctx.t("server.unavailable"))
    const client = server.client
    const data = server.data
    const attempt = server.attempt

    if (request.kind === "consultation") {
      const result = await client.session.createConsultation(
        { sourceSessionID: intent.sessionID, ...request.input },
        { signal: ctx.signal },
      )

      if (!live(server, client, data, attempt)) return
      data.session.remember(result.session)
      data.session.message.invalidate(result.session.id)
      saved(session).update((store) => {
        const current = store.chats.find((item) => item.id === id)

        if (current) {
          current.admitted = true
          current.error = undefined
        }
      })
      await data.session.message.sync(result.session.id)

      return
    }

    // The legacy fallback has two HTTP boundaries. Persist the send attempt before prompt admission.
    const created = await client.session.create(
      {
        id: intent.targetID,
        mode: "chat",
        agent: request.input.agent,
        model: request.input.model,
        location: request.input.location,
        title: chat.question,
      },
      { signal: ctx.signal },
    )

    if (!live(server, client, data, attempt)) return
    data.session.remember(created)
    saved(session).update((store) => {
      const current = store.chats.find((item) => item.id === id)

      if (current) current.attempted = true
    })
    await client.session.prompt(
      { sessionID: intent.targetID, id: intent.firstID, ...request.input.prompt },
      { signal: ctx.signal },
    )

    if (!live(server, client, data, attempt)) return
    saved(session).update((store) => {
      const current = store.chats.find((item) => item.id === id)

      if (current) {
        current.admitted = true
        current.error = undefined
      }
    })
  }

  const submit = async (session: MountedSession, id: string) => {
    const chat = entry(session, id)

    if (!chat?.intent || chat.request || pending(session, id)) return
    const question = chat.question.trim()

    if (!question) {
      showToast({ title: ctx.t("question.required") })

      return
    }

    const intent = { ...chat.intent, boundary: chat.intent.boundary ? { ...chat.intent.boundary } : undefined }
    const server = ctx.servers.get(intent.serverID)
    const location = server?.data.session.get(intent.sessionID)?.location ?? intent.location

    if (!server?.connected || !location) {
      failure(session, id, ctx.t("source.unavailable"))

      return
    }

    const client = server.client
    const data = server.data
    const attempt = server.attempt
    const material = chat.legacyID ? legacyMaterial(session, chat.legacyID) : undefined
    setRequests("pending", (items) => [...items, key(session, id)])

    try {
      await data.location.agent.sync(location)

      if (!live(server, client, data, attempt)) return

      const agents =
        data.location.agent
          .list(location)
          ?.filter(
            (agent) =>
              agent.id !== "meta" &&
              agent.mode !== "subagent" &&
              !agent.hidden &&
              (agent.ordinaryModes === undefined || agent.ordinaryModes.includes("chat")),
          ) ?? []

      const source = data.session.get(intent.sessionID)
      const agent = agents.find((item) => item.id === (source?.executorPreference?.agent ?? source?.agent)) ?? agents[0]

      if (!agent) throw new Error(ctx.t("agent.unavailable"))

      const model = source?.executorPreference?.model ?? source?.model

      const prompt = {
        text: question,
        files: material
          ? [
              {
                uri: "data:text/plain;charset=utf-8," + encodeURIComponent(material),
                name: "legacy-btw-" + chat.legacyID + ".txt",
                description: ctx.t("legacy.material"),
              },
            ]
          : [],
      }

      const request = (
        intent.boundary
          ? {
              kind: "consultation",
              input: {
                id: intent.targetID,
                boundary: intent.boundary,
                agent: agent.id,
                model,
                title: question,
                prompt: { id: intent.firstID, ...prompt },
              },
            }
          : {
              kind: "legacy",
              input: {
                agent: agent.id,
                model,
                location: { ...location },
                prompt,
              },
            }
      ) satisfies Mutable<NonNullable<BtwChat["request"]>>

      if (!intent.boundary && !chat.legacyID) throw new Error(ctx.t("boundary.required"))
      saved(session).update((store) => {
        const current = store.chats.find((item) => item.id === id)

        if (current) {
          current.question = question
          current.request = request
          current.error = undefined
        }
      })
      await send(session, id, request)

      if (!live(server, client, data, attempt)) return
    } catch (error) {
      if (live(server, client, data, attempt)) failure(session, id, errorMessage(error, ctx.t("common.requestFailed")))
    } finally {
      if (!ctx.signal.aborted) setRequests("pending", (items) => items.filter((item) => item !== key(session, id)))
    }
  }

  const first = async (
    session: MountedSession,
    id: string,
    signal: AbortSignal,
  ): Promise<FirstQuestionState | undefined> => {
    const chat = entry(session, id)

    if (!chat?.intent || !chat.request) return
    const intent = { ...chat.intent }
    const server = ctx.servers.get(intent.serverID)

    if (!server?.connected) throw new Error(ctx.t("server.unavailable"))
    const client = server.client
    const data = server.data
    const attempt = server.attempt

    try {
      if (chat.request.kind === "consultation") {
        const result = await client.session.getConsultation({ sessionID: intent.targetID }, { signal })

        if (signal.aborted || !live(server, client, data, attempt)) return

        if (result.admission.state !== "reserved" && !chat.admitted)
          saved(session).update((store) => {
            const current = store.chats.find((item) => item.id === id)

            if (current) current.admitted = true
          })

        return result.admission
      }

      const info = await client.session.get({ sessionID: intent.targetID }, { signal })

      if (signal.aborted || !live(server, client, data, attempt)) return
      data.session.remember(info)

      const [inputs, message] = await Promise.all([
        client.session.inbox.list({ sessionID: intent.targetID }, { signal }),
        client.session.message
          .get({ sessionID: intent.targetID, messageID: intent.firstID }, { signal })
          // oxlint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: only the declared Error name is consumed; all other rejections are rethrown.
          .catch((error: unknown) => {
            if (error instanceof Error && error.name === "MessageNotFoundError") return
            throw error
          }),
      ])

      if (signal.aborted || !live(server, client, data, attempt)) return
      const input = inputs.find((item) => item.id === intent.firstID && item.type === "user")

      if ((input?.type === "user" || message?.type === "user") && !chat.admitted)
        saved(session).update((store) => {
          const current = store.chats.find((item) => item.id === id)

          if (current) current.admitted = true
        })

      if (input?.type === "user") return { state: "pending", input }

      if (message?.type === "user") return { state: "promoted", input: message }

      return { state: chat.attempted ? "unknown" : "unsubmitted" }
    } catch (error) {
      if (signal.aborted || !live(server, client, data, attempt)) return

      if (error instanceof Error && error.name === "SessionNotFoundError") return { state: "missing" }
      throw error
    }
  }

  const retry = async (session: MountedSession, id: string) => {
    const chat = entry(session, id)
    const current = target(session, id)

    if (!chat?.request || !current || pending(session, id)) return
    const client = current.server.client
    const data = current.server.data
    const attempt = current.server.attempt
    setRequests("pending", (items) => [...items, key(session, id)])

    try {
      const state = await first(session, id, ctx.signal)

      if (!live(current.server, client, data, attempt) || !state) return

      if (state.state === "cancelled" || state.state === "promoted" || state.state === "unknown") return

      if (state.state === "missing" && (chat.admitted || chat.attempted)) return

      if (state.state === "pending" && data.session.status(current.id) !== "idle") return

      if (state.state === "pending" && chat.request.kind === "legacy") {
        await client.session.background({ sessionID: current.id }, { signal: ctx.signal })

        if (!live(current.server, client, data, attempt)) return

        return
      }

      await send(session, id, chat.request)

      if (!live(current.server, client, data, attempt)) return
    } catch (error) {
      if (live(current.server, client, data, attempt))
        failure(session, id, errorMessage(error, ctx.t("common.requestFailed")))
    } finally {
      if (!ctx.signal.aborted) setRequests("pending", (items) => items.filter((item) => item !== key(session, id)))
    }
  }

  return {
    saved,
    entry,
    pending,
    target,
    markRead,
    open,
    draft,
    submit,
    first,
    retry,
    title: (session: MountedSession, id: string) =>
      target(session, id)?.server.data.session.get(target(session, id)?.id ?? "")?.title ||
      entry(session, id)?.question ||
      ctx.t("tab.title"),
    unread: (session: MountedSession, id: string) => {
      const current = reading(session, id)
      const read = entry(session, id)?.read

      return (
        !!current &&
        (current.messageID !== read?.messageID ||
          current.length !== read?.length ||
          current.completed !== read?.completed)
      )
    },
    edit: (session: MountedSession, id: string, question: string) =>
      saved(session).update((store) => {
        const chat = store.chats.find((item) => item.id === id)

        if (chat && !chat.request) chat.question = question
      }),
    ask: async (value?: string) => {
      const question = value?.trim()

      if (!question) {
        showToast({ title: ctx.t("question.required") })

        return
      }

      const source = ctx.sessions.current()

      if (!source) return
      const current = ctx.sessions.target({ server: source.server, sessionID: source.id })

      try {
        const boundary = await latestBoundary(current)

        if (ctx.signal.aborted) return

        if (!boundary) {
          showToast({ title: ctx.t("boundary.required") })

          return
        }

        const id = await draft({ source, target: current, boundary, question })

        if (ctx.signal.aborted || !id) return
        await submit(source, id)

        if (ctx.signal.aborted) return
      } catch (error) {
        if (!ctx.signal.aborted) showToast({ title: errorMessage(error, ctx.t("common.requestFailed")) })
      }
    },
    continueLegacy: async (session: MountedSession, id: string) => {
      const chat = entry(session, id)

      if (!chat || chat.intent) return
      const source = ctx.sessions.target({ server: session.server, sessionID: session.id })

      try {
        const boundary = await latestBoundary(source)

        if (ctx.signal.aborted) return
        await draft({ source: session, target: source, boundary, question: chat.question, legacyID: id })

        if (ctx.signal.aborted) return
      } catch (error) {
        if (!ctx.signal.aborted) showToast({ title: errorMessage(error, ctx.t("common.requestFailed")) })
      }
    },
    answer: (session: MountedSession, id: string) => {
      const chat = entry(session, id)

      if (!chat?.intent) return chat?.answer
      const current = target(session, id)

      return current?.server.data.session.message
        .list(current.id)
        .findLast(
          (item): item is SessionMessageAssistant =>
            item.type === "assistant" &&
            item.content.some((content) => content.type === "text" && content.text.trim().length > 0),
        )
        ?.content.flatMap((item) => (item.type === "text" ? [item.text] : []))
        .join("\n\n")
    },
    reference: async (session: MountedSession, id: string, signal: AbortSignal) => {
      const chat = entry(session, id)
      const current = target(session, id)

      if (!chat?.request || !current) return

      if (chat.request.kind === "legacy")
        return { kind: "legacy" as const, text: legacyMaterial(session, chat.legacyID ?? id) }
      const client = current.server.client
      const data = current.server.data
      const attempt = current.server.attempt
      const result = await client.session.getConsultation({ sessionID: current.id }, { signal })

      if (signal.aborted || !live(current.server, client, data, attempt)) return

      return { kind: "consultation" as const, reference: result.reference }
    },
    insert: async (session: MountedSession, id: string, text: string) => {
      const intent = entry(session, id)?.intent
      const server = intent ? ctx.servers.get(intent.serverID) : undefined

      if (!intent || !server) throw new Error(ctx.t("source.unavailable"))
      await ctx.sessions.insertText({ target: ctx.sessions.target({ server, sessionID: intent.sessionID }), text })

      if (ctx.signal.aborted) return
    },
  }
}

export type BtwModel = ReturnType<typeof createBtw>
