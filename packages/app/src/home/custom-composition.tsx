import {
  isCompositionResolveError,
  isInvalidRequestError,
  type CustomCompositionPlanOutput,
  type ModelSelection,
  type SessionInfo,
} from "@aigcfroge/client/promise"
import { Composition } from "@aigcfroge/schema/composition"
import type { CustomProfile } from "@aigcfroge/schema/custom-profile"
import { Session } from "@aigcfroge/schema/session"
import { Button } from "@aigcfroge/ui/button"
import { Select } from "@aigcfroge/ui/select"
import { Schema } from "effect"
import { createEffect, createMemo, For, onCleanup, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { errorMessage } from "@/shell/layout/helpers"
import type { HomeController } from "./model"
import { CustomProfileForm } from "./custom-profile"
import { CustomAgentInventory } from "./custom-agents"
import { fromSelection, selectionKey } from "@/providers/models/key"

const roots = ["build", "plan", "meta"] as const

export function CustomComposition(props: { home: HomeController }) {
  const owner = createMemo(
    () => {
      const connection = props.home.server.focused()
      const server = connection ? ServerConnection.key(connection) : undefined
      const context = props.home.server.focusedContext()
      const selection = props.home.selection.value()

      return {
        connection,
        server,
        context,
        client: context?.sdk.api,
        directory:
          server && selection.server === server && props.home.project.selected()?.worktree === selection.directory
            ? selection.directory
            : undefined,
      }
    },
    undefined,
    {
      equals: (previous, next) =>
        previous?.server === next?.server &&
        previous?.context === next?.context &&
        previous?.client === next?.client &&
        previous?.directory === next?.directory,
    },
  )

  return (
    <Show when={owner()} keyed>
      {(selected) => <CustomCompositionForm home={props.home} owner={selected} current={() => owner() === selected} />}
    </Show>
  )
}

export type Owner = {
  connection: ReturnType<HomeController["server"]["focused"]>
  server: ReturnType<typeof ServerConnection.key> | undefined
  context: ReturnType<HomeController["server"]["focusedContext"]>
  client: NonNullable<ReturnType<HomeController["server"]["focusedContext"]>>["sdk"]["api"] | undefined
  directory: string | undefined
}

type Progress =
  | { type: "idle" }
  | { type: "previewing" }
  | { type: "preview"; plan: CustomCompositionPlanOutput }
  | { type: "confirming"; confirmation: Confirmation; pending: boolean }
  | { type: "created"; session: SessionInfo; opening: boolean }

type Confirmation = {
  sessionID: string
  plan: CustomCompositionPlanOutput
  model: ModelSelection | undefined
}

function CustomCompositionForm(props: { home: HomeController; owner: Owner; current: () => boolean }) {
  const language = useLanguage()
  const lifetime = { active: true, revision: 0, preview: new AbortController() }
  const modelRead = new AbortController()

  const [state, setState] = createStore<{
    root: Composition.Root
    agents: Composition.AgentRef[]
    capturedRoot: Composition.Root | undefined
    capturedAgents: Composition.AgentRef[]
    profile: CustomProfile.Info | undefined
    model: ModelSelection | undefined
    defaultModel: ModelSelection | undefined
    modelsLoading: boolean
    modelError: string
    progress: Progress
    error: string
  }>({
    root: new Composition.BuiltinRoot({ source: "builtin", id: "build" }),
    agents: [],
    capturedRoot: undefined,
    capturedAgents: [],
    profile: undefined,
    model: undefined,
    defaultModel: undefined,
    modelsLoading: false,
    modelError: "",
    progress: { type: "idle" },
    error: "",
  })

  const current = () => lifetime.active && props.current()
  const connected = () => props.owner.context?.sdk.connection.status() === "connected"
  const ready = () => connected() && !!props.owner.directory

  const busy = () =>
    (state.progress.type === "confirming" && state.progress.pending) ||
    (state.progress.type === "created" && state.progress.opening)

  const confirmation = () => (state.progress.type === "confirming" ? state.progress : undefined)

  const preview = () => {
    if (state.progress.type === "preview") return state.progress.plan

    if (state.progress.type === "confirming") return state.progress.confirmation.plan
  }

  const previewRoot = () => {
    const input = preview()?.input

    return input?.source === "temporary" ? input.root : state.profile?.profile.root
  }

  const capturedRoot = () => state.capturedRoot
  const capturedAgents = () => state.capturedAgents

  const created = () => (state.progress.type === "created" ? state.progress : undefined)

  const models = () => props.owner.context?.data.location.model.list({ directory: props.owner.directory ?? "" }) ?? []
  const modelGroups = () =>
    props.owner.context?.data.location.model.group.definition.list({ directory: props.owner.directory ?? "" })

  const modelOptions = createMemo(() => {
    const groups = modelGroups()?.effective ?? []
    const selected = state.model

    return [
      { key: "default", label: language.t("home.custom.model.default"), model: undefined, unavailable: undefined },
      ...groups.map((group) => {
        const label = language.t("model.group.selection", { name: group.definition?.name || group.groupID })

        return {
          key: selectionKey({ type: "group", groupID: group.groupID }),
          label: group.unavailable
            ? language.t("home.custom.model.groupUnavailable", {
                model: label,
                reason: language.t(`model.group.unavailable.${group.unavailable}`),
              })
            : label,
          model: { type: "group" as const, groupID: group.groupID },
          unavailable: group.unavailable,
        }
      }),
      ...(selected && "type" in selected && !groups.some((group) => group.groupID === selected.groupID)
        ? [
            {
              key: selectionKey(fromSelection(selected)),
              label: language.t("home.custom.model.groupUnavailable", {
                model: language.t("model.group.selection", { name: selected.groupID }),
                reason: language.t("model.group.unavailable.missing"),
              }),
              model: selected,
              unavailable: "missing" as const,
            },
          ]
        : []),
      ...models().map((model) => ({
        key: selectionKey({ providerID: model.providerID, modelID: model.id }),
        label: `${model.name} (${model.providerID})`,
        model: { id: model.id, providerID: model.providerID },
        unavailable: undefined,
      })),
    ]
  })

  const selectedModel = () => state.model ?? preview()?.orchestrator?.model ?? state.defaultModel

  const modelLabel = () => {
    const selected = selectedModel()

    if (!selected) return language.t("home.custom.model.unavailable")

    if ("type" in selected) {
      const group = modelGroups()?.effective.find((group) => group.groupID === selected.groupID)
      const label = language.t("model.group.selection", { name: group?.definition?.name || selected.groupID })
      const unavailable = group ? group.unavailable : "missing"

      return unavailable
        ? language.t("home.custom.model.groupUnavailable", {
            model: label,
            reason: language.t(`model.group.unavailable.${unavailable}`),
          })
        : label
    }

    const info = models().find((model) => model.id === selected.id && model.providerID === selected.providerID)

    return `${info?.name ?? selected.id} (${selected.providerID})`
  }

  onCleanup(() => {
    lifetime.active = false
    lifetime.preview.abort()
    modelRead.abort()
  })
  createEffect(() => {
    if (!ready()) return

    untrack(() => void loadModels())
  })
  createEffect(() => {
    if (connected()) return

    untrack(() => {
      if (state.progress.type === "preview" || state.progress.type === "previewing") cancelPreview()
      setState("capturedRoot", undefined)
    })
  })

  async function loadModels() {
    const context = props.owner.context
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !context || !client || !directory) return
    setState({ modelsLoading: true, modelError: "" })

    try {
      const [, selected] = await Promise.all([
        context.data.location.model.sync({ directory }),
        client.model.default({ location: { directory } }, { signal: modelRead.signal }),
        context.data.location.model.group.definition.sync({ directory }),
      ])

      if (current())
        setState({ defaultModel: modelGroups()?.defaultSelection ?? selected.data ?? undefined, modelsLoading: false })
    } catch (error) {
      if (current())
        setState({ modelsLoading: false, modelError: errorMessage(error, language.t("home.custom.error.models")) })
    }
  }

  function cancelPreview() {
    lifetime.revision += 1
    lifetime.preview.abort()
    lifetime.preview = new AbortController()
    setState({ progress: { type: "idle" }, error: "" })
  }

  function selectRoot(root: Composition.Root) {
    cancelPreview()
    setState({
      root,
      agents:
        root.source === "asset"
          ? state.agents.filter((agent) => agent.relativePath !== root.relativePath)
          : state.agents,
      capturedRoot: undefined,
      capturedAgents: [],
    })
  }

  function selectAgents(agents: Composition.AgentRef[]) {
    cancelPreview()
    setState({ agents, capturedRoot: undefined, capturedAgents: [] })
  }

  async function resolve(profile?: CustomProfile.Info) {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory || busy() || confirmation() || state.progress.type === "previewing") return
    cancelPreview()

    if (!profile) setState({ capturedRoot: undefined, capturedAgents: [] })
    const revision = lifetime.revision
    setState({ progress: { type: "previewing" }, profile })

    try {
      const plan = await client["custom-composition"].plan(
        {
          directory,
          payload: profile
            ? { source: "profile", profilePath: profile.relativePath, profileRevision: profile.revision }
            : {
                source: "temporary",
                root: state.root,
                agents: state.agents,
                bindings: {},
                presentation: "native",
                requestedCapabilities: [],
              },
        },
        { signal: lifetime.preview.signal },
      )

      if (!current() || revision !== lifetime.revision) return

      if (
        !profile &&
        plan.valid &&
        (plan.input.source !== "temporary" ||
          plan.input.root?.source !== state.root.source ||
          plan.input.root.id !== state.root.id ||
          !plan.input.root.revision ||
          plan.orchestrator?.id !== state.root.id ||
          (state.root.source === "asset" &&
            (plan.input.root.source !== "asset" ||
              plan.input.root.relativePath !== state.root.relativePath ||
              plan.input.root.revision !== state.root.revision)))
      )
        throw new Error(language.t("home.custom.error.selection"))

      if (
        profile &&
        plan.valid &&
        (plan.input.source !== "profile" ||
          plan.input.profilePath !== profile.relativePath ||
          plan.input.profileRevision !== profile.revision ||
          (profile.profile.root && plan.orchestrator?.id !== profile.profile.root.id))
      )
        throw new Error(language.t("home.custom.profile.error.preview"))

      if (plan.valid && plan.input.source === "temporary" && plan.input.root && plan.input.root.revision)
        setState({
          capturedRoot: Schema.decodeUnknownSync(Composition.Root)(plan.input.root),
          capturedAgents: [...Schema.decodeUnknownSync(Schema.Array(Composition.AgentRef))(plan.input.agents)],
        })

      setState("progress", { type: "preview", plan })
    } catch (error) {
      if (!current() || revision !== lifetime.revision) return
      setState({ progress: { type: "idle" }, error: errorMessage(error, language.t("home.custom.error.preview")) })
    }
  }

  const previewProfile = (profile: CustomProfile.Info) => resolve(profile)

  async function openCreated(session: SessionInfo) {
    const context = props.owner.context
    const connection = props.owner.connection

    if (!context || !connection || !current()) return
    setState({ progress: { type: "created", session, opening: true }, error: "" })

    try {
      context.data.session.invalidate(session.id)
      const canonical = await context.data.session.readback(session.id)

      if (!current()) return

      if (!canonical) throw new Error(language.t("home.custom.error.readback"))

      props.home.project.openProjectSession(connection, canonical.location.directory, canonical)
    } catch (error) {
      if (current())
        setState({
          progress: { type: "created", session, opening: false },
          error: errorMessage(error, language.t("home.custom.error.readback")),
        })
    }
  }

  async function start() {
    const plan = preview()
    const client = props.owner.client
    const context = props.owner.context
    const directory = props.owner.directory

    if (
      state.progress.type !== "preview" ||
      !plan?.valid ||
      !ready() ||
      !client ||
      !context ||
      !directory ||
      !current()
    )
      return

    if (plan.input.source === "temporary" && (plan.input.root?.id !== state.root.id || !plan.input.root.revision))
      return

    if (
      plan.input.source === "profile" &&
      (plan.input.profilePath !== state.profile?.relativePath || plan.input.profileRevision !== state.profile?.revision)
    )
      return

    await adopt({ sessionID: Session.ID.create(), plan, model: state.model })
  }

  async function adopt(confirmation: Confirmation) {
    const client = props.owner.client
    const context = props.owner.context
    const directory = props.owner.directory

    if (!ready() || !client || !context || !directory || !current() || busy()) return
    setState({ progress: { type: "confirming", confirmation, pending: true }, error: "" })

    try {
      const payload = {
        sessionID: confirmation.sessionID,
        composition: confirmation.plan.input,
        expectedPlanDigest: confirmation.plan.digest,
      }

      const response = await client["custom-composition"].start(
        {
          directory,
          payload: confirmation.model ? { ...payload, model: confirmation.model } : payload,
        },
        { signal: lifetime.preview.signal },
      )

      if (!current()) return
      // The successful creation response is an ACK; a failed read must never repeat start.
      context.data.session.remember(response.session)
      await openCreated(response.session)
    } catch (error) {
      if (!current()) return

      if (
        isCompositionResolveError(error) ||
        (isInvalidRequestError(error) &&
          error.field === "model" &&
          (error.kind === "meta_model_missing" ||
            error.kind === "meta_model_unavailable" ||
            error.kind === "meta_model_invalid"))
      ) {
        setState({
          progress: { type: "idle" },
          error: isCompositionResolveError(error)
            ? error.diagnostics?.map((diagnostic) => diagnostic.message).join("\n") || error.message
            : errorMessage(error, language.t("home.custom.error.rejected")),
        })

        return
      }

      setState({
        progress: { type: "confirming", confirmation, pending: false },
        error: errorMessage(error, language.t("home.custom.error.create")),
      })
    }
  }

  return (
    <section
      role="region"
      aria-label={language.t("home.custom.title")}
      class="flex min-w-0 flex-col gap-3 border-b border-v2-border-border-base pb-5 text-[13px] leading-[var(--line-height-compact)]"
    >
      <div class="flex min-w-0 flex-col gap-1">
        <h2 class="text-[14px] font-medium leading-[var(--line-height-base)]">{language.t("home.custom.title")}</h2>
        <p class="text-v2-text-text-muted">{language.t("home.custom.selection.description")}</p>
      </div>
      <div role="group" aria-label={language.t("home.custom.root.label")} class="flex flex-wrap gap-1">
        <For each={roots}>
          {(root) => (
            <Button
              type="button"
              size="small"
              variant={state.root.source === "builtin" && state.root.id === root ? "neutral" : "ghost"}
              aria-pressed={state.root.source === "builtin" && state.root.id === root}
              disabled={busy() || !!confirmation() || !!created()}
              onClick={() => {
                if (state.root.source === "builtin" && state.root.id === root) return
                selectRoot(new Composition.BuiltinRoot({ source: "builtin", id: root }))
              }}
            >
              {language.t(`home.custom.root.${root}`)}
            </Button>
          )}
        </For>
      </div>
      <CustomAgentInventory
        owner={props.owner}
        current={current}
        ready={ready}
        disabled={() => busy() || !!confirmation() || !!created()}
        root={() => state.root}
        agents={() => state.agents}
        selectRoot={selectRoot}
        selectAgents={selectAgents}
      />
      <Show when={state.root.source === "asset" ? state.root : undefined}>
        {(root) => (
          <p class="break-all text-v2-text-text-muted">
            {language.t("home.custom.root.label")}: <bdi>{root().id}</bdi>
          </p>
        )}
      </Show>
      <Show when={state.agents.length > 0}>
        <h3 class="font-medium">{language.t("home.custom.agents.selected.title")}</h3>
        <ul class="flex min-w-0 flex-col gap-1">
          <For each={state.agents}>
            {(agent) => (
              <li class="flex min-w-0 flex-wrap items-center gap-2">
                <bdi class="break-all">{agent.relativePath}</bdi>
                <code class="break-all text-[12px] text-v2-text-text-muted">{agent.revision}</code>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={busy() || !!confirmation() || !!created()}
                  onClick={() => selectAgents(state.agents.filter((ref) => ref.relativePath !== agent.relativePath))}
                >
                  {language.t("home.custom.agents.remove")}
                </Button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <span class="text-v2-text-text-muted">{language.t("home.custom.model.label")}</span>
        <Select
          aria-label={language.t("home.custom.model.label")}
          options={modelOptions()}
          value={(option) => option.key}
          label={(option) => option.label}
          optionDisabled={(option) => !!option.unavailable}
          current={modelOptions().find(
            (option) => option.key === (state.model ? selectionKey(fromSelection(state.model)) : "default"),
          )}
          disabled={!ready() || busy() || !!confirmation() || !!created() || state.modelsLoading}
          onSelect={(option) => {
            if (!option) return
            cancelPreview()
            setState("model", option.model)
          }}
        />
        <Show when={state.modelsLoading}>
          <span role="status" class="text-v2-text-text-muted">
            {language.t("home.custom.model.loading")}
          </span>
        </Show>
      </div>
      <Show when={props.owner.directory}>
        {(directory) => <bdi class="break-all text-v2-text-text-muted">{directory()}</bdi>}
      </Show>
      <Show when={!props.owner.directory}>
        <p role="status" class="text-v2-text-text-muted">
          {language.t("home.custom.project.required")}
        </p>
      </Show>
      <Show when={!connected()}>
        <p role="status" class="text-v2-text-text-muted">
          {language.t("home.custom.connection.required")}
        </p>
      </Show>
      <Show when={state.modelError}>
        <p role="alert" class="text-v2-text-text-muted">
          {state.modelError}
        </p>
        <Button
          type="button"
          size="small"
          variant="ghost"
          disabled={!ready() || state.modelsLoading}
          onClick={() => void loadModels()}
        >
          {language.t("home.custom.model.retry")}
        </Button>
      </Show>
      <Show when={preview()}>
        {(plan) => (
          <div class="flex min-w-0 flex-col gap-3" aria-label={language.t("home.custom.preview.title")}>
            <h3 class="font-medium">{language.t("home.custom.preview.title")}</h3>
            <dl class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt class="text-v2-text-text-muted">{language.t("home.custom.source.label")}</dt>
              <dd>
                {language.t(
                  state.profile
                    ? "home.custom.source.profile"
                    : previewRoot()?.source === "asset"
                      ? "home.custom.source.asset"
                      : "home.custom.source.builtin",
                )}
              </dd>
              <Show when={state.profile}>
                {(profile) => (
                  <>
                    <dt class="text-v2-text-text-muted">{language.t("home.custom.profile.path")}</dt>
                    <dd class="min-w-0 break-all">{profile().relativePath}</dd>
                    <dt class="text-v2-text-text-muted">{language.t("home.custom.profile.revision")}</dt>
                    <dd class="min-w-0 break-all font-mono text-[12px]">{profile().revision}</dd>
                  </>
                )}
              </Show>
              <dt class="text-v2-text-text-muted">{language.t("home.custom.root.label")}</dt>
              <dd>
                {plan().orchestrator?.name ??
                  (state.root.source === "builtin" ? language.t(`home.custom.root.${state.root.id}`) : state.root.id)}
              </dd>
              <dt class="text-v2-text-text-muted">{language.t("home.custom.version.label")}</dt>
              <dd class="min-w-0 break-all font-mono text-[12px]">
                {previewRoot()?.revision ?? language.t("home.custom.version.unavailable")}
              </dd>
              <dt class="text-v2-text-text-muted">{language.t("home.custom.model.label")}</dt>
              <dd class="min-w-0 break-words">{modelLabel()}</dd>
            </dl>
            <div class="flex flex-col gap-1">
              <h3 class="font-medium">{language.t("home.custom.permissions.title")}</h3>
              <Show
                when={(plan().orchestrator?.permissions.length ?? 0) > 0}
                fallback={<p class="text-v2-text-text-muted">{language.t("home.custom.permissions.empty")}</p>}
              >
                <ul class="flex flex-col gap-1">
                  <For each={plan().orchestrator?.permissions}>
                    {(rule) => (
                      <li class="flex min-w-0 flex-wrap gap-x-2">
                        <bdi class="break-all">{rule.action}</bdi>
                        <bdi class="break-all text-v2-text-text-muted">{rule.resource}</bdi>
                        <span>{language.t(`home.custom.permissions.${rule.effect}`)}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <p class="text-v2-text-text-muted">{language.t("home.custom.permissions.live")}</p>
            </div>
            <For each={plan().diagnostics}>
              {(diagnostic) => (
                <p
                  role={diagnostic.severity === "blocking" || diagnostic.severity === "error" ? "alert" : "status"}
                  class="break-words"
                >
                  {diagnostic.message}
                </p>
              )}
            </For>
          </div>
        )}
      </Show>
      <Show when={state.error}>
        <p role="alert" class="break-words">
          {state.error}
        </p>
      </Show>
      <div class="flex flex-wrap gap-2">
        <Show when={!created()}>
          <Button
            type="button"
            size="small"
            variant="outline"
            disabled={!ready() || busy() || !!confirmation() || state.progress.type === "previewing"}
            onClick={() => void resolve()}
          >
            {language.t(
              state.progress.type === "previewing" ? "home.custom.preview.loading" : "home.custom.preview.action",
            )}
          </Button>
          <Show when={state.progress.type === "preview"}>
            <Button
              type="button"
              size="small"
              variant="contrast"
              disabled={!ready() || !preview()?.valid || busy()}
              onClick={() => void start()}
            >
              {language.t("home.custom.create")}
            </Button>
          </Show>
          <Show when={state.progress.type === "preview" || state.progress.type === "previewing"}>
            <Button type="button" size="small" variant="ghost" onClick={cancelPreview}>
              {language.t("common.cancel")}
            </Button>
          </Show>
          <Show when={confirmation()}>
            {(confirmed) => (
              <>
                <Show
                  when={confirmed().pending}
                  fallback={
                    <Button
                      type="button"
                      size="small"
                      variant="contrast"
                      disabled={!ready()}
                      onClick={() => void adopt(confirmed().confirmation)}
                    >
                      {language.t("home.custom.retryConfirmation")}
                    </Button>
                  }
                >
                  <span role="status" class="text-v2-text-text-muted">
                    {language.t("home.custom.creating")}
                  </span>
                </Show>
              </>
            )}
          </Show>
        </Show>
        <Show when={created()}>
          {(created) => (
            <>
              <p role="status">{language.t("home.custom.created")}</p>
              <Button
                type="button"
                size="small"
                variant="contrast"
                disabled={created().opening || !ready()}
                onClick={() => void openCreated(created().session)}
              >
                {language.t(created().opening ? "home.custom.opening" : "home.custom.open")}
              </Button>
            </>
          )}
        </Show>
      </div>
      <CustomProfileForm
        owner={props.owner}
        current={current}
        connected={connected}
        disabled={() => busy() || !!confirmation() || !!created()}
        root={capturedRoot}
        agents={capturedAgents}
        invalidate={cancelPreview}
        preview={previewProfile}
      />
    </section>
  )
}
