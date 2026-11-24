import type { ServerCtx } from "@/runtime/server/runtime"
import { Button } from "@omnixa/ui/button"
import { createEffect, createMemo, on, onCleanup, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { errorMessage } from "@/shell/layout/helpers"

export function AgentHub(props: {
  context: ServerCtx
  directory: string
  active: boolean
  openSession: (id: string) => void
}) {
  const identity = createMemo(
    () => {
      return {
        context: props.context,
        api: props.context.sdk.api,
        status: props.context.sdk.connection.status(),
        attempt: props.context.sdk.connection.attempt(),
        directory: props.directory,
      }
    },
    undefined,
    {
      equals: (prior, next) =>
        prior?.context === next?.context &&
        prior?.api === next?.api &&
        prior?.status === next?.status &&
        prior?.attempt === next?.attempt &&
        prior?.directory === next?.directory,
    },
  )

  return (
    <Show when={identity()} keyed>
      {(_identity) => (
        <AgentHubContent
          context={props.context}
          directory={props.directory}
          active={props.active}
          openSession={props.openSession}
        />
      )}
    </Show>
  )
}

function AgentHubContent(props: {
  context: ServerCtx
  directory: string
  active: boolean
  openSession: (id: string) => void
}) {
  const language = useLanguage()
  const lifetime = { active: true, read: 0 }

  const owner = createMemo(
    () => {
      return {
        context: props.context,
        client: props.context.sdk.api,
        status: props.context.sdk.connection.status(),
        attempt: props.context.sdk.connection.attempt(),
        directory: props.directory,
      }
    },
    undefined,
    {
      equals: (prior, next) =>
        prior?.context === next?.context &&
        prior?.client === next?.client &&
        prior?.status === next?.status &&
        prior?.attempt === next?.attempt &&
        prior?.directory === next?.directory,
    },
  )

  const [state, setState] = createStore({ loading: false, error: "", opening: "" })

  const current = (value: ReturnType<typeof owner>) =>
    lifetime.active && props.active && owner() === value && props.context.sdk.api === value.client

  const tasks = () => props.context.data.location.hub.list({ directory: props.directory })
  const agents = createMemo(() => [...new Set((tasks() ?? []).map((task) => task.agentID))])

  async function load() {
    if (!props.active || !props.directory || props.context.sdk.connection.status() !== "connected") return
    const value = owner()
    const read = ++lifetime.read
    setState({ loading: true, error: "" })

    try {
      value.context.data.location.hub.invalidate({ directory: value.directory })
      await value.context.data.location.hub.sync({ directory: value.directory })
    } catch (error) {
      if (current(value) && read === lifetime.read)
        setState("error", errorMessage(error, language.t("session.tasks.error.unknown")))
    } finally {
      if (current(value) && read === lifetime.read) setState("loading", false)
    }
  }

  async function open(id: string) {
    if (state.opening || !props.active) return
    const value = owner()
    setState({ opening: id, error: "" })

    try {
      value.context.data.session.invalidate(id)
      await value.context.data.session.sync(id)

      if (!current(value)) return

      if (!value.context.data.session.get(id)) {
        setState("error", language.t("home.hub.sourceMissing"))

        return
      }

      props.openSession(id)
    } catch (error) {
      if (current(value)) setState("error", errorMessage(error, language.t("home.hub.sourceMissing")))
    } finally {
      if (current(value)) setState("opening", "")
    }
  }

  createEffect(
    on(
      () => [owner(), props.active] as const,
      () => {
        if (props.active) void load()
      },
    ),
  )

  const stop = props.context.sdk.event.on("task.updated", () => {
    if (props.active) void load()
  })

  onCleanup(() => {
    lifetime.active = false
    stop()
  })

  return (
    <Show when={props.active}>
      <section
        data-component="agent-hub"
        aria-label={language.t("home.hub.title")}
        class="flex min-w-0 flex-col gap-3 p-3"
      >
        <div class="flex items-center justify-between gap-2">
          <h2>{language.t("home.hub.title")}</h2>
          <Button type="button" size="small" variant="ghost" disabled={state.loading} onClick={() => void load()}>
            {language.t("home.hub.refresh")}
          </Button>
        </div>
        <p class="break-all text-12-regular text-v2-text-weak">{props.directory}</p>
        <Show when={state.error}>{(error) => <p role="alert">{error()}</p>}</Show>
        <Show when={state.loading}>
          <p role="status">{language.t("home.hub.loading")}</p>
        </Show>
        <For each={agents()} fallback={<p>{language.t("home.hub.empty")}</p>}>
          {(agent) => {
            const rows = () => tasks()?.filter((task) => task.agentID === agent) ?? []

            return (
              <section aria-label={agent ?? language.t("home.hub.unassigned")}>
                <h3>{agent ?? language.t("home.hub.unassigned")}</h3>
                <p>
                  {language.t("home.hub.progress", {
                    done: rows().filter((task) => task.status === "completed").length,
                    total: rows().length,
                  })}
                </p>
                <ul class="flex flex-col divide-y divide-v2-border-weak">
                  <For each={rows()}>
                    {(task) => (
                      <li class="flex min-w-0 flex-wrap items-start gap-2 py-3">
                        <div class="min-w-0 flex-1 break-words">
                          <p>{task.content}</p>
                          <p class="text-12-regular text-v2-text-weak">
                            {language.t(`session.tasks.status.${task.status}`)} · {task.sessionID}
                          </p>
                          <code class="break-all text-11-regular">{task.id}</code>
                          <Show when={task.outputDigest}>
                            {(text) => <pre class="mt-2 whitespace-pre-wrap break-words">{text()}</pre>}
                          </Show>
                        </div>
                        <Button
                          type="button"
                          size="small"
                          variant="ghost"
                          disabled={!!state.opening}
                          onClick={() => void open(task.sessionID)}
                        >
                          {language.t("home.hub.open")}
                        </Button>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            )
          }}
        </For>
      </section>
    </Show>
  )
}
