import { useCommand } from "@/shell/commands/command"
import { useLayout } from "@/shell/state/layout"
import { useLanguage } from "@/runtime/i18n/language"
import { serverName } from "@/runtime/server/registry"
import { displayName } from "@aigcfroge/ui/project-avatar"
import { sessionLabel } from "@/session/title"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMemo, createRenderEffect, on, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import type { HomeController } from "../model"
import { homeSessionSearchKey, type HomeSessionRecord, type HomeSessionsController } from "./controller"
import { looksLikeSessionID } from "@/session/search"
import { matchesHomeSessionMode } from "./index"

type HomeSessionSearchSource = Pick<HomeSessionsController, "data" | "session" | "scope">

export function createHomeSessionSearchController(home: HomeController, sessions: HomeSessionSearchSource) {
  const command = useCommand()
  const language = useLanguage()
  const layout = useLayout()

  const [state, setState] = createStore<{
    value: string
    focused: boolean
    highlighted: string
    exact: HomeSessionRecord | undefined
    lookingUp: boolean
  }>({
    value: "",
    focused: false,
    highlighted: "",
    exact: undefined,
    lookingUp: false,
  })

  // Keep the real owner outside the store so proxy wrapping cannot change its identity.
  let scope: ReturnType<HomeSessionSearchSource["scope"]["current"]> | undefined
  let lookup = 0
  let root: HTMLDivElement | undefined
  let input: HTMLInputElement | undefined
  let list: HTMLDivElement | undefined
  const query = createMemo(() => state.value.trim())

  const records = createMemo(() => {
    const value = query().toLowerCase()

    if (!value) return []

    return sessions.data
      .searchRecords()
      .filter((record) => `${sessionLabel(record.session)} ${record.projectName}`.toLowerCase().includes(value))
  })

  // Read current ownership here as well as in the cleanup trigger. The API getter
  // is imperative, so a previously memoized exact result is not proof of its owner.
  const results = () => {
    const matching = records()

    const exact =
      state.exact && sessions.scope.matches(scope) && matchesHomeSessionMode(state.exact.session, home.mode.current())
        ? state.exact
        : undefined

    if (!exact || matching.some((record) => record.session.id === exact.session.id)) return matching

    return [exact, ...matching]
  }

  const active = createMemo(() => {
    const records = results()

    if (records.some((record) => homeSessionSearchKey(record) === state.highlighted)) return state.highlighted

    return records[0] ? homeSessionSearchKey(records[0]) : ""
  })

  const open = createMemo(() => state.focused && query().length > 0)

  const placeholder = createMemo(() => {
    const project = home.project.selected()

    if (project) return language.t("home.sessions.search.placeholder.scoped", { scope: displayName(project) })

    if (home.server.list().length > 1) {
      const conn = home.server.focused()

      if (conn) return language.t("home.sessions.search.placeholder.scoped", { scope: serverName(conn) })
    }

    return language.t("home.sessions.search.placeholder")
  })

  onCleanup(
    makeEventListener(document, "pointerdown", (event) => {
      if (!open()) return
      const target = event.target

      if (!(target instanceof Node) || root?.contains(target)) return
      close()
    }),
  )
  createRenderEffect(
    on(sessions.scope.current, (_current, previous) => {
      if (!previous || sessions.scope.matches(previous)) return
      close()
    }),
  )
  onCleanup(() => lookup++)
  onMount(() => {
    if (layout.home.searchFocus.take()) focus()
  })

  command.register("home.search", () => [
    {
      id: "home.sessions.search.focus",
      title: placeholder(),
      keybind: "mod+f",
      hidden: true,
      onSelect: focus,
    },
  ])

  function focus() {
    input?.focus()
    setState("focused", true)
  }

  function close() {
    lookup++
    scope = undefined
    setState({ value: "", focused: false, exact: undefined, lookingUp: false })
  }

  function update(value: string) {
    const current = ++lookup
    const sessionID = value.trim()
    scope = undefined
    setState({ value, focused: document.activeElement === input, highlighted: "", exact: undefined, lookingUp: false })

    if (!looksLikeSessionID(sessionID)) return
    const owner = sessions.scope.current()
    scope = owner
    setState("lookingUp", true)
    void sessions.session.lookup(sessionID, owner).then(
      (record) => {
        if (current !== lookup || !sessions.scope.matches(owner)) return
        setState({ exact: record, lookingUp: false })
      },
      () => {
        if (current !== lookup || !sessions.scope.matches(owner)) return
        setState("lookingUp", false)
      },
    )
  }

  function select(record: HomeSessionRecord, options?: { background?: boolean }) {
    if (!results().includes(record)) return
    const owner = record === state.exact ? scope : sessions.scope.current()

    if (!sessions.scope.matches(owner)) return
    sessions.session.open(record.session, options, owner)

    if (!options?.background) close()
  }

  return {
    query: {
      value: () => state.value,
      placeholder,
      open,
      focus,
      input: update,
      close,
    },
    result: {
      loading: () => sessions.data.loading() || (state.lookingUp && sessions.scope.matches(scope)),
      list: results,
      active,
      noResultsLabel: () => language.t("home.sessions.search.noResults", { query: query() }),
      highlight: (record: HomeSessionRecord) => setState("highlighted", homeSessionSearchKey(record)),
      move: (delta: number) => {
        const records = results()

        if (records.length === 0) return
        const index = records.findIndex((record) => homeSessionSearchKey(record) === active())
        const next = ((index === -1 ? 0 : index) + delta + records.length) % records.length
        setState("highlighted", homeSessionSearchKey(records[next]))
        list?.querySelector<HTMLElement>(`[data-key="${state.highlighted}"]`)?.scrollIntoView({ block: "nearest" })
      },
      select,
      selectActive: () => {
        const record = results().find((item) => homeSessionSearchKey(item) === active())

        if (record) select(record)
      },
    },
    element: {
      setRoot: (element: HTMLDivElement) => (root = element),
      setInput: (element: HTMLInputElement) => (input = element),
      setList: (element: HTMLDivElement) => (list = element),
    },
  }
}

export type HomeSessionSearchController = ReturnType<typeof createHomeSessionSearchController>
