import type { SessionGoalInfo } from "@aigcfroge/client/promise"
import { Button } from "@aigcfroge/ui/button"
import { DockTray } from "@aigcfroge/ui/dock-surface"
import { Icon } from "@aigcfroge/ui/icon"
import { IconButton } from "@aigcfroge/ui/icon-button"
import { TextField } from "@aigcfroge/ui/text-field"
import { errorMessage } from "@aigcfroge/util/error"
import { Match } from "effect"
import { createEffect, createMemo, createResource, createSignal, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useSessionContent } from "../content-context"

export function SessionGoalDock(props: { sessionID: string; readonly?: boolean }) {
  const language = useLanguage()
  const data = useData()
  const server = useServerSDK()
  const content = useSessionContent()
  const lifecycle = { live: true }

  const [state, setState] = createStore<{
    editing: Pick<SessionGoalInfo, "id" | "revision"> | undefined
    objective: string
    error: string
    operation: { owner: symbol; token: symbol } | undefined
  }>({ editing: undefined, objective: "", error: "", operation: undefined })

  onCleanup(() => {
    lifecycle.live = false
  })

  const directory = createMemo(() => data.session.get(props.sessionID)?.location.directory)
  const root = createMemo(() => data.session.get(props.sessionID)?.controller?.kind === "root")
  const identityLoaded = createMemo(() => data.session.identity.get(props.sessionID) !== undefined)

  const owner = createMemo(() => ({
    token: Symbol(),
    sessionID: props.sessionID,
    client: server.api,
    attempt: server.connection.attempt(),
    connected: server.connection.status() === "connected",
    active: content?.active() ?? true,
    directory: directory(),
    root: root(),
  }))

  const readKey = createMemo(() => [owner(), identityLoaded()] as const)
  const [readSource, setReadSource] = createSignal<ReturnType<typeof readKey>>()

  // Connection invalidation runs before this effect. Identity fills keep the existing Goal read.
  createEffect(
    on(readKey, (next, previous) => {
      if (next[1] && next[0] === previous?.[0]) return

      setReadSource(next)
    }),
  )

  const [read, { refetch }] = createResource(readSource, async ([value]) => {
    if (!value.connected || !value.active || !value.root || !value.directory) return

    await Promise.all([data.session.goal.sync(value.sessionID), data.session.identity.sync(value.sessionID)])
  })

  const goal = createMemo(() => {
    const goals = data.session.goal.list(props.sessionID)

    return goals?.find((goal) => goal.status === "active") ?? goals?.[0]
  })

  // Reconnecting releases the previous view's busy state while keeping its edit draft.
  const pending = () => state.operation?.owner === owner().token

  const editable = () =>
    !props.readonly &&
    owner().connected &&
    (goal()?.status === "active" || goal()?.status === "paused") &&
    data.session.identity.get(props.sessionID)?.coordination?.available === true

  const editing = () =>
    state.editing?.id === goal()?.id &&
    state.editing !== undefined &&
    (goal()?.status === "active" || goal()?.status === "paused")

  const error = () =>
    state.error || (read.error ? errorMessage(read.error, language.t("session.goalDock.loadError")) : "")

  async function mutate(action: "edit" | "pause" | "resume" | "cancel" | "confirm") {
    const selected = goal()
    const value = owner()
    const editing = state.editing

    if (!selected || pending() || props.readonly || !value.connected) return

    if (action === "edit" && (!editing || editing.id !== selected.id || !editable())) return

    if (action === "resume" && !editable()) return

    if (action === "edit" && !state.objective.trim()) {
      setState("error", language.t("session.goalDock.required"))

      return
    }

    const input = {
      sessionID: value.sessionID,
      goalID: selected.id,
      expectedRevision: action === "edit" && editing ? editing.revision : selected.revision,
      directory: value.directory,
    }

    const operation = Symbol()
    setState({ operation: { owner: value.token, token: operation }, error: "" })

    try {
      if (action === "edit") await data.session.goal.edit({ ...input, objective: state.objective.trim() })

      if (action === "pause") await data.session.goal.pause(input)

      if (action === "resume") await data.session.goal.resume(input)

      if (action === "cancel") await data.session.goal.cancel(input)

      if (action === "confirm")
        await data.session.goal.confirm({
          ...input,
          evidenceIDs: [...(selected.currentEvidenceIDs ?? [])],
          evidenceSetDigest: selected.evidenceSetDigest,
        })

      if (lifecycle.live && owner() === value) setState("editing", undefined)
    } catch (error) {
      if (lifecycle.live && owner() === value)
        setState("error", errorMessage(error, language.t("session.goalDock.updateError")))
    } finally {
      if (lifecycle.live && state.operation?.token === operation) setState("operation", undefined)
    }
  }

  return (
    <Show when={goal() || error()}>
      <DockTray
        data-component="session-goal-dock"
        role="region"
        aria-label={language.t("session.goalDock.title")}
        class="mb-2 p-3 text-13-regular leading-[var(--line-height-base)]"
      >
        <Show when={goal()}>
          {(current) => (
            <>
              <div class="flex min-h-7 items-start gap-2">
                <Icon
                  name={Match.value(current().status).pipe(
                    Match.when("completed", () => "circle-check" as const),
                    Match.when("cancelled", () => "stop" as const),
                    Match.orElse(() => "check" as const),
                  )}
                  class="mt-0.5 shrink-0 text-v2-icon-icon-muted"
                />
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-12-regular text-v2-text-text-muted">
                    <span>{language.t("session.goalDock.title")}</span>
                    <span role="status">{language.t(`session.goalDock.status.${current().status}`)}</span>
                    <Show when={current().status === "paused" ? current().pauseReason : undefined}>
                      {(reason) => <span>{language.t(`session.goalDock.pauseReason.${reason()}`)}</span>}
                    </Show>
                  </div>
                  <Show when={!editing()}>
                    <p class="mt-1 break-words text-v2-text-text-base">{current().objective}</p>
                  </Show>
                </div>
                <Show
                  when={
                    !props.readonly && !editing() && (current().status === "active" || current().status === "paused")
                  }
                >
                  <div class="flex shrink-0 items-center gap-1">
                    <IconButton
                      type="button"
                      size="small"
                      variant="ghost"
                      icon={<Icon name="edit" size="small" />}
                      aria-label={language.t("session.goalDock.edit")}
                      title={language.t("session.goalDock.edit")}
                      disabled={pending() || !editable()}
                      onClick={() =>
                        setState({
                          editing: { id: current().id, revision: current().revision },
                          objective: current().objective,
                          error: "",
                        })
                      }
                    />
                    <IconButton
                      type="button"
                      size="small"
                      variant="ghost"
                      icon={<Icon name="stop" size="small" />}
                      aria-label={language.t("session.goalDock.cancel")}
                      title={language.t("session.goalDock.cancel")}
                      disabled={pending() || !owner().connected}
                      onClick={() => void mutate("cancel")}
                    />
                  </div>
                </Show>
              </div>
              <Show when={editing()}>
                <form
                  class="mt-2 flex flex-col gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void mutate("edit")
                  }}
                >
                  <TextField
                    label={language.t("session.goalDock.objective")}
                    value={state.objective}
                    multiline
                    required
                    disabled={pending()}
                    onChange={(objective) => setState("objective", objective)}
                    onKeyDown={(event: KeyboardEvent) => {
                      if (event.key !== "Escape" || pending()) return

                      event.preventDefault()
                      setState({ editing: undefined, error: "" })
                    }}
                  />
                  <div class="flex justify-end gap-2">
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={pending()}
                      onClick={() => setState({ editing: undefined, error: "" })}
                    >
                      {language.t("session.goalDock.discard")}
                    </Button>
                    <Button
                      type="submit"
                      size="small"
                      disabled={pending() || !editable() || !state.objective.trim()}
                      aria-busy={pending()}
                    >
                      {language.t("common.save")}
                    </Button>
                  </div>
                </form>
              </Show>
              <Show when={!editing() && current().status !== "cancelled"}>
                <div class="mt-2 flex flex-wrap items-center justify-between gap-2 ps-6">
                  <div class="flex items-center gap-2 text-12-regular text-v2-text-text-muted">
                    <span>{language.t("session.goalDock.progress")}</span>
                    <span
                      role="progressbar"
                      aria-label={language.t("session.goalDock.progress")}
                      aria-valuemin={0}
                      aria-valuemax={current().conditions.length}
                      aria-valuenow={current().satisfiedConditionIDs.length}
                      class="tabular-nums"
                    >
                      {current().satisfiedConditionIDs.length} / {current().conditions.length}
                    </span>
                  </div>
                  <Show when={!props.readonly && (current().status === "active" || current().status === "paused")}>
                    <div class="flex items-center gap-2">
                      <Button
                        type="button"
                        size="small"
                        variant="ghost"
                        disabled={pending() || !owner().connected || (current().status === "paused" && !editable())}
                        onClick={() => void mutate(current().status === "paused" ? "resume" : "pause")}
                      >
                        {language.t(
                          current().status === "paused" ? "session.goalDock.resume" : "session.goalDock.pause",
                        )}
                      </Button>
                      <Show
                        when={
                          current().conditions.some((condition) => condition.kind === "human_acceptance") &&
                          current().conditions.every(
                            (condition) =>
                              condition.kind === "human_acceptance" ||
                              current().satisfiedConditionIDs.includes(condition.id),
                          )
                        }
                      >
                        <Button
                          type="button"
                          size="small"
                          disabled={pending() || !owner().connected}
                          onClick={() => void mutate("confirm")}
                        >
                          {language.t("session.goalDock.confirm")}
                        </Button>
                      </Show>
                    </div>
                  </Show>
                </div>
              </Show>
            </>
          )}
        </Show>
        <Show when={error()}>
          <div role="alert" class="mt-2 flex flex-wrap items-center gap-2 text-v2-text-text-muted">
            <span>{error()}</span>
            <Show when={read.error}>
              <Button
                type="button"
                size="small"
                variant="ghost"
                disabled={!owner().connected}
                onClick={() => {
                  data.session.goal.invalidate(props.sessionID)
                  void refetch()
                }}
              >
                {language.t("common.retry")}
              </Button>
            </Show>
          </div>
        </Show>
      </DockTray>
    </Show>
  )
}

export * as GoalDock from "./session-goal-dock"
