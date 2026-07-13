import "@/index.css"
import * as Sentry from "@sentry/solid"
import { I18nProvider } from "@aigcfroge/ui/context"
import { DialogProvider } from "@aigcfroge/ui/context/dialog"
import { FileComponentProvider } from "@aigcfroge/ui/context/file"
import { MarkedProvider } from "@aigcfroge/ui/context/marked"
import { File } from "@aigcfroge/session-ui/file"
import { Font } from "@aigcfroge/ui/font"
import { Splash } from "@aigcfroge/ui/logo"
import { ThemeProvider } from "@aigcfroge/ui/theme/context"
import { MetaProvider } from "@solidjs/meta"
import { type BaseRouterProps, Navigate, Route, Router, useParams, useSearchParams } from "@solidjs/router"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { Effect } from "effect"
import { type Component, createEffect, createMemo, createResource, createSignal, ErrorBoundary, For, type JSX, lazy, onCleanup, type ParentProps, Show } from "solid-js"
import { Dynamic } from "solid-js/web"
import { CommandProvider } from "@/context/command"
import { CommentsProvider } from "@/context/comments"
import { FileProvider } from "@/context/file"
import { isMode, useMode } from "@/context/mode"
import { ServerSDKProvider, useServerSDK } from "@/context/server-sdk"
import { ServerSyncProvider } from "@/context/server-sync"
import { GlobalProvider, useGlobal } from "@/context/global"
import { HighlightsProvider } from "@/context/highlights"
import { LanguageProvider, type Locale, useLanguage } from "@/context/language"
import { LayoutProvider } from "@/context/layout"
import { ModelsProvider } from "@/context/models"
import { NotificationProvider } from "@/context/notification"
import { PermissionProvider } from "@/context/permission"
import { PromptProvider } from "@/context/prompt"
import { ServerConnection, ServerProvider, serverName, useServer } from "@/context/server"
import { SettingsProvider } from "@/context/settings"
import { TerminalProvider } from "@/context/terminal"
import { TabsProvider, useTabs, type DraftTab } from "@/context/tabs"
import { SDKProvider, useSDK } from "@/context/sdk"
import { WslServersProvider } from "@/wsl/context"
import { DirectoryDataProvider } from "@/pages/directory-layout"
import Layout from "@/pages/layout"
import { ErrorPage } from "./pages/error"
import { useCheckServerHealth } from "./utils/server-health"
import { requireServerKey, rootSession, sessionHref } from "./utils/session-route"

import Session from "@/pages/session"
import { Home } from "@/pages/home"

const NewSession = lazy(() => import("@/pages/new-session"))

// Redirects legacy /:dir/session/:id? URLs to the current new-layout format.
// Without id: creates a new-session draft via the first available server+project.
// Titlebar "new session" button now calls openNewTab directly (creates draft
// with correct directory). Keyboard shortcut (mod+shift+s without serverKey)
// and any other /:dir/session hit path land here as a safety net.
function LegacySessionRedirect() {
  const params = useParams<{ dir: string; id?: string }>()
  const server = useServer()
  const tabs = useTabs()
  const global = useGlobal()
  const mode = useMode()
  if (params.id) return <Navigate href={sessionHref(server.key, params.id)} />
  // First render: redirect to new-session placeholder; createEffect runs once
  // to create an actual draft with the first available project directory.
  createEffect(() => {
    const conn = server.current ?? server.list[0]
    if (!conn) return
    const key = ServerConnection.key(conn)
    try {
      const ctx = global.ensureServerCtx(conn)
      const projects = ctx.projects.list()
      const dir = projects[0]?.worktree
      if (dir) tabs.newDraft({ server: key, directory: dir, mode: mode.currentMode })
    } catch {}
  })
  return
}


const TargetSessionRoute = () => {
  const params = useParams<{ serverKey: string; id: string }>()
  const server = useServer()
  const conn = createMemo(() => {
    const key = requireServerKey(params.serverKey)
    return server.list.find((item) => ServerConnection.key(item) === key)
  })

  return (
    <Show when={`${params.serverKey}\0${params.id}`} keyed>
      <ServerSDKProvider server={conn}>
        <ServerSyncProvider server={conn}>
          <ResolvedTargetSessionRoute />
        </ServerSyncProvider>
      </ServerSDKProvider>
    </Show>
  )
}

function ResolvedTargetSessionRoute() {
  const params = useParams<{ serverKey: string; id: string }>()
  const tabs = useTabs()
  const mode = useMode()
  const global = useGlobal()
  const serverSDK = useServerSDK()
  const serverKey = createMemo(() => requireServerKey(params.serverKey))
  const placement = createMemo(() => global.sessionPlacement.get(serverKey(), params.id))
  const [resolved] = createResource(
    () => ({ id: params.id, sdk: serverSDK(), current: placement() }),
    async ({ id, sdk, current }) => {
      const session = (await sdk.client.session.get({ sessionID: id })).data!
      if (current) return { ...current, mode: session.mode }
      const root = await rootSession(session, (sessionID) =>
        sdk.client.session.get({ sessionID }).then((result) => result.data!),
      )
      return {
        ...global.sessionPlacement.set({
          server: serverKey(),
          leafID: session.id,
          rootID: root.id,
          directory: session.directory,
        }),
        mode: session.mode,
      }
    },
  )
  const directory = createMemo(() => placement()?.directory ?? resolved()?.directory)
  const targetDirectory = () => directory()!

  createEffect(() => {
    const current = placement() ?? resolved()
    if (!current) return
    tabs.addSessionTab({
      server: serverKey(),
      sessionId: current.rootID,
    })
    const sessionMode = resolved()?.mode
    if (isMode(sessionMode)) mode.setCurrentMode(sessionMode)
  })

	return (
	  <TargetServerScopedProviders directory={directory} sessionID={() => params.id}>
	    <Show when={!resolved.error} fallback={<ErrorPage error={resolved.error} />}>
	      <Show when={directory()}>
	        <SDKProvider directory={targetDirectory}>
	          <DirectoryDataProvider directory={targetDirectory} server={serverKey}>
	            <TargetSessionPage />
	          </DirectoryDataProvider>
	        </SDKProvider>
	      </Show>
	    </Show>
	  </TargetServerScopedProviders>
	)
}

function TargetSessionPage() {
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  return (
    <Show when={`${serverSDK().scope}\0${sdk().directory}`} keyed>
      <SessionProviders>
        <Session />
      </SessionProviders>
    </Show>
  )
}

// Wraps the non-draft routes. They are gated on (and keyed to) the globally selected
// server via ServerKey, then provide the server-scoped shell (Permission/Layout/
// Notification/Models + the visual Layout) for that server.
function SelectedServerProviders(props: ParentProps) {
  return (
    <ServerKey>
      <ServerSDKProvider>
        <ServerSyncProvider>{props.children}</ServerSyncProvider>
      </ServerSDKProvider>
    </ServerKey>
  )
}


function DraftRoute() {
  const [search] = useSearchParams<{ draftId?: string }>()
  const tabs = useTabs()
  return (
    <Show when={tabs.ready()}>
      <Show
        when={tabs.store.find((tab): tab is DraftTab => tab.type === "draft" && tab.draftID === search.draftId)}
        keyed
        fallback={<Navigate href="/" />}
      >
        {(draft) => <ResolvedDraftRoute draft={draft} />}
      </Show>
    </Show>
  )
}

function ResolvedDraftRoute(props: { draft: DraftTab }) {
  const server = useServer()
  const mode = useMode()
  const conn = createMemo(() => server.list.find((item) => ServerConnection.key(item) === props.draft.server))
  const directory = () => props.draft.directory
  const serverKey = () => props.draft.server

  createEffect(() => mode.setCurrentMode(props.draft.mode))

  return (
    <ServerSDKProvider server={conn}>
      <ServerSyncProvider server={conn}>
        <TargetServerScopedProviders directory={directory}>
          <SDKProvider directory={directory}>
            <DirectoryDataProvider directory={directory} server={serverKey}>
              <DraftProviders>
                <NewSession />
              </DraftProviders>
            </DirectoryDataProvider>
          </SDKProvider>
        </TargetServerScopedProviders>
      </ServerSyncProvider>
    </ServerSDKProvider>
  )
}

function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  return <I18nProvider value={{ locale: language.intl, t: language.t }}>{props.children}</I18nProvider>
}

declare global {
  interface Window {
    __AIGCFROGE__?: {
      deepLinks?: string[]
    }
    api?: {
      setTitlebar?: (theme: { mode: "light" | "dark" }) => Promise<void>
      exportDebugLogs?: () => Promise<string>
    }
  }
}

function QueryProvider(props: ParentProps) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnReconnect: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      },
    },
  })
  return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
}

function BodyDesignClass() {

  createEffect(() => {
    if (typeof document === "undefined") return
    document.body.classList.add("font-(family-name:--font-family-text)")
    document.body.classList.add("text-[13px]")
    document.body.classList.add("font-[440]")
  })

  return null
}

// Server-agnostic providers shared across every route. These live in the shared
// shell (router root) so they stay mounted regardless of the active server/route.
function SharedProviders(props: ParentProps) {
  return (
    <>
      <BodyDesignClass />
      <CommandProvider>
        <HighlightsProvider>{props.children}</HighlightsProvider>
      </CommandProvider>
    </>
  )
}

// Server-scoped providers shared across the top-level shell.
type ServerScopedShellProps = ParentProps<{
  directory?: () => string | undefined
  sessionID?: () => string | undefined
}>

function ServerScopedProviders(props: ServerScopedShellProps) {
  return (
    <PermissionProvider directory={props.directory}>
      <LayoutProvider>
        <NotificationProvider directory={props.directory} sessionID={props.sessionID}>
          <ModelsProvider>{props.children}</ModelsProvider>
        </NotificationProvider>
      </LayoutProvider>
    </PermissionProvider>
  )
}


function AppLayout(props: ParentProps) {
  return (
    <SelectedServerProviders>
      <ServerScopedProviders>
        <Layout>{props.children}</Layout>
      </ServerScopedProviders>
    </SelectedServerProviders>
  )
}

function TargetServerScopedProviders(props: ServerScopedShellProps) {
  return (
    <PermissionProvider directory={props.directory}>
      <NotificationProvider directory={props.directory} sessionID={props.sessionID}>
        <ModelsProvider>{props.children}</ModelsProvider>
      </NotificationProvider>
    </PermissionProvider>
  )
}

function SessionProviders(props: ParentProps) {
  return (
    <TerminalProvider>
      <FileProvider>
        <PromptProvider>
          <CommentsProvider>{props.children}</CommentsProvider>
        </PromptProvider>
      </FileProvider>
    </TerminalProvider>
  )
}

// The draft page only renders the prompt composer, so it drops TerminalProvider.
// FileProvider and CommentsProvider stay because PromptInput uses file search and comment context.
function DraftProviders(props: ParentProps) {
  return (
    <FileProvider>
      <PromptProvider>
        <CommentsProvider>{props.children}</CommentsProvider>
      </PromptProvider>
    </FileProvider>
  )
}

export function AppBaseProviders(props: ParentProps<{ locale?: Locale }>) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider
        onThemeApplied={(_, mode) => {
          void window.api?.setTitlebar?.({ mode })
        }}
      >
        <LanguageProvider locale={props.locale}>
          <UiI18nBridge>
            <ErrorBoundary
              fallback={(error) => {
                Sentry.captureException(error)
                return <ErrorPage error={error} />
              }}
            >
              <QueryProvider>
                <WslServersProvider>
                  <DialogProvider>
                    <MarkedProvider>
                      <FileComponentProvider component={File}>{props.children}</FileComponentProvider>
                    </MarkedProvider>
                  </DialogProvider>
                </WslServersProvider>
              </QueryProvider>
            </ErrorBoundary>
          </UiI18nBridge>
        </LanguageProvider>
      </ThemeProvider>
    </MetaProvider>
  )
}

function ConnectionGate(props: ParentProps<{ disableHealthCheck?: boolean }>) {
  const server = useServer()
  const checkServerHealth = useCheckServerHealth()

  const [checkMode, setCheckMode] = createSignal<"blocking" | "background">("blocking")

  // performs repeated health check with a grace period for
  // non-http connections, otherwise fails instantly
  const [startupHealthCheck, healthCheckActions] = createResource(() =>
    props.disableHealthCheck
      ? true
      : Effect.gen(function* () {
          if (!server.current) return true
          const { http, type } = server.current

          while (true) {
            const res = yield* Effect.promise(() => checkServerHealth(http))
            if (res.healthy) return true
            if (checkMode() === "background" || type === "http") return false
          }
        }).pipe(
          Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.succeed(false) }),
          Effect.ensuring(Effect.sync(() => setCheckMode("background"))),
          Effect.runPromise,
        ),
  )
  const checking = createMemo(
    () => checkMode() === "blocking" && ["unresolved", "pending"].includes(startupHealthCheck.state),
  )

  return (
    <Show
      when={!checking()}
      fallback={
        <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base">
          <Splash class="w-16 h-20 opacity-50 animate-pulse" />
        </div>
      }
    >
      <Show
        when={startupHealthCheck.latest}
        fallback={
          <ConnectionError
            onRetry={() => {
              if (checkMode() === "background") void healthCheckActions.refetch()
            }}
            onServerSelected={(key) => {
              setCheckMode("blocking")
              server.setActive(key)
              void healthCheckActions.refetch()
            }}
          />
        }
      >
        {props.children}
      </Show>
    </Show>
  )
}

function ConnectionError(props: { onRetry?: () => void; onServerSelected?: (key: ServerConnection.Key) => void }) {
  const language = useLanguage()
  const server = useServer()
  const others = () => server.list.filter((s) => ServerConnection.key(s) !== server.key)
  const name = createMemo(() => server.name || server.key)
  const serverToken = "\u0000server\u0000"
  const unreachable = createMemo(() => language.t("app.server.unreachable", { server: serverToken }).split(serverToken))

  const timer = setInterval(() => props.onRetry?.(), 1000)
  onCleanup(() => clearInterval(timer))

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base gap-6 p-6">
      <div class="flex flex-col items-center max-w-md text-center">
        <Splash class="w-12 h-15 mb-4" />
        <p class="text-14-regular text-text-base">
          {unreachable()[0]}
          <span class="text-text-strong font-medium">{name()}</span>
          {unreachable()[1]}
        </p>
        <p class="mt-1 text-12-regular text-text-weak">{language.t("app.server.retrying")}</p>
      </div>
      <Show when={others().length > 0}>
        <div class="flex flex-col gap-2 w-full max-w-sm">
          <span class="text-12-regular text-text-base text-center">{language.t("app.server.otherServers")}</span>
          <div class="flex flex-col gap-1 bg-surface-base rounded-lg p-2">
            <For each={others()}>
              {(conn) => {
                const key = ServerConnection.key(conn)
                return (
                  <button
                    type="button"
                    class="flex items-center gap-3 w-full px-3 py-2 rounded-md hover:bg-surface-raised-base-hover transition-colors text-left"
                    onClick={() => props.onServerSelected?.(key)}
                  >
                    <span class="text-14-regular text-text-strong truncate">{serverName(conn)}</span>
                  </button>
                )
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}

function ServerKey(props: ParentProps) {
  const server = useServer()
  return (
    <Show when={server.key} keyed>
      {props.children}
    </Show>
  )
}

export function AppInterface(props: {
  children?: JSX.Element
  defaultServer: ServerConnection.Key
  canonicalLocalServer?: ServerConnection.Key
  servers?: Array<ServerConnection.Any>
  router?: Component<BaseRouterProps>
  disableHealthCheck?: boolean
}) {
  // The visual new layout lives in the router root so it remains mounted across
  // route changes. Draft and session routes override only their server-bound data
  // providers beneath it.
  const ServerShell = (shellProps: ParentProps) => (
    <QueryProvider>
      <SharedProviders>
        {props.children}
        {shellProps.children}
      </SharedProviders>
    </QueryProvider>
  )

  return (
    <ServerProvider
      defaultServer={props.defaultServer}
      canonicalLocalServer={props.canonicalLocalServer}
      servers={props.servers}
	    >
	      <GlobalProvider>
	        <SettingsProvider>
			<ConnectionGate disableHealthCheck={props.disableHealthCheck}>
			  <Dynamic
				component={props.router ?? Router}
				root={(routerProps) => (
				  <TabsProvider>
					<ServerShell>
					  <AppLayout>{routerProps.children}</AppLayout>
					</ServerShell>
				  </TabsProvider>
				)}
			  >
				<Routes />
			  </Dynamic>
			</ConnectionGate>
	        </SettingsProvider>
	      </GlobalProvider>
	    </ServerProvider>
	  )
	}


function ModeRoute() {
  const params = useParams<{ mode: string }>()
  const mode = useMode()
  const selected = createMemo(() => (isMode(params.mode) ? params.mode : undefined))

  createEffect(() => {
    const current = selected()
    if (current) mode.setCurrentMode(current)
  })

  return (
    <Show when={selected()} fallback={<Navigate href="/" />}>
      <Home />
    </Show>
  )
}

function Routes() {
	return (
		<>
			<Route path="/" component={Home} />
			<Route path="/mode/:mode" component={ModeRoute} />
			<Route path="/new-session" component={DraftRoute} />
			<Route path="/server/:serverKey/session/:id" component={TargetSessionRoute} />
			<Route path="/:dir/session/:id?" component={LegacySessionRedirect} />
		</>
	)
}
