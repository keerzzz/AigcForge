import "@/index.css"
import * as Sentry from "@sentry/solid"
import { I18nProvider } from "@aigcfroge/ui/context"
import { DialogProvider } from "@aigcfroge/ui/context/dialog"
import { FileComponentProvider } from "@aigcfroge/ui/context/file"
import { MarkedProvider } from "@aigcfroge/ui/context/marked"
import { File } from "@aigcfroge/session-ui/file"
import { Mermaid } from "@aigcfroge/session-ui/mermaid"
import { Font } from "@aigcfroge/ui/font"
import { Splash } from "@aigcfroge/ui/logo"
import { ThemeProvider } from "@aigcfroge/ui/theme/context"
import { MetaProvider } from "@solidjs/meta"
import {
  Navigate,
  Route,
  type BaseRouterProps,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "@solidjs/router"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { Effect } from "effect"
import {
  type Component,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  type JSX,
  lazy,
  Match,
  onCleanup,
  type ParentProps,
  Show,
  Switch,
} from "solid-js"
import { CommandProvider } from "@/context/command"
import { CommentsProvider } from "@/context/comments"
import { FileProvider } from "@/context/file"
import { isMode, useMode } from "@/context/mode"
import { ChatWorkspaceProvider, DirtyDraftGuard } from "@/context/chat-workspace"
import { ServerSDKProvider, useServerSDK } from "@/context/server-sdk"
import { ServerSyncProvider } from "@/context/server-sync"
import { GlobalProvider, useGlobal } from "@/context/global"
import { HighlightsProvider } from "@/context/highlights"
import { LanguageProvider, type Locale, useLanguage } from "@/context/language"
import { LayoutProvider } from "@/context/layout"
import { RouteContributionProvider } from "@/context/route-contribution"
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
import { legacyRedirectSuffix, parseServerKey, sessionHref } from "./utils/session-route"
import { describeFailure, isNotFound, type RouteError } from "./utils/route-error"
import { RouteErrorSurface } from "@/components/route-error-surface"
import { type ServerSDK } from "@/context/server-sdk"
import { launchModeSessionOrRoute } from "@/pages/layout/helpers"
import { ApprovalCenter } from "@/components/approval-center"
import { AppRouterBoundary } from "@/app-router-boundary"

import Session from "@/pages/session"
import { ModeWorkspace } from "@/pages/mode-workspace"
import { HomeOverview } from "@/pages/home-overview"

const NewSession = lazy(() => import("@/pages/new-session"))

// Redirects legacy /:dir/session/:id? URLs to the current new-layout format.
// Without id: creates a new-session draft via the first available server+project.
// Titlebar "new session" button now calls openNewTab directly (creates draft
// with correct directory). Keyboard shortcut (mod+shift+s without serverKey)
// and any other /:dir/session hit path land here as a safety net.
function LegacySessionRedirect() {
  const params = useParams<{ dir: string; id?: string }>()
  const [searchParams] = useSearchParams<{ insert?: string; insertKind?: string }>()
  const server = useServer()
  const tabs = useTabs()
  const global = useGlobal()
  const mode = useMode()
  const navigate = useNavigate()
  const location = useLocation()
  if (params.id) {
    // Only whitelisted fields survive the redirect (plan §7.1): unknown params
    // and the ignored `prompt` must not leak into the new URL or history.
    const suffix = legacyRedirectSuffix({ query: searchParams, hash: location.hash })
    return <Navigate href={`${sessionHref(server.key, params.id)}${suffix}`} />
  }
  // First render: redirect to new-session placeholder; createEffect runs once
  // to create an actual draft with the first available project directory.
  const [failure, setFailure] = createSignal<RouteError>()
  createEffect(() => {
    const conn = server.current ?? server.list[0]
    if (!conn) return
    const key = ServerConnection.key(conn)
    let ctx: ReturnType<typeof global.ensureServerCtx>
    try {
      ctx = global.ensureServerCtx(conn)
    } catch (error) {
      // Explicit failure instead of a silent swallow: the redirect could not
      // reach this server at all (plan §7.1 — no bare `catch {}`).
      setFailure({ kind: "session-load-failed", serverKey: key, ...describeFailure(error) })
      return
    }
    const dir = ctx.projects.list()[0]?.worktree
    // No project is a normal state, not an error: the shell's Home/Add project
    // entry points are the recovery surface.
    if (!dir) return
    setFailure(undefined)
    launchModeSessionOrRoute({
      mode: mode.currentMode,
      navigate,
      projects: ctx.projects,
      server: key,
      directory: dir,
      tabs,
    })
  })
  return <Show when={failure()}>{(error) => <RouteErrorSurface error={error()} />}</Show>
}

const TargetSessionRoute = () => {
  const params = useParams<{ serverKey: string; id: string }>()
  const server = useServer()
  const parsed = createMemo(() => parseServerKey(params.serverKey))
  const canonicalKey = createMemo(() => {
    const key = parsed()
    return key.ok ? key.key : undefined
  })
  const conn = createMemo(() => {
    const key = canonicalKey()
    if (!key) return undefined
    return server.list.find((item) => ServerConnection.sameKey(key, ServerConnection.key(item)))
  })

  // Fail closed (plan §7.1): an unresolvable server key or an unregistered
  // server renders a typed error instead of mounting providers, so the SDK
  // provider's `?? server.current` fallback can never open this session's URL
  // against the *current* server.
  return (
    <Switch>
      <Match when={!parsed().ok}>
        <RouteErrorSurface error={{ kind: "invalid-server-key", serverKey: params.serverKey }} />
      </Match>
      <Match when={!conn()}>
        <RouteErrorSurface error={{ kind: "unknown-server", serverKey: params.serverKey, sessionID: params.id }} />
      </Match>
      <Match when={conn()}>
        {(connection) => (
          <Show when={`${params.serverKey}\0${params.id}`} keyed>
            <ServerSDKProvider server={connection}>
              <ServerSyncProvider server={connection}>
                <ResolvedTargetSessionRoute serverKey={canonicalKey()} />
              </ServerSyncProvider>
            </ServerSDKProvider>
          </Show>
        )}
      </Match>
    </Switch>
  )
}

type SessionResolution =
  | { ok: true; rootID: string; directory: string; mode: unknown }
  | { ok: false; error: RouteError }

type SessionInfo = { id: string; parentID?: string; directory?: string; mode?: unknown }

type SessionSdk = ServerSDK

/**
 * Read one session, classifying transport failures instead of throwing into the
 * render tree. `throwOnError` clients reject with `cause = { body, status }`,
 * which is how a real backend 404 becomes `session-not-found`.
 */
async function readSession(
  sdk: SessionSdk,
  sessionID: string,
): Promise<{ ok: true; value: SessionInfo } | { ok: false; error: RouteError }> {
  try {
    const result = await sdk.client.session.get({ sessionID })
    const value = result.data
    if (!value) return { ok: false, error: { kind: "session-load-failed", sessionID, detail: "empty response" } }
    return { ok: true, value }
  } catch (error) {
    if (isNotFound(error)) {
      return { ok: false, error: { kind: "session-not-found", sessionID, ...describeFailure(error) } }
    }
    return { ok: false, error: { kind: "session-load-failed", sessionID, ...describeFailure(error) } }
  }
}

/** Walk to the root session, reporting a missing parent explicitly (plan §7.1). */
async function resolveRootSession(
  sdk: SessionSdk,
  session: SessionInfo,
): Promise<{ ok: true; value: SessionInfo } | { ok: false; error: RouteError }> {
  let current = session
  const visited = new Set<string>([session.id])
  while (current.parentID) {
    const parentID = current.parentID
    if (visited.has(parentID)) {
      return { ok: false, error: { kind: "session-load-failed", sessionID: session.id, detail: "parent cycle" } }
    }
    visited.add(parentID)
    const parent = await readSession(sdk, parentID)
    if (!parent.ok) {
      if (parent.error.kind === "session-not-found") {
        return {
          ok: false,
          error: { kind: "parent-not-found", sessionID: session.id, parentID, status: parent.error.status },
        }
      }
      return parent
    }
    current = parent.value
  }
  return { ok: true, value: current }
}

function ResolvedTargetSessionRoute(props: { serverKey: ServerConnection.Key | undefined }) {
  const params = useParams<{ serverKey: string; id: string }>()
  const tabs = useTabs()
  const mode = useMode()
  const global = useGlobal()
  const serverSDK = useServerSDK()
  const serverKey = () => props.serverKey
  const placement = createMemo(() => {
    const key = serverKey()
    if (!key) return undefined
    return global.sessionPlacement.get(key, params.id)
  })
  const [resolved, { refetch }] = createResource(
    () => ({ id: params.id, sdk: serverSDK(), current: placement(), key: serverKey() }),
    async ({ id, sdk, current, key }): Promise<SessionResolution> => {
      const session = await readSession(sdk, id)
      if (!session.ok) return session
      if (key === undefined) return { ok: false, error: { kind: "invalid-server-key" } }
      if (current) return { ok: true, rootID: current.rootID, directory: current.directory, mode: session.value.mode }
      const root = await resolveRootSession(sdk, session.value)
      if (!root.ok) return root
      const directory = session.value.directory
      if (!directory) return { ok: false, error: { kind: "location-unresolved", sessionID: session.value.id } }
      const settled = global.sessionPlacement.set({
        server: key,
        leafID: session.value.id,
        rootID: root.value.id,
        directory,
      })
      return { ok: true, rootID: settled.rootID, directory, mode: session.value.mode }
    },
  )
  const failure = createMemo(() => {
    const value = resolved()
    return value && !value.ok ? value.error : undefined
  })
  const success = createMemo(() => {
    const value = resolved()
    return value?.ok ? value : undefined
  })
  const directory = createMemo(() => placement()?.directory ?? success()?.directory)

  // Only a fully resolved session may claim a tab or switch the mode — a failed
  // resolution must not leave a half-open tab behind (plan §7.1).
  createEffect(() => {
    const value = success()
    const key = serverKey()
    if (!value || !key) return
    tabs.addSessionTab({ server: key, sessionId: value.rootID })
    if (isMode(value.mode)) mode.setCurrentMode(value.mode)
  })

  return (
    <TargetServerScopedProviders directory={directory} sessionID={() => params.id}>
      <Switch>
        <Match when={resolved.error}>
          {(error) => (
            <RouteErrorSurface
              error={{ kind: "session-load-failed", sessionID: params.id, ...describeFailure(error()) }}
              onRetry={() => void refetch()}
            />
          )}
        </Match>
        <Match when={failure()}>
          {(error) => <RouteErrorSurface error={error()} onRetry={() => void refetch()} />}
        </Match>
        <Match when={success()}>
          {(value) => (
            <Show when={value().directory}>
              {(directory) => (
                <SDKProvider directory={directory}>
                  <DirectoryDataProvider directory={directory} server={() => serverKey()}>
                    <ApprovalCenter />
                    <TargetSessionPage rootID={value().rootID} />
                  </DirectoryDataProvider>
                </SDKProvider>
              )}
            </Show>
          )}
        </Match>
      </Switch>
    </TargetServerScopedProviders>
  )
}

function TargetSessionPage(props: { rootID: string }) {
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  return (
    <Show when={`${serverSDK().scope}\0${sdk().directory}`} keyed>
      <LayoutProvider>
        <SessionProviders>
          <Session rootID={props.rootID} />
        </SessionProviders>
      </LayoutProvider>
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
  // Persisted draft keys predate canonicalization — sameKey, not equality.
  const conn = createMemo(() =>
    server.list.find((item) => ServerConnection.sameKey(props.draft.server, ServerConnection.key(item))),
  )
  const directory = () => props.draft.directory
  const serverKey = () => props.draft.server

  createEffect(() => mode.setCurrentMode(props.draft.mode))

  return (
    <ServerSDKProvider server={conn}>
      <ServerSyncProvider server={conn}>
        <TargetServerScopedProviders directory={directory}>
          <SDKProvider directory={directory}>
            <DirectoryDataProvider directory={directory} server={serverKey}>
              <ApprovalCenter />
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

export function AppBaseProviders(props: {
  locale?: Locale
  router?: Component<BaseRouterProps>
  render: (routeOutlet: () => JSX.Element) => JSX.Element
}) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider
        onThemeApplied={(_, mode) => {
          void window.api?.setTitlebar?.({ mode })
          // Mermaid renders concrete theme colors at initialize time; re-render
          // in-place diagrams so a light/dark or theme switch recolor follows.
          void Mermaid.recolorMermaidDiagrams()
        }}
      >
        <LanguageProvider locale={props.locale}>
          <UiI18nBridge>
            <AppRouterBoundary.Root
              router={props.router}
              routes={() => <Routes />}
              fallback={(error) => {
                Sentry.captureException(error)
                return <ErrorPage error={error} />
              }}
              render={(routeOutlet) => (
                <QueryProvider>
                  <WslServersProvider>
                    <DialogProvider>
                      <MarkedProvider>
                        <FileComponentProvider component={File}>{props.render(routeOutlet)}</FileComponentProvider>
                      </MarkedProvider>
                    </DialogProvider>
                  </WslServersProvider>
                </QueryProvider>
              )}
            />
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
  routeOutlet: () => JSX.Element
  defaultServer: ServerConnection.Key
  canonicalLocalServer?: ServerConnection.Key
  servers?: Array<ServerConnection.Any>
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
            <ChatWorkspaceProvider>
              <RouteContributionProvider>
                <DirtyDraftGuard />
                <TabsProvider>
                  <ServerShell>
                    <AppLayout>{props.routeOutlet()}</AppLayout>
                  </ServerShell>
                </TabsProvider>
              </RouteContributionProvider>
            </ChatWorkspaceProvider>
          </ConnectionGate>
        </SettingsProvider>
      </GlobalProvider>
    </ServerProvider>
  )
}

export function ModeRoute() {
  const params = useParams<{ mode: string }>()
  const mode = useMode()
  const selected = createMemo(() => (isMode(params.mode) ? params.mode : undefined))

  // ADR-15: ModeRoute renders the shared ModeWorkspace (no redirect); setCurrentMode reacts to
  // params in createEffect (no redirect-driven remount). Same-route param changes on /mode/:mode
  // do not remount, which fixes flicker.
  createEffect(() => {
    const current = selected()
    if (current) mode.setCurrentMode(current)
  })

  return (
    <Show when={selected()} fallback={<Navigate href="/" />}>
      <ModeWorkspace />
    </Show>
  )
}

// Unknown paths must not leave a blank main region (plan §7.2): the router had
// no catch-all, so anything unmatched rendered an empty shell with no way back.
function UnknownRoute() {
  const params = useParams<Record<string, string>>()
  return <RouteErrorSurface error={{ kind: "unknown-route", detail: Object.values(params).join("/") }} />
}

// ADR-16: / renders the global home overview page (no redirect); /mode/:mode
// stays the authoritative mode home route.
function Routes() {
  return (
    <>
      <Route path="/" component={HomeOverview} />
      <Route path="/mode/:mode" component={ModeRoute} />
      <Route path="/new-session" component={DraftRoute} />
      <Route path="/server/:serverKey/session/:id" component={TargetSessionRoute} />
      <Route path="/:dir/session/:id?" component={LegacySessionRedirect} />
      <Route path="*" component={UnknownRoute} />
    </>
  )
}
