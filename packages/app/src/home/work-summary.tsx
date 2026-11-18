import { For, Show, createMemo, createResource } from "solid-js"
import { Icon } from "@aigcfroge/ui/icon"
import { Button } from "@aigcfroge/ui/button"
import { useLanguage } from "@/runtime/i18n/language"
import { sessionTitle } from "@/session/title"
import { sessionPermissionRequest, sessionFormRequest } from "@/session/requests/session-request-tree"
import { useSettings } from "@/settings/model"
import type { HomeController } from "./model"
import type { HomeSessionsController } from "./sessions/controller"

export function HomeWorkSummary(props: { home: HomeController; sessions: HomeSessionsController }) {
  const language = useLanguage()
  const settings = useSettings()
  const data = () => props.home.server.focusedContext()?.data

  const source = createMemo(() => {
    const context = props.home.server.focusedContext()

    if (!context || context.sdk.connection.status() !== "connected") return

    return {
      data: context.data,
      attempt: context.sdk.connection.attempt(),
      ids: [
        ...new Set([
          ...context.data.session.active(),
          ...context.data.session.permission.sessions(),
          ...context.data.session.form.sessions(),
        ]),
      ],
    }
  })

  const [read, { refetch }] = createResource(source, async (value) => {
    // Load only active/request owners. Reading every historical row would turn Home into hundreds of requests.
    await Promise.all(
      value.ids.map(async (id) => {
        let current: string | undefined = id

        while (current) {
          if (!value.data.session.get(current)) await value.data.session.sync(current)
          current = value.data.session.get(current)?.parentID
        }

        await Promise.all([value.data.session.permission.sync(id), value.data.session.form.sync(id)])
      }),
    )
  })

  const waiting = (id: string) => {
    const current = data()

    if (!current) return
    const sessions = current.session.list()

    if (!settings.permissions.autoApprove() && sessionPermissionRequest(sessions, current.session.permission.list, id))
      return "permission"

    if (sessionFormRequest(sessions, current.session.form.list, id)) return "reply"
  }

  const groups = createMemo(() => {
    const records = props.sessions.data.records()

    const running = new Set(
      data()
        ?.session.active()
        .map((id) => data()?.session.root(id)),
    )

    return [
      { id: "waiting", icon: "comment" as const, records: records.filter((row) => waiting(row.session.id)) },
      {
        id: "running",
        icon: "status" as const,
        records: records.filter((row) => !waiting(row.session.id) && running.has(row.session.id)),
      },
      {
        id: "completed",
        icon: "circle-check" as const,
        records: records
          .filter(
            (row) => row.session.outcome === "succeeded" && !waiting(row.session.id) && !running.has(row.session.id),
          )
          .slice(0, 3),
      },
    ] as const
  })

  return (
    <aside data-component="home-work-summary" aria-label={language.t("home.workSummary.title")}>
      <Show when={read.error}>
        <div role="alert">
          <p>{language.t("home.workSummary.loadError")}</p>
          <Button size="small" variant="ghost" onClick={() => void refetch()}>
            {language.t("common.retry")}
          </Button>
        </div>
      </Show>
      <Show when={read.loading || props.sessions.data.loading()}>
        <p role="status">{language.t("common.loading")}</p>
      </Show>
      <For each={groups()}>
        {(group) => (
          <section aria-label={language.t(`home.workSummary.${group.id}`)}>
            <header>
              <h2>{language.t(`home.workSummary.${group.id}`)}</h2>
              <Show when={group.id !== "completed"}>
                <span>{group.records.length}</span>
              </Show>
            </header>
            <For
              each={group.records.slice(0, 4)}
              fallback={
                <Show when={!read.loading && !props.sessions.data.loading() && !read.error}>
                  <p data-slot="empty">{language.t(`home.workSummary.empty.${group.id}`)}</p>
                </Show>
              }
            >
              {(record) => (
                <Button type="button" variant="ghost" data-slot="summary-row" onClick={() => props.sessions.session.open(record.session)}>
                  <Icon name={group.icon} size="small" />
                  <span data-slot="summary-copy">
                    <strong>{sessionTitle(record.session.title) ?? language.t("command.session.new")}</strong>
                    <span>
                      {group.id === "waiting"
                        ? language.t(
                            waiting(record.session.id) === "permission"
                              ? "home.workSummary.permission"
                              : "home.workSummary.reply",
                          )
                        : record.projectName}
                    </span>
                  </span>
                  <Icon name="chevron-right" size="small" />
                </Button>
              )}
            </For>
          </section>
        )}
      </For>
    </aside>
  )
}
