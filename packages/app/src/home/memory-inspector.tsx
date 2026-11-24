import type { MemoryEditInput, PersonalMemoryInfo } from "@omnixa/client/promise"
import { Button } from "@omnixa/ui/button"
import { Select } from "@omnixa/ui/select"
import { TextField } from "@omnixa/ui/text-field"
import { For, Show, createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import type { ServerCtx } from "@/runtime/server/runtime"
import { errorMessage } from "@/shell/layout/helpers"
import "./memory-inspector.css"

type MemoryAction = "confirm" | "reject" | "edit" | "remove"

type InspectorProps = {
  context: ServerCtx
  active: boolean
  openSource: (sessionID: string) => void
}

const statuses: ("all" | PersonalMemoryInfo["status"])[] = ["all", "pending", "confirmed", "rejected", "deleted"]

const levels: PersonalMemoryInfo["trustLevel"][] = ["high", "medium", "low"]

export function MemoryInspector(props: InspectorProps) {
  // A new controller or transport revokes the previous editor and its in-flight replies.
  const identity = createMemo(
    () => {
      // Transport getters change with reconnect readiness, including under the same controller.
      props.context.sdk.connection.status()
      props.context.sdk.connection.attempt()

      return { context: props.context, api: props.context.sdk.api }
    },
    undefined,
    {
      equals: (left, right) => left.context === right.context && left.api === right.api,
    },
  )

  return (
    <Show when={identity()} keyed>
      {(owner) => (
        <MemoryInspectorContent
          context={props.context}
          active={props.active}
          openSource={props.openSource}
          owner={owner.context}
          api={owner.api}
        />
      )}
    </Show>
  )
}

function MemoryInspectorContent(props: InspectorProps & { owner: ServerCtx; api: ServerCtx["sdk"]["api"] }) {
  const language = useLanguage()
  const lifecycle = { active: true, read: 0 }

  const [state, setState] = createStore<{
    loading: boolean
    readError?: string
    actionError?: string
    pending?: MemoryAction | "source"
    acknowledged?: PersonalMemoryInfo
    status: "all" | PersonalMemoryInfo["status"]
    search: string
    editor?: {
      id: string
      content: string
      trustLevel: PersonalMemoryInfo["trustLevel"]
      sensitivityLevel: PersonalMemoryInfo["sensitivityLevel"]
    }
    removal?: PersonalMemoryInfo
  }>({ loading: false, status: "all", search: "" })

  const belongs = () => lifecycle.active && props.context === props.owner && props.context.sdk.api === props.api
  const current = () => belongs() && props.active
  const connected = () => props.context.sdk.connection.status() === "connected"
  const memories = () => props.context.data.memory.list()

  const visible = createMemo(() =>
    memories()?.filter(
      (item) =>
        (state.status === "all" || item.status === state.status) &&
        item.content.toLocaleLowerCase(language.intl()).includes(state.search.toLocaleLowerCase(language.intl())),
    ),
  )

  const statusOptions = createMemo(() =>
    statuses.map((value) => ({ value, label: language.t(`home.memory.status.${value}`) })),
  )

  const levelOptions = createMemo(() =>
    levels.map((value) => ({ value, label: language.t(`home.memory.level.${value}`) })),
  )

  const editable = () => {
    const item = memories()?.find((entry) => entry.id === state.editor?.id)

    return item?.status === "pending" || item?.status === "confirmed"
  }

  async function load() {
    if (!current() || !connected()) return
    const read = ++lifecycle.read
    setState({ loading: true, readError: undefined })

    try {
      props.context.data.memory.invalidate()
      await props.context.data.memory.sync()
    } catch (error) {
      if (current() && read === lifecycle.read)
        setState("readError", errorMessage(error, language.t("home.memory.error.unknown")))
    } finally {
      if (belongs() && read === lifecycle.read) setState("loading", false)
    }
  }

  async function update(action: MemoryAction, input: MemoryEditInput) {
    if (!current() || !connected() || state.pending) return
    setState({ pending: action, actionError: undefined, acknowledged: undefined })

    try {
      const acknowledged = await props.context.data.memory[action](input)

      if (!current()) return
      setState({ acknowledged, editor: undefined, removal: undefined })
      // A successful mutation remains acknowledged even if its following read fails.
      await load()
    } catch (error) {
      if (!current()) return
      setState("actionError", errorMessage(error, language.t("home.memory.error.unknown")))
      await load()
    } finally {
      if (belongs()) setState("pending", undefined)
    }
  }

  async function openSource(sessionID: string) {
    if (!current() || !connected() || state.pending) return
    setState({ pending: "source", actionError: undefined })

    try {
      props.context.data.session.invalidate(sessionID)
      await props.context.data.session.sync(sessionID)

      if (!current()) return
      const source = props.context.data.session.get(sessionID)

      if (!source) {
        setState("actionError", language.t("home.memory.error.sourceMissing"))

        return
      }

      props.openSource(source.id)
    } catch (error) {
      if (current()) setState("actionError", errorMessage(error, language.t("home.memory.error.sourceMissing")))
    } finally {
      if (belongs()) setState("pending", undefined)
    }
  }

  onCleanup(() => {
    lifecycle.active = false
  })
  createEffect(
    on([() => props.active, () => props.context.sdk.connection.status()], ([active, status]) => {
      if (active && status === "connected") void load()
    }),
  )

  return (
    <Show when={props.active}>
      <section data-component="memory-inspector" aria-label={language.t("home.memory.title")}>
        <div data-slot="memory-toolbar">
          <h2>{language.t("home.memory.title")}</h2>
          <Button
            type="button"
            size="small"
            variant="ghost"
            disabled={!connected() || state.loading || !!state.pending}
            onClick={() => void load()}
          >
            {language.t("home.memory.refresh")}
          </Button>
        </div>
        <p data-slot="memory-scope">{language.t("home.memory.scope")}</p>
        <div data-slot="memory-filters">
          <TextField
            label={language.t("home.memory.search")}
            hideLabel
            placeholder={language.t("home.memory.search")}
            value={state.search}
            onChange={(search) => setState("search", search)}
          />
          <Select
            aria-label={language.t("home.memory.status")}
            options={statusOptions()}
            current={statusOptions().find((option) => option.value === state.status)}
            value={(option) => option.value}
            label={(option) => option.label}
            onSelect={(option) => option && setState("status", option.value)}
          />
        </div>
        <Show when={!connected()}>
          <p data-slot="memory-feedback" role="status">
            {language.t("home.memory.disconnected")}
          </p>
        </Show>
        <Show when={state.loading}>
          <p data-slot="memory-feedback" role="status">
            {language.t("home.memory.loading")}
          </p>
        </Show>
        <Show when={state.readError}>
          {(message) => (
            <p data-slot="memory-feedback" role="alert">
              {language.t("home.memory.error.read", { message: message() })}
            </p>
          )}
        </Show>
        <Show when={state.actionError}>
          {(message) => (
            <p data-slot="memory-feedback" role="alert">
              {language.t("home.memory.error.action", { message: message() })}
            </p>
          )}
        </Show>
        <Show when={state.acknowledged}>
          {(item) => (
            <p data-slot="memory-feedback" role="status">
              {language.t("home.memory.acknowledged", { status: language.t(`home.memory.status.${item().status}`) })}
            </p>
          )}
        </Show>
        <Show when={state.pending}>
          <p data-slot="memory-feedback" role="status">
            {language.t("home.memory.updating")}
          </p>
        </Show>
        <Show when={state.editor}>
          {(editor) => (
            <form
              data-slot="memory-editor"
              onSubmit={(event) => {
                event.preventDefault()

                if (editable()) void update("edit", editor())
              }}
            >
              <TextField
                label={language.t("home.memory.content")}
                multiline
                value={editor().content}
                onChange={(content) => setState("editor", (current) => current && { ...current, content })}
                disabled={!connected() || !!state.pending || !editable()}
              />
              <div data-slot="memory-fields">
                <label data-slot="memory-field">
                  <span>{language.t("home.memory.trust")}</span>
                  <Select
                    aria-label={language.t("home.memory.trust")}
                    options={levelOptions()}
                    current={levelOptions().find((option) => option.value === editor().trustLevel)}
                    value={(option) => option.value}
                    label={(option) => option.label}
                    onSelect={(option) =>
                      option && setState("editor", (current) => current && { ...current, trustLevel: option.value })
                    }
                    disabled={!connected() || !!state.pending || !editable()}
                  />
                </label>
                <label data-slot="memory-field">
                  <span>{language.t("home.memory.sensitivity")}</span>
                  <Select
                    aria-label={language.t("home.memory.sensitivity")}
                    options={levelOptions()}
                    current={levelOptions().find((option) => option.value === editor().sensitivityLevel)}
                    value={(option) => option.value}
                    label={(option) => option.label}
                    onSelect={(option) =>
                      option &&
                      setState("editor", (current) => current && { ...current, sensitivityLevel: option.value })
                    }
                    disabled={!connected() || !!state.pending || !editable()}
                  />
                </label>
                <Button type="submit" size="small" disabled={!connected() || !!state.pending || !editable()}>
                  {language.t("home.memory.save")}
                </Button>
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  disabled={!!state.pending}
                  onClick={() => setState("editor", undefined)}
                >
                  {language.t("home.memory.cancel")}
                </Button>
              </div>
              <Show when={!editable()}>
                <p data-slot="memory-feedback" role="alert">
                  {language.t("home.memory.error.notEditable")}
                </p>
              </Show>
            </form>
          )}
        </Show>
        <Show when={state.removal}>
          {(item) => (
            <div data-slot="memory-confirmation" role="group" aria-label={language.t("home.memory.remove")}>
              <p>{language.t("home.memory.remove.confirmation")}</p>
              <p data-slot="memory-content">{item().content}</p>
              <div data-slot="memory-actions">
                <Button
                  type="button"
                  size="small"
                  disabled={!connected() || !!state.pending}
                  onClick={() => void update("remove", { id: item().id })}
                >
                  {language.t("home.memory.remove.confirm")}
                </Button>
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  disabled={!!state.pending}
                  onClick={() => setState("removal", undefined)}
                >
                  {language.t("home.memory.cancel")}
                </Button>
              </div>
            </div>
          )}
        </Show>
        <Show
          when={visible()}
          fallback={
            <Show when={!state.loading && !state.readError && connected()}>
              <p data-slot="memory-feedback">{language.t("home.memory.notLoaded")}</p>
            </Show>
          }
        >
          {(items) => (
            <ul data-slot="memory-list">
              <For
                each={items()}
                fallback={
                  <li data-slot="memory-feedback">
                    {language.t(memories()?.length ? "home.memory.noMatches" : "home.memory.empty")}
                  </li>
                }
              >
                {(item) => (
                  <li data-slot="memory-row" aria-label={language.t("home.memory.entry", { id: item.id })}>
                    <p data-slot="memory-content">{item.content}</p>
                    <div data-slot="memory-metadata">
                      <span>{language.t(`home.memory.status.${item.status}`)}</span>
                      <span>{language.t(`home.memory.source.${item.source}`)}</span>
                      <span>
                        {language.t("home.memory.trustValue", {
                          level: language.t(`home.memory.level.${item.trustLevel}`),
                        })}
                      </span>
                      <span>
                        {language.t("home.memory.sensitivityValue", {
                          level: language.t(`home.memory.level.${item.sensitivityLevel}`),
                        })}
                      </span>
                      <Show when={item.createdBy}>
                        {(name) => <span>{language.t("home.memory.proposedBy", { name: name() })}</span>}
                      </Show>
                      <span>
                        {language.t("home.memory.updatedAt", {
                          time: new Date(item.updatedAt).toLocaleString(language.intl()),
                        })}
                      </span>
                      <Show when={item.sourceMessageID}>
                        {(id) => <span>{language.t("home.memory.sourceMessage", { id: id() })}</span>}
                      </Show>
                    </div>
                    <div data-slot="memory-actions">
                      <Show when={item.status === "pending"}>
                        <Button
                          type="button"
                          size="small"
                          disabled={!connected() || !!state.pending}
                          onClick={() => void update("confirm", { id: item.id })}
                        >
                          {language.t("home.memory.confirm")}
                        </Button>
                        <Button
                          type="button"
                          size="small"
                          variant="ghost"
                          disabled={!connected() || !!state.pending}
                          onClick={() => void update("reject", { id: item.id })}
                        >
                          {language.t("home.memory.reject")}
                        </Button>
                      </Show>
                      <Show when={item.status === "pending" || item.status === "confirmed"}>
                        <Button
                          type="button"
                          size="small"
                          variant="ghost"
                          disabled={!connected() || !!state.pending}
                          onClick={() =>
                            setState({
                              editor: {
                                id: item.id,
                                content: item.content,
                                trustLevel: item.trustLevel,
                                sensitivityLevel: item.sensitivityLevel,
                              },
                              removal: undefined,
                              actionError: undefined,
                            })
                          }
                        >
                          {language.t("home.memory.edit")}
                        </Button>
                      </Show>
                      <Show when={item.status === "confirmed"}>
                        <Button
                          type="button"
                          size="small"
                          variant="ghost"
                          disabled={!connected() || !!state.pending}
                          onClick={() => setState({ removal: item, editor: undefined, actionError: undefined })}
                        >
                          {language.t("home.memory.remove")}
                        </Button>
                      </Show>
                      <Show
                        when={item.sourceSessionID}
                        fallback={
                          <span data-slot="memory-source-missing">{language.t("home.memory.sourceMissing")}</span>
                        }
                      >
                        {(sessionID) => (
                          <Button
                            type="button"
                            size="small"
                            variant="ghost"
                            disabled={!connected() || !!state.pending}
                            onClick={() => void openSource(sessionID())}
                          >
                            {language.t("home.memory.openSource")}
                          </Button>
                        )}
                      </Show>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          )}
        </Show>
      </section>
    </Show>
  )
}
