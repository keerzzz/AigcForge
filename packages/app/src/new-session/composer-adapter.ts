import { Predicate } from "effect"
import { base64Encode } from "@aigcfroge/util/encode"
import { ClientError, type SessionMessageUser } from "@aigcfroge/client/promise"
import { Session } from "@aigcfroge/schema/session"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { createEffect, onCleanup, startTransition } from "solid-js"
import type { NewSessionComposerAdapter } from "@/composer/adapter"
import { useComposerState } from "@/composer/persistence"
import { createComposerControls, createComposerModelSelection } from "@/composer/selection"
import { createComposerProjectControls } from "./project/controller"
import { useLanguage } from "@/runtime/i18n/language"
import { useLocal } from "@/providers/models/selection"
import { useData, useServer } from "@/runtime/server/current"
import { type ServerSDK, useServerSDK } from "@/runtime/server/client"
import { useTabs } from "@/shell/tabs/tabs"
import { useWorkspaceLocation } from "@/workspaces/location"
import { createWorktree } from "@/workspaces/create"
import { showToast } from "@/shell/notifications/toast"
import { SessionRouteKey, SessionStateKey } from "@/runtime/server/scope"
import { clearSessionMessageHandoff, setSessionMessageHandoff } from "@/session/handoff"
import type { DraftMcpControls } from "./mcp"
import { toSelection } from "@/providers/models/key"

export function createNewSessionComposerAdapter(props: {
  draftID: string
  mode: () => ProductMode.GenericSessionMode | undefined
  worktree: () => string
  branch: () => string | undefined
  submitted: () => void
  mcp: DraftMcpControls
}) {
  const prompt = useComposerState()
  const state = prompt.capture()
  const local = useLocal()
  const data = useData()
  const server = useServer()
  const serverSDK = useServerSDK()
  const tabs = useTabs()
  const location = useWorkspaceLocation()
  const language = useLanguage()
  const model = createComposerModelSelection({ draftID: props.draftID })
  createEffect(() => {
    if (!prompt.ready() || !local.session.ready()) return
    const initial = prompt.model.current()
    local.session.bindDraft(
      props.draftID,
      !initial || "type" in initial ? initial : { ...initial, variant: initial.variant ?? undefined },
    )
  })
  let disposed = false
  let generation = 0
  onCleanup(() => {
    disposed = true
  })
  const controls = createComposerControls({ model })

  const adapter: NewSessionComposerAdapter = {
    kind: "new-session",
    state,
    ready: prompt.ready,
    controls,
    working: () => false,
    submitted: props.submitted,
    async start(selection, submission, message) {
      const mode = props.mode()

      if (!mode) {
        showToast({
          variant: "error",
          title: language.t("prompt.toast.sessionCreateFailed.title"),
          description: language.t("newSession.mode.unsupported"),
        })

        return
      }

      const attempt = ++generation
      const draftID = props.draftID
      const owner = serverSDK.api
      const draftLocation = tabs.draft(draftID).location
      const savedLocation = draftLocation ? { ...draftLocation } : undefined
      const currentDirectory = location().directory

      const projectDirectory =
        data.location.info({ directory: currentDirectory })?.project.canonical ?? currentDirectory

      const worktree = props.worktree()
      const branch = props.branch()
      const mcp = props.mcp.capture()
      const id = Session.ID.create()

      const pending =
        worktree === "create"
          ? tabs.prepareSession(draftID, { server: server.key, sessionId: id }, { message, selection })
          : undefined

      const owned = () => attempt === generation && owner === serverSDK.api
      // A worktree submission transfers to the pending Session when navigation disposes this draft.
      const current = () => owned() && (pending ? !!tabs.pendingSession(server.key, id) : !disposed)

      const requireOwner = () => {
        if (!owned()) throw new ClientError("Transport", { detail: "Session submission owner changed" })
      }

      await pending?.ready

      if (!current()) return

      const sessionDirectory =
        savedLocation?.directory ??
        (await resolveSessionDirectory({
          projectDirectory,
          worktree,
          branch,
          data,
          serverSDK,
          language,
        }))

      if (!current()) return

      if (!sessionDirectory) {
        await pending?.rollback()

        return
      }

      const rollback = async () => {
        if (!pending) return
        data.project.invalidate()
        await data.project.sync().catch(() => undefined)
        await pending.rollback(sessionDirectory)
      }

      const prepared = await props.mcp.prepare(sessionDirectory, mcp)

      if (!current()) return

      if (!prepared) {
        await rollback()

        if (pending) props.mcp.remember(sessionDirectory, mcp)

        return
      }

      const created = data.session.create({
        id,
        mode,
        agent: selection.agent,
        executorPreference: selection.executorPreference,
        model: toSelection(selection.model, selection.variant),
        location: savedLocation ?? { directory: sessionDirectory },
      })

      const creation = created.request.then(
        () => ({ ok: true as const }),
        (error) => {
          if (!current()) return { ok: false as const, error }
          showToast({
            title: language.t("prompt.toast.sessionCreateFailed.title"),
            description: errorMessage(language, error),
          })

          return { ok: false as const, error }
        },
      )

      const canonical = await creation

      if (!current()) return

      if (!canonical.ok) {
        await rollback()

        return
      }

      const afterCreation = async <T>(run: () => Promise<T>) => {
        const result = await creation

        if (!result.ok) throw result.error
        requireOwner()
        const value = await run()
        requireOwner()

        return value
      }

      const sessionKey = SessionStateKey.from(
        serverSDK.scope,
        SessionRouteKey.fromRoute(base64Encode(sessionDirectory), created.id),
      )

      const transferred = Promise.withResolvers<boolean>()

      const cleanupReady = startTransition(() => {
        if (!current()) {
          transferred.resolve(false)

          return
        }

        if (!pending) tabs.updateDraft(draftID, { worktree: undefined, branch: undefined })
        local.session.promote(sessionDirectory, created.id, {
          agent: selection.agent,
          model: selection.model,
          variant: selection.variant ?? null,
          choices: model.remembered(),
          executorPreference: selection.executorPreference,
        })

        if (!pending) tabs.promoteDraft(draftID, { server: server.key, sessionId: created.id })
        submission.retarget(
          prompt.capture(
            { dir: base64Encode(sessionDirectory), id: created.id },
            { server: server.key, scope: serverSDK.scope },
          ),
          { preserveDraft: !!pending },
        )
        transferred.resolve(true)
      })

      // Admission needs the transfer callback; full transition cleanup still follows the first send.
      void cleanupReady.catch(transferred.reject)

      if (!(await transferred.promise) || !owned()) return

      return {
        cleanupReady,
        complete: pending ? () => pending.complete(submission.target()) : undefined,
        trackSessionCommit: (sessionID, selection) =>
          local.model.trackSessionCommit(sessionID, selection, () => sessionID === created.id && owned()),
        session: {
          id: created.id,
          directory: sessionDirectory,
          handoff: createMessageHandoff(sessionKey, created.id, serverSDK.event),
          api: {
            command: (input) => afterCreation(() => owner.session.command(input)),
            shell: (input) => afterCreation(() => owner.session.shell(input)),
            switchAgent: (input) => afterCreation(() => owner.session.switchAgent(input)),
            switchModel: (input) => afterCreation(() => owner.session.switchModel(input)),
            selectExecutor: (input) => afterCreation(() => owner.session.selectExecutor(input)),
            revert: { commit: (input) => afterCreation(() => owner.session.revert.commit(input)) },
          },
          data: {
            location: data.location,
            session: {
              setStatus: (sessionID, status) => {
                if (!owned()) return
                data.session.setStatus(sessionID, status)
              },
              selectExecutor: (input) => afterCreation(() => data.session.selectExecutor(input)),
              invalidate: (sessionID) => {
                requireOwner()
                data.session.invalidate(sessionID)
              },
              sync: (sessionID, options) => afterCreation(() => data.session.sync(sessionID, options)),
              readback: (sessionID, options) =>
                afterCreation(async () => {
                  if (options?.children) return data.session.readback(sessionID, options)
                  const info = await owner.session.get({ sessionID })
                  requireOwner()

                  if (!data.session.get(sessionID)) return
                  // Keep the response independent of cache publication after the Draft transfers ownership.
                  data.session.remember(structuredClone(info))

                  return info
                }),
              prompt: (input) => {
                requireOwner()

                return data.session.prompt({
                  ...input,
                  gate: Promise.all([input.gate, afterCreation(async () => undefined)]),
                  prepare: () =>
                    afterCreation(async () => {
                      await input.prepare?.()
                    }),
                })
              },
            },
          },
          current: () => data.session.get(created.id),
          admitted: (messageID) =>
            data.session.input.has(created.id, messageID) || !!data.session.message.get(created.id, messageID),
        },
      }
    },
  }

  return {
    adapter,
    project: createComposerProjectControls({ draftId: props.draftID, worktree: props.worktree }),
    model,
    ready: prompt.ready,
  }
}

function createMessageHandoff(key: string, sessionID: string, event: ServerSDK["event"]) {
  let unsubscribe: VoidFunction | undefined

  return {
    set(message: SessionMessageUser) {
      unsubscribe?.()
      setSessionMessageHandoff(key, message)
      unsubscribe = event.on("session.inbox.enqueued", (item) => {
        if (item.data.sessionID !== sessionID || item.data.inboxID !== message.id) return
        unsubscribe?.()
        unsubscribe = undefined
        clearSessionMessageHandoff(key, message.id)
      })
    },
    clear(messageID: string) {
      unsubscribe?.()
      unsubscribe = undefined
      clearSessionMessageHandoff(key, messageID)
    },
  }
}

async function resolveSessionDirectory(input: {
  projectDirectory: string
  worktree: string
  branch?: string
  data: ReturnType<typeof useData>
  serverSDK: ReturnType<typeof useServerSDK>
  language: ReturnType<typeof useLanguage>
}) {
  if (input.worktree === "main") return input.projectDirectory

  if (input.worktree !== "create") return input.worktree

  return createWorktree({
    api: input.serverSDK.api,
    data: input.data,
    directory: input.projectDirectory,
    project: input.data.location.info({ directory: input.projectDirectory })?.project,
    branch: input.branch,
  }).catch((error) => {
    showToast({
      title: input.language.t("prompt.toast.worktreeCreateFailed.title"),
      description: errorMessage(input.language, error),
    })
  })
}

function errorMessage(language: ReturnType<typeof useLanguage>, cause: unknown) {
  if (Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message)) return cause.message

  if (
    Predicate.hasProperty(cause, "data") &&
    Predicate.hasProperty(cause.data, "message") &&
    Predicate.isString(cause.data.message) &&
    cause.data.message
  )
    return cause.data.message

  return language.t("common.requestFailed")
}
