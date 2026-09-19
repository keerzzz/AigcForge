import { Button } from "@aigcfroge/ui/button"
import { Keybind } from "@aigcfroge/ui/keybind"
import { TooltipV2 } from "@aigcfroge/ui/v2/tooltip-v2"
import { TooltipKeybind } from "@/components/tooltip-keybind"
import { getFilename } from "@aigcfroge/core/util/path"
import { createEffect, createMemo, createSignal, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { Portal } from "solid-js/web"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { useSessionLayout } from "@/pages/session/session-layout"
import { decode64 } from "@/utils/base64"
import { Persist, persisted } from "@/utils/persist"
import { StatusPopoverV2 } from "../status-popover"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@aigcfroge/ui/v2/icon"
import type { SessionIdentityIdentity } from "@aigcfroge/sdk/v2/client"
import { useServerSDK } from "@/context/server-sdk"
import { isMode, modeDefinition } from "@/context/mode"
import { SessionIdentityQuery } from "./session-identity-query"

const OPEN_APPS = [
  "vscode",
  "cursor",
  "zed",
  "textmate",
  "antigravity",
  "finder",
  "terminal",
  "iterm2",
  "ghostty",
  "warp",
  "xcode",
  "android-studio",
  "powershell",
  "sublime-text",
] as const

type OpenApp = (typeof OPEN_APPS)[number]
type OS = "macos" | "windows" | "linux" | "unknown"
type Translator = ReturnType<typeof useLanguage>["t"]

type StringDatum =
  | { status: "ready"; value: string }
  | { status: "missing" }
  | { status: "unsupported"; reason: string }

const MAC_APPS = [
  {
    id: "vscode",
    label: "session.header.open.app.vscode",
    icon: "vscode",
    openWith: "Visual Studio Code",
  },
  { id: "cursor", label: "session.header.open.app.cursor", icon: "cursor", openWith: "Cursor" },
  { id: "zed", label: "session.header.open.app.zed", icon: "zed", openWith: "Zed" },
  { id: "textmate", label: "session.header.open.app.textmate", icon: "textmate", openWith: "TextMate" },
  {
    id: "antigravity",
    label: "session.header.open.app.antigravity",
    icon: "antigravity",
    openWith: "Antigravity",
  },
  { id: "terminal", label: "session.header.open.app.terminal", icon: "terminal", openWith: "Terminal" },
  { id: "iterm2", label: "session.header.open.app.iterm2", icon: "iterm2", openWith: "iTerm" },
  { id: "ghostty", label: "session.header.open.app.ghostty", icon: "ghostty", openWith: "Ghostty" },
  { id: "warp", label: "session.header.open.app.warp", icon: "warp", openWith: "Warp" },
  { id: "xcode", label: "session.header.open.app.xcode", icon: "xcode", openWith: "Xcode" },
  {
    id: "android-studio",
    label: "session.header.open.app.androidStudio",
    icon: "android-studio",
    openWith: "Android Studio",
  },
  {
    id: "sublime-text",
    label: "session.header.open.app.sublimeText",
    icon: "sublime-text",
    openWith: "Sublime Text",
  },
] as const

const WINDOWS_APPS = [
  { id: "vscode", label: "session.header.open.app.vscode", icon: "vscode", openWith: "code" },
  { id: "cursor", label: "session.header.open.app.cursor", icon: "cursor", openWith: "cursor" },
  { id: "zed", label: "session.header.open.app.zed", icon: "zed", openWith: "zed" },
  {
    id: "powershell",
    label: "session.header.open.app.powershell",
    icon: "powershell",
    openWith: "powershell",
  },
  {
    id: "sublime-text",
    label: "session.header.open.app.sublimeText",
    icon: "sublime-text",
    openWith: "Sublime Text",
  },
] as const

const LINUX_APPS = [
  { id: "vscode", label: "session.header.open.app.vscode", icon: "vscode", openWith: "code" },
  { id: "cursor", label: "session.header.open.app.cursor", icon: "cursor", openWith: "cursor" },
  { id: "zed", label: "session.header.open.app.zed", icon: "zed", openWith: "zed" },
  {
    id: "sublime-text",
    label: "session.header.open.app.sublimeText",
    icon: "sublime-text",
    openWith: "Sublime Text",
  },
] as const

const detectOS = (platform: ReturnType<typeof usePlatform>): OS => {
  if (platform.platform === "desktop" && platform.os) return platform.os
  if (typeof navigator !== "object") return "unknown"
  const value = navigator.platform || navigator.userAgent
  if (/Mac/i.test(value)) return "macos"
  if (/Win/i.test(value)) return "windows"
  if (/Linux/i.test(value)) return "linux"
  return "unknown"
}

function healthLabel(health: SessionIdentityIdentity["capability"]["health"], t: Translator) {
  if (health === "ready") return t("session.identity.health.ready")
  if (health === "degraded") return t("session.identity.health.degraded")
  return t("session.identity.health.blocked")
}

function datumLabel(datum: StringDatum, t: Translator) {
  if (datum.status === "ready") return datum.value
  if (datum.status === "missing") return t("session.identity.missing")
  return `${t("session.identity.unsupported")} · ${datum.reason}`
}

function assetLabel(kind: string, t: Translator) {
  if (kind === "prompt") return t("chat.feature.prompt")
  if (kind === "skill") return t("chat.feature.skill")
  if (kind === "mcp") return t("chat.feature.mcp")
  if (kind === "command") return t("chat.feature.command")
  if (kind === "agent") return t("chat.feature.agent")
  if (kind === "workflow") return t("chat.feature.workflow")
  if (kind === "plugin") return t("chat.feature.plugin")
  return kind
}

function detailLabel(identity: SessionIdentityIdentity, t: Translator) {
  if (identity.detail.status === "missing") {
    return `${t("session.identity.detailUnavailable")} · ${identity.detail.reason}`
  }
  const detail = identity.detail.detail
  if (detail.source === "coding") {
    return `${t("session.identity.vcs")}: ${datumLabel(detail.vcs.branch, t)} · ${datumLabel(detail.vcs.worktree, t)}`
  }
  if (detail.source === "chat") {
    return detail.assetCounts.length > 0
      ? detail.assetCounts.map((item) => `${assetLabel(item.kind, t)} ${item.count}`).join(" · ")
      : t("session.identity.none")
  }
  if (detail.source === "work") {
    const contract =
      detail.contract.source === "workflow"
        ? `${t("session.identity.contract.workflow")} · ${detail.contract.revision}`
        : detail.contract.source === "preset"
          ? `${t("session.identity.contract.preset")} · ${
              detail.contract.revision.status === "ready"
                ? detail.contract.revision.revision
                : `${t("session.identity.unsupported")} · ${detail.contract.revision.reason}`
            }`
          : t("session.identity.contract.adHoc")
    return `${contract} · ${t("session.identity.artifact")}: ${datumLabel(detail.artifact, t)}`
  }
  if (detail.source === "assistant") {
    const scope =
      detail.scope.kind === "personal"
        ? t("session.identity.scope.personal")
        : t("session.identity.scope.project", { project: detail.scope.projectID })
    return `${scope} · ${t("session.identity.reminders")}: ${healthLabel(detail.reminders.health, t)} · ${t(
      "session.identity.memory",
    )}: ${healthLabel(detail.memory.health, t)} · ${t("session.identity.knowledge")}: ${healthLabel(
      detail.knowledge.health,
      t,
    )}`
  }
  return `${t("session.identity.snapshot")}: ${detail.snapshot.digest} · ${t(
    "session.identity.policy",
  )}: ${healthLabel(detail.policy.health, t)}`
}

function SessionProductHeader(props: { identity: SessionIdentityIdentity }) {
  const language = useLanguage()
  const location = () => getFilename(props.identity.location.directory) || props.identity.location.directory
  const mode = () =>
    isMode(props.identity.mode) ? language.t(modeDefinition(props.identity.mode).labelKey) : props.identity.mode
  const model = () => {
    if (props.identity.model.status === "ready") {
      return `${props.identity.model.value.providerID}/${props.identity.model.value.modelID}`
    }
    if (props.identity.model.status === "missing") return language.t("session.identity.missing")
    return `${language.t("session.identity.unsupported")} · ${props.identity.model.reason}`
  }
  const permission = () =>
    `${language.t(`session.identity.permission.${props.identity.permission.declaredTier}`)} · ${language.t(
      `settings.permissions.action.${props.identity.permission.effect}`,
    )}`

  return (
    <div
      data-component="session-product-header"
      data-mode={props.identity.mode}
      data-health={props.identity.capability.health}
      class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-v2-border-border-base bg-v2-background-bg-base px-3 py-2 text-11-regular text-v2-text-text-muted"
    >
      <span data-field="mode" class="font-medium text-v2-text-text-base">
        {mode()}
      </span>
      <span data-field="location" title={props.identity.location.directory}>
        {location()}
      </span>
      <span data-field="agent">{props.identity.agent}</span>
      <span data-field="model">{model()}</span>
      <details class="ml-auto min-w-0 max-w-full">
        <summary class="cursor-default select-none text-v2-text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus">
          {language.t("session.identity.details")}
        </summary>
        <div class="mt-2 flex max-w-[min(720px,calc(100vw-40px))] flex-col gap-1 rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-02 p-2">
          <span data-field="permission">{permission()}</span>
          <span data-field="health">{healthLabel(props.identity.capability.health, language.t)}</span>
          <span data-field="detail">{detailLabel(props.identity, language.t)}</span>
          <Show when={props.identity.capability.reasons.length > 0}>
            <span data-field="reasons">
              {language.t("session.identity.reasons")}:{" "}
              {props.identity.capability.reasons.map((reason) => reason.code).join(" · ")}
            </span>
          </Show>
        </div>
      </details>
    </div>
  )
}

export function SessionHeader() {
  const layout = useLayout()
  const command = useCommand()
  const _server = useServer()
  const serverSDK = useServerSDK()
  const platform = usePlatform()
  const language = useLanguage()
  const settings = useSettings()
  const _sync = useSync()
  const _terminal = useTerminal()
  const { params, view } = useSessionLayout()

  const projectDirectory = createMemo(() => decode64(params.dir) ?? "")
  const project = createMemo(() => {
    const directory = projectDirectory()
    if (!directory) return
    return layout.projects.list().find((p) => p.worktree === directory || p.sandboxes?.includes(directory))
  })
  const name = createMemo(() => {
    const current = project()
    if (current) return current.name || getFilename(current.worktree)
    return getFilename(projectDirectory())
  })
  const hotkey = createMemo(() => command.keybind("file.open"))
  const os = createMemo(() => detectOS(platform))
  const search = settings.visibility.search
  const status = settings.visibility.status
  const isDesktop = createMediaQuery("(min-width: 768px)")
  const identityQuery = SessionIdentityQuery.use(() => {
    const sessionID = params.id
    if (!sessionID) return undefined
    return { sdk: serverSDK(), sessionID }
  })

  const [_exists, setExists] = createStore<Partial<Record<OpenApp, boolean>>>({
    finder: true,
  })

  const apps = createMemo(() => {
    if (os() === "macos") return MAC_APPS
    if (os() === "windows") return WINDOWS_APPS
    return LINUX_APPS
  })

  const _fileManager = createMemo(() => {
    if (os() === "macos") return { label: "session.header.open.finder", icon: "finder" as const }
    if (os() === "windows") return { label: "session.header.open.fileExplorer", icon: "file-explorer" as const }
    return { label: "session.header.open.fileManager", icon: "finder" as const }
  })

  createEffect(() => {
    if (platform.platform !== "desktop") return
    if (!platform.checkAppExists) return

    const list = apps()

    setExists(Object.fromEntries(list.map((app) => [app.id, undefined])) as Partial<Record<OpenApp, boolean>>)

    void Promise.all(
      list.map((app) =>
        Promise.resolve(platform.checkAppExists?.(app.openWith))
          .then((value) => Boolean(value))
          .catch(() => false)
          .then((ok) => [app.id, ok] as const),
      ),
    ).then((entries) => {
      setExists(Object.fromEntries(entries) as Partial<Record<OpenApp, boolean>>)
    })
  })

  const [_prefs, _setPrefs] = persisted(Persist.global("open.app"), createStore({ app: "finder" as OpenApp }))
  const v2ActionsState = createMemo<SessionHeaderV2ActionsState>(() => ({
    statusVisible: status(),
    statusLabel: language.t("status.popover.trigger"),
    reviewLabel: language.t("command.review.toggle"),
    reviewKeybind: command.keybind("review.toggle"),
    reviewVisible: isDesktop() && settings.visibility.reviewPanelToggle(),
    reviewOpened: view().reviewPanel.opened(),
    onReviewToggle: () => view().reviewPanel.toggle(),
  }))

  const [centerMount, setCenterMount] = createSignal<HTMLElement | null>(null)
  const [rightMount, setRightMount] = createSignal<HTMLElement | null>(null)
  onMount(() => {
    setCenterMount(document.getElementById("aigcfroge-titlebar-center"))
    setRightMount(document.getElementById("aigcfroge-titlebar-right"))
  })

  return (
    <>
      <Show when={identityQuery.data}>{(identity) => <SessionProductHeader identity={identity()} />}</Show>
      <Show when={search() && centerMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <Button
              type="button"
              variant="ghost"
              size="small"
              class="hidden md:flex w-[240px] max-w-full min-w-0 items-center gap-2 justify-between rounded-md border border-border-weak-base bg-surface-panel shadow-none cursor-default"
              onClick={() => command.trigger("file.open")}
              aria-label={language.t("session.header.searchFiles")}
            >
              <div class="flex min-w-0 flex-1 items-center overflow-visible">
                <span class="flex-1 min-w-0 text-12-regular text-text-weak truncate text-left">
                  {language.t("session.header.search.placeholder", {
                    project: name(),
                  })}
                </span>
              </div>

              <Show when={hotkey()}>
                {(keybind) => (
                  <Keybind class="shrink-0 !border-0 !bg-transparent !shadow-none px-0 text-text-weaker">
                    {keybind()}
                  </Keybind>
                )}
              </Show>
            </Button>
          </Portal>
        )}
      </Show>
      <Show when={rightMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <SessionHeaderV2Actions state={v2ActionsState()} />
          </Portal>
        )}
      </Show>
    </>
  )
}

type SessionHeaderV2ActionsState = {
  statusVisible: boolean
  statusLabel: string
  reviewLabel: string
  reviewKeybind: string
  reviewVisible: boolean
  reviewOpened: boolean
  onReviewToggle: () => void
}

function SessionHeaderV2Actions(props: { state: SessionHeaderV2ActionsState }) {
  return (
    <div class="flex items-center gap-2">
      <Show when={props.state.statusVisible}>
        <TooltipV2 placement="bottom" value={props.state.statusLabel}>
          <StatusPopoverV2 />
        </TooltipV2>
      </Show>
      <Show when={props.state.reviewVisible}>
        <TooltipKeybind title={props.state.reviewLabel} keybind={props.state.reviewKeybind}>
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="large"
            class="!w-9 shrink-0"
            state={props.state.reviewOpened ? "pressed" : undefined}
            onClick={props.state.onReviewToggle}
            aria-label={props.state.reviewLabel}
            aria-expanded={props.state.reviewOpened}
            aria-controls="review-panel"
            icon={<IconV2 name="sidebar-right" style={{ transform: "scaleX(-1)" }} />}
          />
        </TooltipKeybind>
      </Show>
    </div>
  )
}
