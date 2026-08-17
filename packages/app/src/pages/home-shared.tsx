import type { Session } from "@aigcfroge/sdk/v2/client"
import {
  createEffect,
  createMemo,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createStore } from "solid-js/store"
import { Spinner } from "@aigcfroge/ui/spinner"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Icon as IconV2 } from "@aigcfroge/ui/v2/icon"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { DateTime } from "luxon"
import type { LocalProject } from "@/context/layout"
import { sessionHasOpenTab, useTabs } from "@/context/tabs"
import type { ServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import { displayName, projectForSession, sortedRootSessions } from "@/pages/layout/helpers"
import { SessionTabAvatar } from "@/pages/layout/session-tab-avatar"
import { sessionTitle } from "@/utils/session-title"
import { pathKey } from "@/utils/path-key"
import type { ServerConnection } from "@/context/server"

// Home Session shared owner (ADR-16 extraction): the Session records pipeline,
// search, grouping and presentation components used by Coding/Work/Assistant mode
// homes and the global HomeOverview. This module is NOT a page shell; the Coding
// project/server tree lives in coding-project-column.tsx.

export const HOME_SESSION_LIMIT = 64
const HOME_ROW_LAYOUT =
  "flex min-w-0 w-full shrink-0 cursor-default items-center rounded-[6px] bg-transparent text-left transition-[background-color,color,box-shadow] duration-[120ms] ease-in-out focus-visible:outline-none"
const HOME_ROW_BASE = `${HOME_ROW_LAYOUT} border-0`
export const HOME_ROW = `${HOME_ROW_BASE} [font-weight:530] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover`
export const HOME_SECTION_LABEL = "text-v2-text-text-muted [font-weight:440]"

export type HomeSessionRecord = {
  session: Session
  project: LocalProject
  projectName: string
}

export type HomeSessionGroup = {
  id: "today" | "yesterday" | "older"
  title: string
  sessions: HomeSessionRecord[]
}

export const HOME_SESSION_SEARCH_RESULTS_ID = "home-session-search-results"
export const HOME_SEARCH_RESULT_ROW =
  "flex h-10 w-full shrink-0 cursor-default items-center gap-2 border-0 py-3 pl-4 pr-6 text-left transition-[background-color] duration-[120ms] ease-in-out hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
export const HOME_SEARCH_RESULT_TITLE =
  "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-4 tracking-[-0.04px] text-v2-text-text-base [font-weight:530]"
export const HOME_SEARCH_RESULT_META =
  "min-w-0 flex-[1_1_auto] overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-4 tracking-[-0.04px] text-v2-text-text-muted [font-weight:440]"

export function buildHomeSessionRecords(input: {
  sync: Pick<ServerSync, "child">
  projectDirectories: () => string[]
  projects: () => LocalProject[]
  projectByID: () => Map<string, LocalProject>
}) {
  return [
    ...new Map(
      input
        .projectDirectories()
        .flatMap((directory) => sortedRootSessions(input.sync.child(directory, { bootstrap: false })[0], Date.now()))
        .map((session) => [`${pathKey(session.directory)}:${session.id}`, session] as const),
    ).values(),
  ]
    .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
    .flatMap((session) => {
      const project = projectForSession(session, input.projects(), input.projectByID())
      if (!project) return []
      return {
        session,
        project,
        projectName: displayName(project),
      }
    })
}

export function matchesHomeSessionSearch(record: HomeSessionRecord, query: string) {
  return `${record.session.title} ${record.projectName}`.toLowerCase().includes(query)
}

export function homeSessionSearchKey(record: HomeSessionRecord) {
  return `${pathKey(record.session.directory)}:${record.session.id}`
}

export function HomeSessionLeading(props: {
  project: LocalProject
  session: Session
  server: ServerConnection.Key
  activeServer: boolean
}) {
  const tabs = useTabs()
  const hasOpenTab = createMemo(() => sessionHasOpenTab(tabs.store, props.server, props.session))
  return (
    <div class="relative shrink-0">
      <Show when={hasOpenTab()}>
        <span
          aria-hidden="true"
          class="pointer-events-none absolute top-1/2 h-[7px] w-[3px] -translate-y-1/2 rounded-[2px] bg-v2-background-bg-layer-04"
          style={{ right: "calc(100% + 12px)" }}
        />
      </Show>
      <SessionTabAvatar
        project={props.project}
        directory={props.session.directory}
        sessionId={props.session.id}
        activeServer={props.activeServer}
      />
    </div>
  )
}

export function HomeSessionSearch(props: {
  value: string
  placeholder: string
  open: boolean
  loading: boolean
  results: HomeSessionRecord[]
  server: ServerConnection.Key
  activeServer: boolean
  noResultsLabel: string
  bindFocus: (focus: () => void) => void
  onInput: (value: string) => void
  onFocus: () => void
  onClose: () => void
  onSelect: (session: Session) => void
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({ active: "" })
  let root: HTMLDivElement | undefined
  let input: HTMLInputElement | undefined
  let listRef: HTMLDivElement | undefined

  const focusInput = () => {
    input?.focus()
    props.onFocus()
  }

  onMount(() => {
    props.bindFocus(focusInput)
  })

  const syncActive = (results: HomeSessionRecord[]) => {
    if (results.length === 0) {
      setStore("active", "")
      return
    }
    if (!results.some((record) => homeSessionSearchKey(record) === store.active)) {
      setStore("active", homeSessionSearchKey(results[0]))
    }
  }

  createEffect(() => syncActive(props.results))

  createEffect(
    on(
      () => props.value,
      () => syncActive(props.results),
    ),
  )

  const scrollActiveIntoView = () => {
    const key = store.active
    if (!key || !listRef) return
    const element = listRef.querySelector<HTMLElement>(`[data-key="${key}"]`)
    element?.scrollIntoView({ block: "nearest" })
  }

  const moveActive = (delta: number) => {
    const results = props.results
    if (results.length === 0) return
    const index = results.findIndex((record) => homeSessionSearchKey(record) === store.active)
    const start = index === -1 ? 0 : index
    const next = (start + delta + results.length) % results.length
    setStore("active", homeSessionSearchKey(results[next]))
    scrollActiveIntoView()
  }

  const selectActive = () => {
    const record = props.results.find((item) => homeSessionSearchKey(item) === store.active)
    if (!record) return
    props.onSelect(record.session)
  }

  onCleanup(
    makeEventListener(document, "pointerdown", (event) => {
      if (!props.open) return
      const target = event.target
      if (!(target instanceof Node)) return
      if (root?.contains(target)) return
      props.onClose()
    }),
  )

  return (
    <div class="ml-4 mr-2 w-[calc(100%_-_24px)]">
      <div ref={root} data-component="home-session-search" class="relative z-10 w-full">
        <Show when={props.open}>
          <div
            data-component="home-session-search-panel"
            class="absolute flex flex-col rounded-[12px] bg-v2-background-bg-base shadow-[var(--v2-elevation-floating)]"
            style={{
              top: "-6px",
              left: "-6px",
              width: "calc(100% + 14px)",
            }}
          >
            <div class="flex flex-col pt-9">
              <div id={HOME_SESSION_SEARCH_RESULTS_ID} role="listbox" class="flex flex-col gap-4 pt-4 pb-2">
                <Show
                  when={!props.loading}
                  fallback={
                    <div class="flex items-center justify-center px-4 py-3 text-v2-text-text-muted [font-weight:440]">
                      <Spinner class="size-4" />
                    </div>
                  }
                >
                  <Show
                    when={props.results.length > 0}
                    fallback={
                      <p class="my-1.5 px-4 text-[13px] leading-4 tracking-[-0.04px] text-v2-text-text-muted [font-weight:440]">
                        {props.noResultsLabel}
                      </p>
                    }
                  >
                    <div class="flex flex-col">
                      <p class="my-1.5 px-4 text-[13px] leading-4 tracking-[-0.04px] text-v2-text-text-muted [font-weight:440]">
                        {language.t("home.sessions.search.sessions")}
                      </p>
                      <div ref={listRef} class="flex max-h-80 flex-col gap-px overflow-y-auto">
                        <For each={props.results}>
                          {(record) => (
                            <HomeSessionSearchResultRow
                              record={record}
                              server={props.server}
                              activeServer={props.activeServer}
                              selected={store.active === homeSessionSearchKey(record)}
                              onHighlight={() => setStore("active", homeSessionSearchKey(record))}
                              onSelect={(session) => props.onSelect(session)}
                            />
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </Show>
              </div>
            </div>
          </div>
        </Show>
        <label
          class="relative z-20 flex h-9 w-full items-center gap-2 rounded-[6px] py-1 pl-3 pr-2 text-v2-icon-icon-muted transition-[background-color,box-shadow] duration-[120ms] ease-in-out"
          classList={{
            "bg-v2-background-bg-layer-03 focus-within:bg-v2-background-bg-layer-03 focus-within:shadow-[0_0_0_0.5px_var(--v2-border-border-focus),var(--v2-elevation-raised)]":
              !props.open,
            "bg-transparent shadow-[0_0_0_0.5px_var(--v2-border-border-focus)]": props.open,
          }}
        >
          <IconV2 name="magnifying-glass" />
          <input
            ref={input}
            class="relative z-20 min-w-0 flex-1 border-0 bg-transparent text-v2-text-text-base outline-0 [font-weight:440] placeholder:text-v2-text-text-faint"
            value={props.value}
            placeholder={props.placeholder}
            aria-label={props.placeholder}
            aria-expanded={props.open}
            aria-controls={HOME_SESSION_SEARCH_RESULTS_ID}
            aria-autocomplete="list"
            aria-activedescendant={
              store.active && props.open ? `home-session-search-option-${store.active}` : undefined
            }
            onFocus={() => props.onFocus()}
            onInput={(event) => props.onInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                props.onClose()
                input?.blur()
                return
              }
              if (!props.open || props.results.length === 0) return
              if (event.altKey || event.metaKey) return
              if (event.key === "ArrowDown") {
                event.preventDefault()
                moveActive(1)
                return
              }
              if (event.key === "ArrowUp") {
                event.preventDefault()
                moveActive(-1)
                return
              }
              if (event.key === "Enter" && !event.isComposing) {
                event.preventDefault()
                selectActive()
              }
            }}
          />
          <Show when={props.value}>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="small"
              class="relative z-20 shrink-0"
              icon={<IconV2 name="close" size="large" class="text-v2-icon-icon-muted" />}
              aria-label={props.placeholder}
              onClick={() => {
                props.onClose()
                input?.focus()
              }}
            />
          </Show>
        </label>
      </div>
    </div>
  )
}

export function HomeSessionSearchResultRow(props: {
  record: HomeSessionRecord
  server: ServerConnection.Key
  activeServer: boolean
  selected: boolean
  onHighlight: () => void
  onSelect: (session: Session) => void
}) {
  const title = createMemo(() => sessionTitle(props.record.session.title) || props.record.session.id)

  const key = () => homeSessionSearchKey(props.record)

  return (
    <button
      type="button"
      id={`home-session-search-option-${key()}`}
      data-key={key()}
      data-component="home-session-search-row"
      role="option"
      aria-selected={props.selected}
      classList={{
        [HOME_SEARCH_RESULT_ROW]: true,
        "bg-v2-overlay-simple-overlay-hover": props.selected,
      }}
      onMouseEnter={() => props.onHighlight()}
      onClick={() => props.onSelect(props.record.session)}
    >
      <HomeSessionLeading
        project={props.record.project}
        session={props.record.session}
        server={props.server}
        activeServer={props.activeServer}
      />
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          class={`${HOME_SEARCH_RESULT_TITLE} ${props.record.projectName ? "max-w-[min(70%,480px)] flex-[0_1_auto]" : "flex-[1_1_auto]"}`}
        >
          {title()}
        </span>
        <Show when={props.record.projectName}>
          <span class={HOME_SEARCH_RESULT_META}>{props.record.projectName}</span>
        </Show>
      </div>
    </button>
  )
}

export function HomeSessionGroupHeader(props: { title: string; onNewSession?: () => void; actionLabel?: string }) {
  const language = useLanguage()
  return (
    <div class="flex h-7 min-w-0 items-center gap-3 pl-4 pr-2">
      <div class={`${HOME_SECTION_LABEL} shrink-0 uppercase tracking-wider text-11-bold`}>{props.title}</div>
      <div class="flex-1 h-px bg-v2-border-border-muted opacity-40" />
      <Show when={props.onNewSession}>
        <ButtonV2
          data-action="home-new-session"
          variant="ghost-muted"
          size="normal"
          icon="edit"
          class="h-7 px-2 [font-weight:530] shrink-0"
          onClick={() => props.onNewSession?.()}
        >
          {props.actionLabel ?? language.t("command.session.new")}
        </ButtonV2>
      </Show>
    </div>
  )
}

export function HomeSessionRow(props: {
  record: HomeSessionRecord
  server: ServerConnection.Key
  activeServer: boolean
  onClick: () => void
  badge?: JSX.Element
  /** Highlights a session linked from the selected Assistant entity. */
  highlighted?: boolean
}) {
  const title = createMemo(() => sessionTitle(props.record.session.title) || props.record.session.id)

  const relativeTime = createMemo(() => {
    const timeMs = props.record.session.time.updated ?? props.record.session.time.created ?? Date.now()
    const dt = DateTime.fromMillis(timeMs)
    const now = DateTime.local()
    const diff = now.diff(dt, ["days", "hours", "minutes"])
    if (diff.days > 0) return `${Math.floor(diff.days)}d ago`
    if (diff.hours > 0) return `${Math.floor(diff.hours)}h ago`
    return `${Math.max(Math.floor(diff.minutes), 1)}m ago`
  })

  return (
    <button
      type="button"
      data-component="home-session-row"
      data-highlighted={props.highlighted ? "" : undefined}
      classList={{
        "bg-v2-background-bg-layer-03 [box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)]": props.highlighted,
      }}
      class={`${HOME_ROW} h-10 gap-2 px-6 py-3 pl-4 flex items-center justify-between group`}
      onClick={props.onClick}
    >
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <HomeSessionLeading
          project={props.record.project}
          session={props.record.session}
          server={props.server}
          activeServer={props.activeServer}
        />
        <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-base [font-weight:530] group-hover:translate-x-0.5 transition-transform duration-150">
          {title()}
        </span>
        <Show when={props.badge}>{props.badge}</Show>
      </div>
      <span class="text-11-regular text-v2-text-text-muted opacity-80 shrink-0 font-mono select-none pl-2">
        {relativeTime()}
      </span>
    </button>
  )
}

export function HomeSessionSkeleton(props: { label: string }) {
  return (
    <div class="flex min-w-0 flex-col gap-4">
      <div class="flex h-7 min-w-0 items-center justify-between px-4">
        <div class={HOME_SECTION_LABEL}>{props.label}</div>
      </div>
      <div class="flex min-w-0 flex-col gap-px" aria-hidden="true">
        <For each={[0, 1, 2, 3]}>{() => <div class="h-10 rounded-[6px] bg-v2-background-bg-deep opacity-70" />}</For>
      </div>
    </div>
  )
}

export function groupSessions(records: HomeSessionRecord[], language: ReturnType<typeof useLanguage>): HomeSessionGroup[] {
  records = records ?? []
  const now = DateTime.local()
  const yesterday = now.minus({ days: 1 })
  const todaySessions = records.filter((record) =>
    DateTime.fromMillis(record.session.time.updated ?? record.session.time.created).hasSame(now, "day"),
  )
  const yesterdaySessions = records.filter((record) =>
    DateTime.fromMillis(record.session.time.updated ?? record.session.time.created).hasSame(yesterday, "day"),
  )
  const olderSessions = records.filter((record) => {
    const time = DateTime.fromMillis(record.session.time.updated ?? record.session.time.created)
    return !time.hasSame(now, "day") && !time.hasSame(yesterday, "day")
  })
  const olderTitle =
    todaySessions.length === 0 && yesterdaySessions.length === 0
      ? language.t("sidebar.project.recentSessions")
      : language.t("home.sessions.group.older")

  return [
    { id: "today" as const, title: language.t("home.sessions.group.today"), sessions: todaySessions },
    { id: "yesterday" as const, title: language.t("home.sessions.group.yesterday"), sessions: yesterdaySessions },
    { id: "older" as const, title: olderTitle, sessions: olderSessions },
  ].filter((group) => group.sessions.length > 0)
}
