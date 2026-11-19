import type { SessionUserActions } from "@aigcfroge/session-ui/message"
import { getFilename, sameDirectory } from "@aigcfroge/util/path"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { isScrollKeyTarget, scrollKey, scrollKeyOwner } from "@aigcfroge/ui/scroll-view"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, on, onMount, Show, type Accessor, type JSX } from "solid-js"
import { Composer } from "@/composer/composer"
import { useComposerState } from "@/composer/persistence"
import { createComposerControls } from "@/composer/selection"
import { setCursorPosition } from "@/composer/editor/dom"
import { promptLength } from "@/composer/prompt-parts"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { showToast } from "@/shell/notifications/toast"
import { useLocal } from "@/providers/models/selection"
import { usePlatform } from "@/runtime/platform/platform"
import { useWorkspaceLocation } from "@/workspaces/location"
import { requireServerKey, sessionHref } from "@/shell/routes/session"
import { useComposerCommands } from "@/composer/commands"
import { useSessionCommands } from "../commands/use-session-commands"
import type { SessionModel } from "../model"
import type { SessionScreenLayout } from "../screen-layout"
import { syncPromptModel } from "../session-model-helpers"
import type { SessionTimelineInteraction } from "../timeline/interaction"
import { createSessionRevert } from "../revert"
import { SessionComposerRegion } from "./session-composer-region"
import { createSessionComposerController, type SessionComposerController } from "./controller"
import { SessionQueuePanel } from "./queue-panel"
import { SessionTodoDock } from "./session-todo-dock"
import { SessionGoalDock } from "./session-goal-dock"
import { resolveSessionComposerSelection } from "./selection"
import { createSessionRequestModel } from "../requests/model"
import type { Region } from "@/runtime/extension/panels"
import { SessionLocationMissing } from "./location-missing"
import { useSessionContent } from "../content-context"

export function createActiveSessionRegion(input: {
  session: SessionModel
  screen: Pick<SessionScreenLayout, "centered">
  timeline: SessionTimelineInteraction
  region?: Region
  visible: Accessor<boolean>
  boundary: Accessor<HTMLElement | undefined>
}) {
  const command = useCommand()
  const data = useData()
  const server = useServerSDK()
  const dialog = useDialog()
  const language = useLanguage()
  const local = useLocal()
  const location = useWorkspaceLocation()
  const navigate = useNavigate()
  const platform = usePlatform()
  const prompt = useComposerState()
  const content = useSessionContent()
  const state = createSessionRequestModel()
  const controls = createComposerControls()
  let promptRef: HTMLDivElement | undefined

  createEffect(
    on(
      () => [input.timeline.lastUserMessage(), input.session.data.info()] as const,
      () => {
        const message = input.timeline.lastUserMessage()
        const info = input.session.data.info()
        const selection = resolveSessionComposerSelection(info, message?.metadata)

        if (info && selection.agent && selection.model) {
          local.session.restore({ sessionID: info.id, agent: selection.agent, model: selection.model })
        }
      },
    ),
  )
  createEffect(() => {
    const id = input.session.identity.params.id

    if (!id || !prompt.ready() || !local.session.ready()) return
    // Prompt model is a submission mirror. Local drafts and durable session state own selection.
    syncPromptModel(local, prompt)
  })
  createEffect(
    on(
      () => ({ directory: location().directory, id: input.session.identity.params.id }),
      (next, previous) => {
        if (!previous || (next.directory === previous.directory && next.id === previous.id)) return

        if (previous.id && !next.id) local.session.reset()
      },
      { defer: true },
    ),
  )

  const openAttachment: NonNullable<SessionUserActions["openAttachment"]> = (file) => {
    const url = file.source.type === "uri" ? file.source.uri : `data:${file.mime};base64,${file.data}`

    const download = () => {
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = getFilename(file.name) || "attachment"
      anchor.click()
    }

    const path = file.name ?? ""
    const absolute = path.startsWith("/") || path.startsWith("\\\\") || /^[a-zA-Z]:[\\/]/.test(path)

    if (!platform.revealPath || !absolute) return download()
    void platform.revealPath(path).then((revealed) => {
      if (!revealed) download()
    }, download)
  }

  const focus = () => {
    if (!input.session.data.isChild() && content?.interaction !== "readonly" && input.visible()) promptRef?.focus()
  }

  const openParent = () => {
    const id = input.session.data.parentID()

    if (!id) return

    if (content) return content.openSession(id)
    navigate(sessionHref(requireServerKey(input.session.identity.params.serverKey), id))
  }

  const editable = (target: EventTarget | null | undefined) => {
    if (!(target instanceof HTMLElement)) return false

    return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName) || target.isContentEditable
  }

  const activeElement = () => {
    let current: Element | null = document.activeElement

    while (current instanceof HTMLElement && current.shadowRoot?.activeElement) {
      current = current.shadowRoot.activeElement
    }

    return current instanceof HTMLElement ? current : undefined
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!input.visible()) return

    if (event.defaultPrevented) return

    const path = event.composedPath()
    const target = path.find((item): item is HTMLElement => item instanceof HTMLElement)
    const active = activeElement()

    if (
      path.some((item) => item instanceof HTMLElement && item.closest("[data-prevent-autofocus]") !== null) ||
      editable(target) ||
      (active && (active.closest("[data-prevent-autofocus]") || editable(active))) ||
      dialog.active
    ) {
      return
    }

    if (event.key === "Escape" && input.session.data.isChild()) {
      event.preventDefault()
      openParent()

      return
    }

    if (active === promptRef) {
      if (event.key === "Escape") promptRef?.blur()

      return
    }

    const key = scrollKey(event)

    if (key) {
      const scroller = input.timeline.scroller()

      if (!scroller || !isScrollKeyTarget(target ?? null, key)) return

      if (scrollKeyOwner(scroller, target ?? null, key) !== scroller) return
      input.timeline.view.markUserScroll(scroller)

      return
    }

    if (event.key.length !== 1 || event.key === "Unidentified" || event.ctrlKey || event.metaKey) return

    if (state.blocked() || input.session.data.isChild() || !promptRef) return
    promptRef.focus()
    setCursorPosition(promptRef, prompt.cursor() ?? promptLength(prompt.current()))
  }

  if (!content) onMount(() => makeEventListener(document, "keydown", handleKeyDown))

  const revert = createSessionRevert({
    session: input.session,
    setActiveMessage: input.timeline.actions.setActiveMessage,
  })

  const revertMessage: NonNullable<SessionUserActions["revert"]> = ({ messageID }) => revert.to(messageID)

  const notifyFailed = () => {
    showToast({ title: language.t("common.requestFailed") })
  }

  const pendingSteer: NonNullable<SessionUserActions["pending"]> = {
    status: (messageID) => {
      const sessionID = input.session.identity.params.id

      return sessionID ? data.session.pending.status(sessionID, messageID) : undefined
    },
    queue: ({ sessionID, messageID }) =>
      server.api.session.inbox
        .update({ sessionID, inboxID: messageID, delivery: "queue" })
        .then(() => undefined, notifyFailed),
    remove: ({ sessionID, messageID }) =>
      server.api.session.inbox.cancel({ sessionID, inboxID: messageID }).then(() => undefined, notifyFailed),
  }

  const composerCommands = useComposerCommands({ register: !content, editor: () => promptRef })

  const sessionCommands = useSessionCommands(
    {
      session: input.session,
      region: input.region,
      background: {
        blocking: () => state.background.blocking().length > 0,
        move: state.background.move,
      },
      navigateMessageByOffset: input.timeline.actions.navigateMessage,
      revert,
      focusInput: focus,
      model: () => {
        const selection = controls().model.selection
        const model = selection.current()

        return model ? { id: model.id, providerID: model.provider.id, variant: selection.variant.current() } : undefined
      },
    },
    { register: !content },
  )

  if (!content && input.region) {
    command.register("session-palette", () => [
      {
        id: "command.palette",
        title: language.t("command.palette"),
        hidden: true,
        onSelect: () => command.trigger("file.open", "palette"),
      },
    ])
  }

  const dock = {
    state,
    commands: content ? () => [...composerCommands(), ...sessionCommands()] : undefined,
    readonly: () => content?.interaction === "readonly",
    acceptsDrop: (event: DragEvent) => {
      if (!input.visible() || input.session.data.isChild() || content?.interaction === "readonly" || state.blocked())
        return false
      const target = event.target instanceof Element ? event.target : undefined
      // A content panel includes its heading. Other panels keep the main composer's existing drop behavior.

      const boundary =
        target?.closest('[role="tabpanel"]')?.querySelector("[data-session-content]") ??
        target?.closest("[data-session-content]")

      return boundary ? boundary === input.boundary() : !content
    },
    parentID: input.session.data.parentID,
    centered: input.screen.centered,
    onResponseSubmit: input.timeline.actions.resume,
    openParent,
    setPromptRef: (element: HTMLDivElement) => {
      promptRef = element
    },
    setDockRef: input.timeline.view.setDockRef,
  }

  const active = createMemo(
    on(input.session.identity.sessionID, (sessionID) =>
      sessionID ? createSessionComposerController({ sessionID, controls, dock }) : undefined,
    ),
  )

  return {
    active,
    commands: sessionCommands,
    drop: {
      active: () => input.visible() && (active()?.drop.active() ?? false),
      input: () => active()?.drop.input(),
    },
    actions: {
      timeline: {
        get revert() {
          if (input.session.data.isChild() || content?.interaction === "readonly") return

          return revertMessage
        },
        get pending() {
          if (input.session.data.isChild() || content?.interaction === "readonly") return

          return pendingSteer
        },
        openAttachment,
      } satisfies SessionUserActions,
    },
    requests: state,
  }
}

export type ActiveSessionRegionModel = ReturnType<typeof createActiveSessionRegion>

export function ActiveSessionComposerRegion(props: {
  session: SessionModel
  model: SessionComposerController
  suggestionBoundary: () => HTMLElement | undefined
  onOpenTaskSource?: Parameters<typeof SessionTodoDock>[0]["onOpenSource"]
  onOpenTask?: (taskID: string) => void
  tools?: JSX.Element
}) {
  const location = useWorkspaceLocation()

  // Only the server's LocationNotFoundError for the session's own Location replaces the composer.
  const missing = createMemo(() => {
    const ref = location().missing
    const info = props.session.data.info()

    if (!ref || !info || !sameDirectory(info.location.directory, ref.directory)) return

    return { directory: info.location.directory, sessionID: info.id, projectID: info.projectID }
  })

  return (
    <SessionComposerRegion
      controller={props.model.region}
      tasks={
        <Show when={props.session.identity.sessionID()} keyed>
          {(sessionID) => (
            <SessionTodoDock
              sessionID={sessionID}
              onOpenSource={props.onOpenTaskSource}
              onOpenTask={props.onOpenTask}
            />
          )}
        </Show>
      }
      goal={
        <Show when={props.session.identity.sessionID()} keyed>
          {(sessionID) => (
            <SessionGoalDock
              sessionID={sessionID}
              readonly={props.model.region.child() || props.model.region.readonly?.()}
            />
          )}
        </Show>
      }
      composer={
        <Show
          when={missing()}
          keyed
          fallback={
            <div class="relative">
              <SessionQueuePanel queue={props.model.queue} />
              <div class="relative z-10">
                <Composer
                  model={props.model.composer}
                  borderUnderlay
                  readOnly={props.model.queue.undoing()}
                  suggestionBoundary={props.suggestionBoundary}
                  tools={props.tools}
                />
              </div>
            </div>
          }
        >
          {(current) => (
            <SessionLocationMissing
              sessionID={current.sessionID}
              projectID={current.projectID}
              directory={current.directory}
            />
          )}
        </Show>
      }
    />
  )
}
