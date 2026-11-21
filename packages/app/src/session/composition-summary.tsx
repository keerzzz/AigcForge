import type { SessionInfo } from "@aigcfroge/client/promise"
import { Button } from "@aigcfroge/ui/button"
import { useNavigate } from "@solidjs/router"
import { createMemo, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK, type ServerConnectionStatus } from "@/runtime/server/client"
import type { ServerApi } from "@/runtime/server/api"
import { useLocal } from "@/providers/models/selection"
import { useData } from "@/runtime/server/current"
import { stageComposeDraftFromSnapshot } from "@/home/custom/handoff"
import { ModeRoute } from "@/shell/routes/mode"

export function SessionCompositionSummary(props: { session: SessionInfo }) {
  const sdk = useServerSDK()

  const source = createMemo(
    () => ({
      sessionID: props.session.id,
      directory: props.session.location.directory,
      client: sdk.api,
      status: sdk.connection.status(),
      attempt: sdk.connection.attempt(),
    }),
    undefined,
    {
      equals: (previous, next) =>
        previous?.sessionID === next?.sessionID &&
        previous?.directory === next?.directory &&
        previous?.client === next?.client &&
        previous?.status === next?.status &&
        previous?.attempt === next?.attempt,
    },
  )

  return (
    <Show when={source()} keyed>
      {(owner) => <CompositionSummary owner={owner} />}
    </Show>
  )
}

function CompositionSummary(props: {
  owner: { sessionID: string; directory: string; client: ServerApi; status: ServerConnectionStatus; attempt: number }
}) {
  const language = useLanguage()
  const data = useData()
  const sdk = useServerSDK()
  const navigate = useNavigate()

  const composition = useLocal().composition
  const [state, setState] = createStore({ open: false })
  const lifecycle = { active: true, syncRead: 0 }

  onCleanup(() => {
    lifecycle.active = false
  })

  const modelLabel = (model: SessionInfo["model"]) => {
    if (!model) return language.t("home.custom.model.default")

    if (!("type" in model)) return `${model.providerID}/${model.id}`
    const read = data.location.model.group.definition.list({ directory: props.owner.directory })
    const group = read?.effective.find((group) => group.groupID === model.groupID)
    const label = language.t("model.group.selection", { name: group?.definition?.name || model.groupID })
    const unavailable = group ? group.unavailable : read ? "missing" : undefined

    return unavailable
      ? language.t("home.custom.model.groupUnavailable", {
          model: label,
          reason: language.t(`model.group.unavailable.${unavailable}`),
        })
      : label
  }

  const snapshot = () => composition.snapshot()

  const adopted = () => {
    const value = snapshot()

    return value?.version === 2 ? value : undefined
  }

  const root = () => adopted()?.data.root
  const profile = () => (adopted()?.profilePath ? adopted() : undefined)

  const configuredCount = createMemo(() => {
    const value = adopted()

    if (!value) return 0

    return (value.data.root ? 1 : 0) + (value.data.executors?.length ?? 0)
  })

  const frozenBindingsCount = createMemo(() => {
    const bindings = adopted()?.data.bindings

    if (!bindings) return 0

    return Object.values(bindings).reduce(
      (sum, bundle) => sum + bundle.prompts.length + bundle.skills.length + bundle.commands.length,
      0,
    )
  })

  // Strictly separated from configured SnapshotV2 roles: counts real execution records from live owners.
  const actualExecutionCount = createMemo(() => {
    const id = props.owner.sessionID
    const ops = data.session.task.operation.list(id)?.length ?? 0
    const delegations = (data.session.delegation.list(id) ?? []).reduce(
      (sum, entry) => sum + Math.max(1, entry.participants.length),
      0,
    )
    const workflowSteps = data.session.workflow.get(id)?.steps.length ?? 0
    const children = data.session.family(id).filter((childID) => data.session.get(childID)?.parentID === id).length

    return ops + delegations + workflowSteps + children
  })

  function syncExecutionParticipants() {
    if (!state.open || props.owner.status !== "connected") return
    const id = props.owner.sessionID
    const read = ++lifecycle.syncRead
    void Promise.allSettled([
      data.session.readback(id, { children: true }),
      data.session.workflow.sync(id),
      data.session.delegation.sync(id),
      data.session.task.sync(id),
      data.session.task.operation.sync(id),
    ]).then(() => {
      if (!lifecycle.active || read !== lifecycle.syncRead) return
    })
  }

  function load() {
    if (!state.open || props.owner.status !== "connected") return

    if (!composition.loading()) composition.load()
    syncExecutionParticipants()
  }

  function editInWorkspace() {
    const value = adopted()

    if (!value) return
    stageComposeDraftFromSnapshot(sdk.scope, props.owner.directory, value)
    navigate(ModeRoute.href("custom"))
  }

  return (
    <details
      class="min-w-0 pb-1 text-[12px] leading-[var(--line-height-compact)]"
      onToggle={(event) => {
        const open = event.currentTarget.open
        setState("open", open)

        if (!open) return

        if (!snapshot()) {
          load()

          return
        }

        syncExecutionParticipants()
      }}
    >
      <summary
        class="w-fit cursor-pointer rounded-[4px] text-v2-text-text-muted"
        aria-label={language.t("session.composition.title")}
      >
        {language.t("session.composition.title")}
      </summary>
      <div role="region" aria-label={language.t("session.composition.title")} class="flex min-w-0 flex-col gap-2 pt-2">
        <Show when={composition.loading()}>
          <p role="status">{language.t("session.composition.loading")}</p>
        </Show>
        <Show when={root()}>
          {(root) => (
            <dl class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt class="text-v2-text-text-muted">{language.t("home.custom.root.label")}</dt>
              <dd>{adopted()?.data.orchestrator?.name ?? root().id}</dd>
              <dt class="text-v2-text-text-muted">{language.t("home.custom.source.label")}</dt>
              <dd>
                {language.t(
                  profile()
                    ? "home.custom.source.profile"
                    : root().source === "asset"
                      ? "home.custom.source.asset"
                      : "home.custom.source.builtin",
                )}
              </dd>
              <dt class="text-v2-text-text-muted">{language.t("home.custom.version.label")}</dt>
              <dd class="min-w-0 break-all font-mono">
                {root().revision ?? language.t("home.custom.version.unavailable")}
              </dd>
            </dl>
          )}
        </Show>
        <Show when={adopted()}>
          {(value) => (
            <>
              <div class="flex flex-wrap gap-x-3 gap-y-1 text-v2-text-text-muted">
                <span>{language.t("session.composition.configuredCount", { count: configuredCount() })}</span>
                <span>{language.t("session.composition.actualCount", { count: actualExecutionCount() })}</span>
                <Show when={frozenBindingsCount() > 0}>
                  <span>{language.t("session.composition.bindingsSummary", { count: frozenBindingsCount() })}</span>
                </Show>
                <Show when={value().data.workflow}>
                  {(wf) => (
                    <span>
                      {language.t("session.composition.workflowSummary", {
                        name: wf().name,
                        steps: wf().steps.length,
                      })}
                    </span>
                  )}
                </Show>
                <Show when={(value().data.mcp?.bindings.length ?? 0) > 0}>
                  <span>
                    {language.t("session.composition.mcpSummary", { count: value().data.mcp?.bindings.length ?? 0 })}
                  </span>
                </Show>
              </div>
              <section class="flex min-w-0 flex-col gap-1" aria-label={language.t("session.composition.agents.title")}>
                <h3 class="font-medium">{language.t("session.composition.agents.title")}</h3>
                <Show when={value().data.orchestrator}>
                  {(agent) => (
                    <p class="min-w-0 break-words">
                      <span class="text-v2-text-text-muted">{language.t("home.custom.root.label")}: </span>
                      <bdi>{agent().name}</bdi>
                    </p>
                  )}
                </Show>
                <Show
                  when={(value().data.executors?.length ?? 0) > 0}
                  fallback={<p class="text-v2-text-text-muted">{language.t("session.composition.agents.empty")}</p>}
                >
                  <ul class="flex min-w-0 flex-col gap-2">
                    <For each={value().data.executors}>
                      {(executor) => (
                        <li class="flex min-w-0 flex-col gap-1">
                          <p class="break-words">
                            <span class="text-v2-text-text-muted">
                              {language.t("session.composition.agents.executor")}:{" "}
                            </span>
                            <bdi>{executor.info.name}</bdi>
                          </p>
                          <bdi class="break-all text-v2-text-text-muted">{executor.relativePath}</bdi>
                          <code class="break-all">{executor.revision}</code>
                          <p class="break-words text-v2-text-text-muted">{modelLabel(executor.info.model)}</p>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </section>
              <p class="text-v2-text-text-muted">{language.t("session.composition.livePermissionsNote")}</p>
            </>
          )}
        </Show>
        <Show when={profile()}>
          {(profile) => (
            <dl class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt class="text-v2-text-text-muted">{language.t("home.custom.profile.path")}</dt>
              <dd class="min-w-0 break-all">{profile().profilePath}</dd>
              <dt class="text-v2-text-text-muted">{language.t("home.custom.profile.revision")}</dt>
              <dd class="min-w-0 break-all font-mono">{profile().profileRevision}</dd>
            </dl>
          )}
        </Show>
        <Show when={snapshot()}>
          {(snapshot) => (
            <>
              <Show when={!root()}>
                <p>{language.t("session.composition.legacy")}</p>
              </Show>
              <p class="min-w-0 break-all">
                <span class="text-v2-text-text-muted">{language.t("session.workflow.snapshot")}: </span>
                <code>{snapshot().digest}</code>
              </p>
            </>
          )}
        </Show>
        <Show when={composition.error()}>
          <p role="alert">{composition.error()}</p>
        </Show>
        <div class="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="small"
            variant="ghost"
            disabled={composition.loading() || props.owner.status !== "connected"}
            onClick={() => void load()}
          >
            {language.t("session.composition.reload")}
          </Button>
          <Show when={adopted()}>
            <Button type="button" size="small" variant="ghost" onClick={editInWorkspace}>
              {language.t("session.composition.editInWorkspace")}
            </Button>
          </Show>
        </div>
      </div>
    </details>
  )
}
