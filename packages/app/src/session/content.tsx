import { ErrorBoundary, Show, createEffect, createMemo, on, onCleanup, untrack, type Accessor } from "solid-js"
import { Button } from "@omnixa/ui/button"
import { Icon } from "@omnixa/ui/icon"
import { IconButton } from "@omnixa/ui/icon-button"
import { base64Encode } from "@omnixa/util/encode"
import type { MountedSession, SessionScreen, SessionTargetRef, Sessions } from "@omnixa/gui-extensions/sdk"
import { ComposerDropzone } from "@/composer/dropzone"
import { CommentsProvider } from "@/composer/comments"
import { ComposerPersistenceProvider } from "@/composer/persistence"
import { ModelsProvider } from "@/providers/models/models"
import { useExtensionHost } from "@/runtime/extension/host"
import type { Region } from "@/runtime/extension/panels"
import { ExtensionSlot } from "@/runtime/extension/render"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerProvider, useData, useServer } from "@/runtime/server/current"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { errorMessage } from "@/shell/layout/helpers"
import { useCurrentRoute } from "@/shell/state/layout"
import { SessionUIProvider } from "@/shell/routes/session-ui-provider"
import { useTabs } from "@/shell/tabs/tabs"
import { showToast } from "@/shell/notifications/toast"
import { FileProvider } from "@/workspaces/files/model"
import { LocationProvider } from "@/workspaces/location"
import { ActiveSessionComposerRegion, createActiveSessionRegion } from "./composer/region"
import { SessionContentContext, useSessionContent } from "./content-context"
import { SessionRunningMenu } from "./header/session-running-menu"
import { useSessionModel, type SessionModel } from "./model"
import { sessionTreeIDs } from "./requests/session-request-tree"
import { SessionIdentityHeader } from "./session-identity-header"
import { createSessionResolution } from "./session-resolution"
import { createTimelineCache } from "./timeline/cache"
import { createSessionTimelineInteraction } from "./timeline/interaction"
import { MessageTimeline } from "./timeline/message-timeline"
import { TimelineSearchBar } from "./timeline/search-bar"
import { createTimelineSearchController } from "./timeline/search-controller"
import { SessionFooterNavigation } from "./footer-navigation"

/** One conversation implementation for the routed view and target views in source panels. */
export function createSessionContent(input: {
  session: SessionModel
  view?: Accessor<MountedSession>
  source?: Accessor<MountedSession>
  target?: Accessor<SessionTargetRef>
  screen?: SessionScreen
  region?: Region
  visible: Accessor<boolean>
  boundary: Accessor<HTMLElement | undefined>
  centered: Accessor<boolean>
  hideHeader: Accessor<boolean>
  reserveReviewToggle: Accessor<boolean>
}) {
  const embedded = useSessionContent()
  const language = useLanguage()
  const host = useExtensionHost()
  const timeline = createSessionTimelineInteraction(input.session)

  const binding = createMemo(() => {
    const source = input.source?.() ?? input.view?.()
    const target = input.target?.() ?? input.view?.()

    if (!input.screen || !source || !target) return

    return { screen: input.screen, source, target }
  })

  const search = createTimelineSearchController({
    sessionID: input.session.identity.sessionID,
    scrollRef: timeline.scroller,
    revealMessage: timeline.actions.revealMessage,
    pauseAutoScroll: timeline.view.unpin,
  })

  const searchView = () => (
    <Show when={input.visible()}>
      <Show when={embedded && !search.visible()}>
        <IconButton
          size="small"
          icon={<Icon name="magnifying-glass" />}
          aria-label={language.t("session.search.placeholder")}
          onClick={search.query.open}
        />
      </Show>
      <TimelineSearchBar controller={search} />
    </Show>
  )

  const composer = createActiveSessionRegion({
    session: input.session,
    screen: { centered: input.centered },
    timeline,
    region: input.region,
    boundary: input.boundary,
    visible: input.visible,
  })

  const timelineView = createTimelineCache(
    input.session,
    (source, active) => {
      // Cached main timelines retain their own mounted source. Target views have no shell descriptor.
      const view = input.view

      const own = view
        ? createMemo<MountedSession>((previous) => {
            const current = view()

            return current.id === source.identity.sessionID() ? current : previous
          }, untrack(view))
        : undefined

      const target = untrack(() => input.target?.() ?? own?.())

      return (
        <MessageTimeline
          active={active()}
          hideHeader={input.hideHeader()}
          session={source}
          view={own?.()}
          source={input.source?.() ?? own?.()}
          target={target}
          screen={input.screen}
          commands={() => (active() ? composer.commands() : [])}
          background={composer.requests.background}
          actions={composer.actions.timeline}
          scroll={timeline.scroll}
          onResumeScroll={timeline.actions.resume}
          setScrollRef={timeline.view.setScrollRef}
          onScheduleScrollState={timeline.view.scheduleScrollState}
          onPin={timeline.view.pin}
          onUnpin={timeline.view.unpin}
          onUserScroll={timeline.view.markUserScroll}
          onHistoryScroll={timeline.view.onHistoryScroll}
          onSelectionInteraction={timeline.view.selectionInteraction}
          pinned={timeline.view.pinned()}
          centered={input.centered()}
          reserveReviewToggle={input.reserveReviewToggle()}
          setContentRef={timeline.view.setContentRef}
          anchor={timeline.view.anchor}
          setRevealMessage={timeline.view.setRevealMessage}
          reveal={timeline.view.reveal}
          setScrollToEnd={timeline.view.setScrollToEnd}
          search={<Show when={active()}>{searchView()}</Show>}
        />
      )
    },
    () => input.visible() && timeline.ready(),
  )

  return {
    timeline,
    composer,
    ready: timeline.ready,
    searchView,
    dropzone: () => (
      <ComposerDropzone
        active={composer.drop.active()}
        input={composer.drop.input()}
        identity={input.session.layout.tabKey}
      />
    ),
    messages: () => (
      <>
        <Show when={!embedded && input.visible() && input.session.identity.sessionID()}>
          <Show when={input.session.identity.sessionKey()} keyed>
            {(_key) => (
              <SessionFooterNavigation
                session={input.session}
                timeline={timeline}
                view={input.view}
                screen={input.screen}
              />
            )}
          </Show>
        </Show>
        <Show when={timeline.resource.error}>
          {(error) => {
            throw error()
          }}
        </Show>
        <Show when={!timeline.ready() && !input.hideHeader()}>
          <SessionIdentityHeader sessionID={input.session.identity.params.id ?? ""} session={input.session.data.info()}>
            <SessionRunningMenu
              sessionID={input.session.identity.params.id}
              owner={composer.requests.background.running.sessionID()}
              blocking={composer.requests.background.running.blocking()}
              tasks={composer.requests.background.running.tasks()}
              title={input.session.data.parentID() ? input.session.data.info()?.title : undefined}
            />
          </SessionIdentityHeader>
        </Show>
        <Show when={timeline.ready() && input.session.identity.params.id}>{timelineView()}</Show>
      </>
    ),
    composerView: () => (
      <Show when={input.visible() ? composer.active() : undefined} keyed>
        {(model) => (
          <ActiveSessionComposerRegion
            session={input.session}
            model={model}
            suggestionBoundary={timeline.scroller}
            onOpenTaskSource={
              timeline.ready()
                ? (source) => timeline.actions.revealMessage(source.messageID, source.toolCallID)
                : undefined
            }
            onOpenTask={
              binding()
                ? (taskID) => {
                    const current = binding()

                    if (!current) return

                    const opened = host.links.open({
                      href: "",
                      session: current.source,
                      task: {
                        server: current.target.server,
                        sourceSessionID: current.target.id,
                        taskID,
                      },
                    })

                    if (!opened) showToast({ variant: "error", title: language.t("session.tasks.detailsUnavailable") })
                  }
                : undefined
            }
            tools={
              <Show when={binding()} keyed>
                {(current) => (
                  <ExtensionSlot
                    at="session.composer.actions"
                    input={{
                      screen: current.screen,
                      source: current.source,
                      session: current.target,
                      get active() {
                        return input.visible()
                      },
                      get draftAgent() {
                        return model.composer.view.agent?.current()
                      },
                    }}
                  />
                )}
              </Show>
            }
          />
        )}
      </Show>
    ),
  }
}

/** Mounts existing content at the registered target connection without changing the main route. */
export function SessionTargetContent(props: {
  source: MountedSession
  screen: SessionScreen
  target: SessionTargetRef
  active: boolean
  interaction: "interactive" | "readonly"
  onNavigateToSession?: (sessionID: string) => void
  open: Sessions["open"]
}) {
  const host = useExtensionHost()
  const global = useGlobal()
  const tabs = useTabs()
  const route = useCurrentRoute()
  const language = useLanguage()
  let boundary: HTMLDivElement | undefined

  const connection = createMemo(() =>
    global.servers.list().find((item) => ServerConnection.key(item) === props.target.server.id),
  )

  createEffect(
    on(
      () => props.target.key,
      () => {
        onCleanup(
          tabs.retain({
            type: "session",
            server: ServerConnection.Key.make(props.target.server.id),
            sessionId: props.target.id,
          }),
        )
      },
    ),
  )

  const openSession = (sessionID: string) =>
    props.open({ source: props.source, server: props.target.server, sessionID })

  return (
    <SessionContentContext.Provider
      value={{
        params: {
          get serverKey() {
            return base64Encode(props.target.server.id)
          },
          get id() {
            return props.target.id
          },
        },
        active: () => props.active,
        get interaction() {
          return props.interaction
        },
        ownsRequest: (sessionID) => {
          if (props.interaction === "readonly" || !props.active || !sessionID) return false
          const current = route()

          if (current.type !== "session" || current.server !== props.target.server.id) return true

          return !sessionTreeIDs(props.target.server.data.session.list(), current.sessionId).includes(sessionID)
        },
        openRequestOwner: (sessionID) => {
          const current = route()

          if (
            sessionID &&
            current.type === "session" &&
            current.server === props.target.server.id &&
            sessionTreeIDs(props.target.server.data.session.list(), current.sessionId).includes(sessionID)
          )
            return openSession(current.sessionId)
          openSession(props.target.server.data.session.get(props.target.id)?.parentID ?? props.target.id)
        },
        openSession,
        navigateToSession: (sessionID) => (props.onNavigateToSession ?? openSession)(sessionID),
        openTask: (reference) => {
          host.links.open({
            href: "",
            session: props.source,
            task: {
              server: props.target.server,
              sourceSessionID: reference.sourceSessionID,
              operationID: reference.operationID,
            },
          })
        },
        openCommunication: (reference) => {
          host.links.open({
            href: "",
            session: props.source,
            communication: {
              server: props.target.server,
              sessionID: reference.sessionID,
              communicationID: reference.communicationID,
            },
          })
        },
      }}
    >
      <div ref={boundary} data-session-content class="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <Show
          when={connection()}
          keyed
          fallback={
            <div role="status" class="p-4 text-13-regular text-text-weak">
              {language.t("session.target.serverUnavailable")}
            </div>
          }
        >
          {(conn) => (
            <ServerProvider conn={conn}>
              <ErrorBoundary
                fallback={(error, reset) => {
                  createEffect(on(() => props.target.key, reset, { defer: true }))

                  return (
                    <div
                      role="alert"
                      class="flex min-h-0 flex-1 flex-col items-start gap-3 p-4 text-13-regular text-text-weak"
                    >
                      <span>{errorMessage(error, language.t("common.requestFailed"))}</span>
                      <Button variant="neutral" size="small" onClick={reset}>
                        {language.t("common.retry")}
                      </Button>
                    </div>
                  )
                }}
              >
                <ResolvedSessionTarget {...props} boundary={() => boundary} />
              </ErrorBoundary>
            </ServerProvider>
          )}
        </Show>
      </div>
    </SessionContentContext.Provider>
  )
}

function ResolvedSessionTarget(props: {
  source: MountedSession
  screen: SessionScreen
  target: SessionTargetRef
  active: boolean
  interaction: "interactive" | "readonly"
  boundary: Accessor<HTMLElement | undefined>
}) {
  const data = useData()
  const server = useServer()

  const current = createSessionResolution(
    () => props.target.id,
    () => data.session,
    {
      children: true,
      connected: () => server.ctx.sdk.connection.status() === "connected",
    },
  )

  return (
    <ModelsProvider directory={() => current()?.location.directory}>
      <Show when={current()?.location} fallback={<SessionIdentityHeader sessionID={props.target.id} />}>
        {(location) => (
          <LocationProvider directory={location().directory}>
            <SessionUIProvider directory={location().directory} server={server.key}>
              <FileProvider>
                <ComposerPersistenceProvider
                  scope={() => ({ dir: base64Encode(location().directory), id: props.target.id })}
                  target={() => ({ server: server.key, scope: server.ctx.sdk.scope })}
                >
                  <CommentsProvider>
                    <EmbeddedSessionConversation {...props} />
                  </CommentsProvider>
                </ComposerPersistenceProvider>
              </FileProvider>
            </SessionUIProvider>
          </LocationProvider>
        )}
      </Show>
    </ModelsProvider>
  )
}

function EmbeddedSessionConversation(props: {
  source: MountedSession
  screen: SessionScreen
  target: SessionTargetRef
  active: boolean
  interaction: "interactive" | "readonly"
  boundary: Accessor<HTMLElement | undefined>
}) {
  const session = useSessionModel()

  const content = createSessionContent({
    session,
    source: () => props.source,
    target: () => props.target,
    screen: props.screen,
    visible: () => props.active,
    boundary: props.boundary,
    centered: () => false,
    hideHeader: () => props.interaction === "readonly",
    reserveReviewToggle: () => false,
  })

  return (
    <>
      {content.dropzone()}
      <Show when={props.interaction === "readonly"}>
        <Show
          when={session.data.info()?.parentID || session.data.info()?.controller?.kind === "child"}
          fallback={
            <SessionIdentityHeader sessionID={props.target.id} session={session.data.info()}>
              {content.searchView()}
            </SessionIdentityHeader>
          }
        >
          <div class="flex min-h-9 shrink-0 items-center justify-end px-3">{content.searchView()}</div>
        </Show>
      </Show>
      <div class="relative min-h-0 flex-1 overflow-hidden">{content.messages()}</div>
      {content.composerView()}
    </>
  )
}
